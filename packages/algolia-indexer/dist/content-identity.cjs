"use strict";
/**
 * Ghost content identity operations for the Algolia indexer.
 *
 * These primitives group, replace, delete, and reconcile package-managed records by the stable
 * Ghost content ID carried in the protected `contentId` and `contentType` record fields, rather
 * than by mutable slug. They stay dormant until an adapter opts in after the guarded one-time
 * identity migration; nothing here reads or writes index settings.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.reconcileContent = exports.deleteContent = exports.replaceContent = exports.browseContentIdentities = void 0;
const errors_cjs_1 = require("./errors.cjs");
const GHOST_CONTENT_TYPES = ['post', 'page'];
const statusOf = (error) => error.status;
const isNonEmptyString = (value) => {
    return typeof value === 'string' && value !== '';
};
const isGhostContentType = (value) => {
    return typeof value === 'string' && GHOST_CONTENT_TYPES.includes(value);
};
const toRecordString = (value) => {
    return isNonEmptyString(value) ? value : null;
};
/** Quotes one value for an Algolia filter expression, escaping backslashes and double quotes. */
const toFilterValue = (value) => {
    return `"${value.replace(/(["\\])/gu, '\\$1')}"`;
};
const browseIdentityAttributes = async (client, indexName, attributesToRetrieve, aggregate, filters) => {
    await client.browseObjects({
        indexName,
        browseParams: filters === undefined ? { attributesToRetrieve } : { attributesToRetrieve, filters },
        aggregator: ({ hits }) => {
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
const collectStaleObjectIDs = async (client, indexName, attributesToRetrieve, isStale, filters) => {
    const stale = new Set();
    try {
        await browseIdentityAttributes(client, indexName, attributesToRetrieve, hit => {
            if (isStale(hit)) {
                stale.add(hit.objectID);
            }
        }, filters);
    }
    catch (error) {
        const status = statusOf(error);
        if (status !== 403 && status !== 404) {
            throw error;
        }
        return { stale: new Set(), cleanupSkipped: status === 403 };
    }
    return { stale, cleanupSkipped: false };
};
const deleteStaleObjects = async (client, indexName, stale) => {
    if (stale.size === 0) {
        return;
    }
    await client.deleteObjects({ indexName, objectIDs: [...stale], waitForTasks: true });
};
const readReplacementIdentities = (contents) => {
    const identities = new Map();
    for (const content of contents) {
        const { contentId, contentType } = (content ?? {});
        if (!isNonEmptyString(contentId) || !isGhostContentType(contentType)) {
            throw new TypeError('Replacement content requires a contentId and a contentType of "post" or "page".');
        }
        identities.set(contentId, contentType);
    }
    return identities;
};
const readRetainedObjectIDs = (fragments, identities) => {
    const represented = new Set();
    const retained = new Set();
    for (const fragment of fragments) {
        const record = (fragment ?? {});
        const { objectID, contentId } = record;
        if (!isNonEmptyString(objectID) ||
            !isNonEmptyString(contentId) ||
            identities.get(contentId) !== record.contentType) {
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
const browseContentIdentities = async (client, indexName) => {
    const records = [];
    try {
        await browseIdentityAttributes(client, indexName, ['objectID', 'slug', 'contentId', 'contentType'], hit => {
            if (!isNonEmptyString(hit.objectID)) {
                return;
            }
            records.push({
                objectID: hit.objectID,
                slug: toRecordString(hit.slug),
                contentId: toRecordString(hit.contentId),
                contentType: toRecordString(hit.contentType)
            });
        });
    }
    catch (error) {
        throw (0, errors_cjs_1.mapAlgoliaError)(error);
    }
    return records;
};
exports.browseContentIdentities = browseContentIdentities;
/**
 * Saves the complete replacement set for the supplied Ghost content and confirms every save
 * before deleting only that content's stale records, matched by `contentId`. Every supplied
 * content must be represented by at least one replacement record; an empty replacement makes no
 * requests. A browse denial (403) skips cleanup and reports it; a save failure prevents all
 * cleanup.
 */
const replaceContent = async (client, indexName, fragments, contents) => {
    if (!Array.isArray(fragments) || !Array.isArray(contents)) {
        throw new TypeError('Replacement requires fragment and content arrays.');
    }
    if (fragments.length === 0) {
        return { cleanupSkipped: false };
    }
    const identities = readReplacementIdentities(contents);
    const retained = readRetainedObjectIDs(fragments, identities);
    // The identity facet exists before any adapter activates these operations, so the browse
    // only visits the supplied content instead of the whole index.
    const filters = [...identities.keys()]
        .map(contentId => `contentId:${toFilterValue(contentId)}`)
        .join(' OR ');
    const isStale = (hit) => {
        return (isNonEmptyString(hit.objectID) &&
            isNonEmptyString(hit.contentId) &&
            identities.has(hit.contentId) &&
            !retained.has(hit.objectID));
    };
    try {
        const { stale, cleanupSkipped } = await collectStaleObjectIDs(client, indexName, ['objectID', 'contentId'], isStale, filters);
        await client.saveObjects({ indexName, objects: fragments, waitForTasks: true });
        await deleteStaleObjects(client, indexName, stale);
        return { cleanupSkipped };
    }
    catch (error) {
        throw (0, errors_cjs_1.mapAlgoliaError)(error);
    }
};
exports.replaceContent = replaceContent;
/**
 * Deletes every record that carries one Ghost content ID and waits for the deletion to finish.
 * Requires the `contentId` filter facet from the identity migration.
 */
const deleteContent = async (client, indexName, contentId) => {
    if (!isNonEmptyString(contentId)) {
        throw new TypeError('Content deletion requires a contentId.');
    }
    try {
        const { taskID } = await client.deleteBy({
            indexName,
            deleteByParams: { filters: `contentId:${toFilterValue(contentId)}` }
        });
        await client.waitForTask({ indexName, taskID });
    }
    catch (error) {
        throw (0, errors_cjs_1.mapAlgoliaError)(error);
    }
};
exports.deleteContent = deleteContent;
/**
 * Removes the package-managed records that a complete run no longer produces: records carrying
 * Ghost content identity whose object IDs are not in the retained replacement set. Records
 * without identity fields are never touched. Run it only after every replacement save is
 * confirmed. A browse denial (403) skips cleanup and reports it.
 */
const reconcileContent = async (client, indexName, fragments) => {
    if (!Array.isArray(fragments)) {
        throw new TypeError('Reconciliation requires the complete array of saved records.');
    }
    const retained = new Set();
    for (const fragment of fragments) {
        const record = (fragment ?? {});
        if (!isNonEmptyString(record.objectID)) {
            throw new TypeError('Reconciliation records require an objectID.');
        }
        retained.add(record.objectID);
    }
    const isStale = (hit) => {
        return (isNonEmptyString(hit.objectID) &&
            isNonEmptyString(hit.contentId) &&
            isGhostContentType(hit.contentType) &&
            !retained.has(hit.objectID));
    };
    try {
        const { stale, cleanupSkipped } = await collectStaleObjectIDs(client, indexName, ['objectID', 'contentId', 'contentType'], isStale);
        await deleteStaleObjects(client, indexName, stale);
        return { cleanupSkipped };
    }
    catch (error) {
        throw (0, errors_cjs_1.mapAlgoliaError)(error);
    }
};
exports.reconcileContent = reconcileContent;
//# sourceMappingURL=content-identity.cjs.map