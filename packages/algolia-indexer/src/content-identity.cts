/**
 * Ghost content identity operations for the Algolia indexer.
 *
 * These primitives group, replace, delete, and reconcile package-managed records by the stable
 * Ghost content ID carried in the protected `contentId` and `contentType` record fields, rather
 * than by mutable slug. They stay dormant until an adapter opts in after the guarded one-time
 * identity migration; nothing here reads or writes index settings.
 */

import {mapAlgoliaError} from './errors.cjs';

export type GhostContentType = 'post' | 'page';

export type ContentIdentity = Readonly<{
    contentId: string;
    contentType: GhostContentType;
}>;

export type RecordIdentity = Readonly<{
    objectID: string;
    slug: string | null;
    contentId: string | null;
    contentType: string | null;
}>;

export type CleanupOutcome = Readonly<{cleanupSkipped: boolean}>;

type AlgoliaRecord = Readonly<Record<string, unknown>>;

type BrowsePage = Readonly<{hits: readonly AlgoliaRecord[]}>;

type StaleObjectIDs = CleanupOutcome & Readonly<{stale: ReadonlySet<string>}>;

export type ContentIdentityClient = Readonly<{
    browseObjects(options: {
        indexName: string;
        browseParams: {attributesToRetrieve: readonly string[]; filters?: string};
        aggregator: (page: BrowsePage) => void;
    }): Promise<unknown>;
    saveObjects(options: {
        indexName: string;
        objects: readonly AlgoliaRecord[];
        waitForTasks: boolean;
    }): Promise<unknown>;
    deleteObjects(options: {
        indexName: string;
        objectIDs: readonly string[];
        waitForTasks: boolean;
    }): Promise<unknown>;
    deleteBy(options: {
        indexName: string;
        deleteByParams: {filters: string};
    }): Promise<{taskID: number}>;
    waitForTask(options: {indexName: string; taskID: number}): Promise<unknown>;
}>;

const GHOST_CONTENT_TYPES: readonly string[] = ['post', 'page'];

const statusOf = (error: unknown): unknown => (error as {status?: unknown}).status;

const isNonEmptyString = (value: unknown): value is string => {
    return typeof value === 'string' && value !== '';
};

const isGhostContentType = (value: unknown): value is GhostContentType => {
    return typeof value === 'string' && GHOST_CONTENT_TYPES.includes(value);
};

const toRecordString = (value: unknown): string | null => {
    return isNonEmptyString(value) ? value : null;
};

/** Quotes one value for an Algolia filter expression, escaping backslashes and double quotes. */
const toFilterValue = (value: string): string => {
    return `"${value.replace(/(["\\])/gu, '\\$1')}"`;
};

const browseIdentityAttributes = async (
    client: ContentIdentityClient,
    indexName: string,
    attributesToRetrieve: readonly string[],
    aggregate: (hit: AlgoliaRecord) => void,
    filters?: string
): Promise<void> => {
    await client.browseObjects({
        indexName,
        browseParams:
            filters === undefined ? {attributesToRetrieve} : {attributesToRetrieve, filters},
        aggregator: ({hits}) => {
            for (const hit of hits) {
                aggregate(hit);
            }
        }
    });
};

/**
 * Browses for the stale object IDs a cleanup may delete. A browse denial (403) or a missing
 * index (404) yields no stale IDs instead of failing, and the denial is reported as skipped
 * cleanup so callers can warn that stale records remain.
 */
const collectStaleObjectIDs = async (
    client: ContentIdentityClient,
    indexName: string,
    attributesToRetrieve: readonly string[],
    isStale: (hit: AlgoliaRecord) => hit is AlgoliaRecord & {objectID: string},
    filters?: string
): Promise<StaleObjectIDs> => {
    const stale = new Set<string>();
    try {
        await browseIdentityAttributes(
            client,
            indexName,
            attributesToRetrieve,
            hit => {
                if (isStale(hit)) {
                    stale.add(hit.objectID);
                }
            },
            filters
        );
    } catch (error) {
        const status = statusOf(error);
        if (status !== 403 && status !== 404) {
            throw error;
        }
        return {stale: new Set(), cleanupSkipped: status === 403};
    }
    return {stale, cleanupSkipped: false};
};

const deleteStaleObjects = async (
    client: ContentIdentityClient,
    indexName: string,
    stale: ReadonlySet<string>
): Promise<void> => {
    if (stale.size === 0) {
        return;
    }
    await client.deleteObjects({indexName, objectIDs: [...stale], waitForTasks: true});
};

const readReplacementIdentities = (
    contents: readonly unknown[]
): ReadonlyMap<string, GhostContentType> => {
    const identities = new Map<string, GhostContentType>();
    for (const content of contents) {
        const {contentId, contentType} = (content ?? {}) as Partial<ContentIdentity>;
        if (!isNonEmptyString(contentId) || !isGhostContentType(contentType)) {
            throw new TypeError(
                'Replacement content requires a contentId and a contentType of "post" or "page".'
            );
        }
        identities.set(contentId, contentType);
    }
    return identities;
};

const readRetainedObjectIDs = (
    fragments: readonly unknown[],
    identities: ReadonlyMap<string, GhostContentType>
): ReadonlySet<string> => {
    const represented = new Set<string>();
    const retained = new Set<string>();
    for (const fragment of fragments) {
        const record = (fragment ?? {}) as AlgoliaRecord;
        const {objectID, contentId} = record;
        if (
            !isNonEmptyString(objectID) ||
            !isNonEmptyString(contentId) ||
            identities.get(contentId) !== record.contentType
        ) {
            throw new TypeError('Replacement fragments must belong to the supplied content.');
        }
        represented.add(contentId);
        retained.add(objectID);
    }
    if (represented.size !== identities.size) {
        throw new TypeError('Replacement fragments must belong to the supplied content.');
    }
    return retained;
};

/**
 * Browses every record's identity attributes: physical object ID, navigation slug, and the
 * protected Ghost content identity fields. Records that predate the identity migration come back
 * with `null` identity values so callers can classify them. Call with an initialized client.
 */
export const browseContentIdentities = async (
    client: ContentIdentityClient,
    indexName: string
): Promise<readonly RecordIdentity[]> => {
    const records: RecordIdentity[] = [];
    try {
        await browseIdentityAttributes(
            client,
            indexName,
            ['objectID', 'slug', 'contentId', 'contentType'],
            hit => {
                if (!isNonEmptyString(hit.objectID)) {
                    return;
                }
                records.push({
                    objectID: hit.objectID,
                    slug: toRecordString(hit.slug),
                    contentId: toRecordString(hit.contentId),
                    contentType: toRecordString(hit.contentType)
                });
            }
        );
    } catch (error) {
        throw mapAlgoliaError(error);
    }
    return records;
};

/**
 * Saves the complete replacement set for the supplied Ghost content and confirms every save
 * before deleting only that content's stale records, matched by `contentId`. Every supplied
 * content must be represented by at least one replacement record; an empty replacement makes no
 * requests. A browse denial (403) skips cleanup and reports it; a save failure prevents all
 * cleanup.
 */
export const replaceContent = async (
    client: ContentIdentityClient,
    indexName: string,
    fragments: unknown,
    contents: unknown
): Promise<CleanupOutcome> => {
    if (!Array.isArray(fragments) || !Array.isArray(contents)) {
        throw new TypeError('Replacement requires fragment and content arrays.');
    }
    if (fragments.length === 0) {
        return {cleanupSkipped: false};
    }
    const identities = readReplacementIdentities(contents);
    const retained = readRetainedObjectIDs(fragments, identities);

    // The identity facet exists before any adapter activates these operations, so the browse
    // only visits the supplied content instead of the whole index.
    const filters = [...identities.keys()]
        .map(contentId => `contentId:${toFilterValue(contentId)}`)
        .join(' OR ');
    const isStale = (hit: AlgoliaRecord): hit is AlgoliaRecord & {objectID: string} => {
        return (
            isNonEmptyString(hit.objectID) &&
            isNonEmptyString(hit.contentId) &&
            identities.has(hit.contentId) &&
            !retained.has(hit.objectID)
        );
    };

    try {
        const {stale, cleanupSkipped} = await collectStaleObjectIDs(
            client,
            indexName,
            ['objectID', 'contentId'],
            isStale,
            filters
        );
        await client.saveObjects({indexName, objects: fragments, waitForTasks: true});
        await deleteStaleObjects(client, indexName, stale);
        return {cleanupSkipped};
    } catch (error) {
        throw mapAlgoliaError(error);
    }
};

/**
 * Deletes every record that carries one Ghost content ID and waits for the deletion to finish.
 * Requires the `contentId` filter facet from the identity migration.
 */
export const deleteContent = async (
    client: ContentIdentityClient,
    indexName: string,
    contentId: unknown
): Promise<void> => {
    if (!isNonEmptyString(contentId)) {
        throw new TypeError('Content deletion requires a contentId.');
    }
    try {
        const {taskID} = await client.deleteBy({
            indexName,
            deleteByParams: {filters: `contentId:${toFilterValue(contentId)}`}
        });
        await client.waitForTask({indexName, taskID});
    } catch (error) {
        throw mapAlgoliaError(error);
    }
};

/**
 * Removes the package-managed records that a complete run no longer produces: records carrying
 * Ghost content identity whose object IDs are not in the retained replacement set. Records
 * without identity fields are never touched. Run it only after every replacement save is
 * confirmed. A browse denial (403) skips cleanup and reports it.
 */
export const reconcileContent = async (
    client: ContentIdentityClient,
    indexName: string,
    fragments: unknown
): Promise<CleanupOutcome> => {
    if (!Array.isArray(fragments)) {
        throw new TypeError('Reconciliation requires the complete array of saved records.');
    }
    const retained = new Set<string>();
    for (const fragment of fragments) {
        const record = (fragment ?? {}) as AlgoliaRecord;
        if (!isNonEmptyString(record.objectID)) {
            throw new TypeError('Reconciliation records require an objectID.');
        }
        retained.add(record.objectID);
    }

    const isStale = (hit: AlgoliaRecord): hit is AlgoliaRecord & {objectID: string} => {
        return (
            isNonEmptyString(hit.objectID) &&
            isNonEmptyString(hit.contentId) &&
            isGhostContentType(hit.contentType) &&
            !retained.has(hit.objectID)
        );
    };

    try {
        const {stale, cleanupSkipped} = await collectStaleObjectIDs(
            client,
            indexName,
            ['objectID', 'contentId', 'contentType'],
            isStale
        );
        await deleteStaleObjects(client, indexName, stale);
        return {cleanupSkipped};
    } catch (error) {
        throw mapAlgoliaError(error);
    }
};
