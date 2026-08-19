import { type CreateAlgoliaRecordsOptions } from './policy.mjs';
import { type GhostContent } from './projection.mjs';
import { type AlgoliaRecord } from './records.mjs';
/**
 * Turns Ghost content into complete final Algolia records: projection, HTML extraction, legacy
 * anchor grouping, fallback records, deep links, identifiers, ranking metadata, and
 * deterministic record-size handling.
 *
 * The whole batch is validated before any record is returned. A deterministic policy, Ghost
 * content, or record-size problem throws one {@link FragmenterError} carrying every issue in
 * input order; a partial batch is never returned.
 *
 * @throws {FragmenterError} `INVALID_POLICY`, `INVALID_GHOST_CONTENT`, or `RECORD_TOO_LARGE`.
 */
export declare const createAlgoliaRecords: (ghostContent: readonly GhostContent[], options?: CreateAlgoliaRecordsOptions) => readonly AlgoliaRecord[];
//# sourceMappingURL=create-algolia-records.d.mts.map