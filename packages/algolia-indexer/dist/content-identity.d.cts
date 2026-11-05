/**
 * Ghost content identity operations for the Algolia indexer.
 *
 * These primitives group, replace, delete, and reconcile package-managed records by the stable
 * Ghost content ID carried in the protected `contentId` and `contentType` record fields, rather
 * than by mutable slug. They stay dormant until an adapter opts in after the guarded one-time
 * identity migration; nothing here reads or writes index settings.
 */
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
export type CleanupOutcome = Readonly<{
    cleanupSkipped: boolean;
}>;
type AlgoliaRecord = Readonly<Record<string, unknown>>;
type BrowsePage = Readonly<{
    hits: readonly AlgoliaRecord[];
}>;
export type ContentIdentityClient = Readonly<{
    browseObjects(options: {
        indexName: string;
        browseParams: {
            attributesToRetrieve: readonly string[];
            filters?: string;
        };
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
        deleteByParams: {
            filters: string;
        };
    }): Promise<{
        taskID: number;
    }>;
    waitForTask(options: {
        indexName: string;
        taskID: number;
    }): Promise<unknown>;
}>;
/**
 * Browses every record's identity attributes: physical object ID, navigation slug, and the
 * protected Ghost content identity fields. Records that predate the identity migration come back
 * with `null` identity values so callers can classify them. Call with an initialized client.
 */
export declare const browseContentIdentities: (client: ContentIdentityClient, indexName: string) => Promise<readonly RecordIdentity[]>;
/**
 * Saves the complete replacement set for the supplied Ghost content and confirms every save
 * before deleting only that content's stale records, matched by `contentId`. Every supplied
 * content must be represented by at least one replacement record; an empty replacement makes no
 * requests. A browse denial (403) skips cleanup and reports it; a save failure prevents all
 * cleanup.
 */
export declare const replaceContent: (client: ContentIdentityClient, indexName: string, fragments: unknown, contents: unknown) => Promise<CleanupOutcome>;
/**
 * Deletes every record that carries one Ghost content ID and waits for the deletion to finish.
 * Requires the `contentId` filter facet from the identity migration.
 */
export declare const deleteContent: (client: ContentIdentityClient, indexName: string, contentId: unknown) => Promise<void>;
/**
 * Removes the package-managed records that a complete run no longer produces: records carrying
 * Ghost content identity whose object IDs are not in the retained replacement set. Records
 * without identity fields are never touched. Run it only after every replacement save is
 * confirmed. A browse denial (403) skips cleanup and reports it.
 */
export declare const reconcileContent: (client: ContentIdentityClient, indexName: string, fragments: unknown) => Promise<CleanupOutcome>;
export {};
//# sourceMappingURL=content-identity.d.cts.map