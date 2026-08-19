import {extract} from '@tryghost/algolia-html-extractor';

import {FragmenterError, type RecordSizeIssue} from './errors.mjs';
import {groupFragmentsByAnchor} from './grouping.mjs';
import {resolvePolicy, type CreateAlgoliaRecordsOptions} from './policy.mjs';
import {prepareGhostContent, type GhostContent} from './projection.mjs';
import {createContentRecords, type AlgoliaRecord} from './records.mjs';

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
export const createAlgoliaRecords = (
    ghostContent: readonly GhostContent[],
    options?: CreateAlgoliaRecordsOptions
): readonly AlgoliaRecord[] => {
    const policy = resolvePolicy(options);
    if (!policy.ok) {
        throw new FragmenterError('INVALID_POLICY', policy.issues);
    }

    const prepared = prepareGhostContent(ghostContent, policy.policy);
    if (!prepared.ok) {
        throw new FragmenterError('INVALID_GHOST_CONTENT', prepared.issues);
    }

    const records: AlgoliaRecord[] = [];
    const issues: RecordSizeIssue[] = [];
    for (const content of prepared.contents) {
        const groups = groupFragmentsByAnchor(extract(content.html));
        const contentRecords = createContentRecords(content, groups);
        records.push(...contentRecords.records);
        issues.push(...contentRecords.issues);
    }

    if (issues.length > 0) {
        throw new FragmenterError('RECORD_TOO_LARGE', issues);
    }

    return records;
};
