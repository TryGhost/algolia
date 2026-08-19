import type { RecordSizeIssue } from './errors.mjs';
import { type FragmentGroup } from './grouping.mjs';
import type { PreparedContent } from './projection.mjs';
export type AlgoliaRecord = Record<string, unknown>;
export type ContentRecords = Readonly<{
    records: readonly AlgoliaRecord[];
    issues: readonly RecordSizeIssue[];
}>;
export declare const measureRecordBytes: (record: AlgoliaRecord) => number;
/**
 * Builds every Algolia record for one prepared Ghost content item in anchor-group order, then
 * continuation order. Content without extraction fragments emits the single fallback record.
 */
export declare const createContentRecords: (content: PreparedContent, groups: readonly FragmentGroup[]) => ContentRecords;
//# sourceMappingURL=records.d.mts.map