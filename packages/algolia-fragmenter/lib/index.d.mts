import type { GhostContent } from './projection.mjs';
import type { AlgoliaRecord } from './records.mjs';
export { createAlgoliaRecords } from './create-algolia-records.mjs';
export { FragmenterError } from './errors.mjs';
export type { ExpectedValueType, FragmenterErrorCode, FragmenterIssue, GhostContentIssue, GhostContentIssueReason, PolicyIssue, PolicyIssueReason, RecordSizeIssue } from './errors.mjs';
export type { ContentProjection, CreateAlgoliaRecordsOptions, OptionalProjectionSource, ProjectionField, RankingField, RankingSource } from './policy.mjs';
export type { GhostContent } from './projection.mjs';
export type { AlgoliaRecord } from './records.mjs';
/**
 * @deprecated Retained for compatibility while the deep record-building API is introduced.
 */
export declare const fragmentTransformer: (recordAccumulator: AlgoliaRecord[], ghostContent: AlgoliaRecord) => AlgoliaRecord[];
/**
 * @deprecated Retained for compatibility while the deep record-building API is introduced.
 */
export declare const transformToAlgoliaObject: (posts: readonly GhostContent[], ignoreSlugs?: readonly string[]) => AlgoliaRecord[];
declare const _default: {
    fragmentTransformer: typeof fragmentTransformer;
    transformToAlgoliaObject: typeof transformToAlgoliaObject;
};
export default _default;
//# sourceMappingURL=index.d.mts.map