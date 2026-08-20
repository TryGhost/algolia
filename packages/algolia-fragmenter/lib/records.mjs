import { Buffer } from 'node:buffer';
import { mergeRecordHtml } from './grouping.mjs';
const MAX_RECORD_BYTES = 9_999;
const FALLBACK_POSITION = 0;
const FALLBACK_HEADING_RANK = 100;
export const measureRecordBytes = (record) => {
    return Buffer.byteLength(JSON.stringify(record), 'utf8');
};
const assembleRecord = (content, parts) => ({
    objectID: parts.objectID,
    slug: content.slug,
    url: parts.url,
    html: parts.html,
    title: content.title,
    headings: [...parts.headings],
    anchor: parts.anchor,
    ...content.projected,
    customRanking: {
        position: parts.position,
        heading: parts.heading,
        ...content.rankingSiblings
    }
});
const createObjectID = (content, groupIndex, continuationIndex) => {
    const groupObjectID = `${content.id}_${groupIndex}`;
    return continuationIndex === 0 ? groupObjectID : `${groupObjectID}_${continuationIndex}`;
};
const buildFragmentRecord = (content, groupIndex, continuationIndex, packedFragments) => {
    const [first] = packedFragments;
    return assembleRecord(content, {
        objectID: createObjectID(content, groupIndex, continuationIndex),
        url: first.anchor === null ? content.url : `${content.url}#${first.anchor}`,
        html: mergeRecordHtml(packedFragments),
        headings: first.headingPath,
        anchor: first.anchor,
        position: first.position,
        heading: first.headingRank
    });
};
const createSizeIssue = (content, objectID, fragment, bytes) => {
    const path = `ghostContent[${content.index}]`;
    const excess = bytes - MAX_RECORD_BYTES;
    const cause = fragment === null
        ? `fallback record needs ${bytes} UTF-8 bytes (${excess} over the ${MAX_RECORD_BYTES}-byte ceiling). Shorten the required projected metadata.`
        : `fragment at source position ${fragment.position} needs ${bytes} UTF-8 bytes (${excess} over the ${MAX_RECORD_BYTES}-byte ceiling). Shorten the indivisible source element or required projected metadata.`;
    return {
        kind: 'size',
        reason: 'record-too-large',
        path,
        index: content.index,
        contentId: content.id,
        objectID,
        anchor: fragment === null ? null : fragment.anchor,
        position: fragment === null ? null : fragment.position,
        bytes,
        limit: MAX_RECORD_BYTES,
        excess,
        message: `${path}: content "${content.id}" ${cause}`
    };
};
/**
 * Greedily packs whole extraction fragments into records that stay within the record byte
 * ceiling. A candidate is always measured under the continuation index it would be emitted
 * with, so the identifier growth of a continuation is inside the measurement. An indivisible
 * fragment yields an issue rather than a truncated record, and consumes no continuation index.
 */
const packAnchorGroup = (content, groupIndex, group) => {
    const records = [];
    const issues = [];
    let packedFragments = null;
    let continuationIndex = 0;
    for (const fragment of group.fragments) {
        const candidate = packedFragments === null ? [fragment] : [...packedFragments, fragment];
        const candidateBytes = measureRecordBytes(buildFragmentRecord(content, groupIndex, continuationIndex, candidate));
        if (candidateBytes <= MAX_RECORD_BYTES) {
            packedFragments = candidate;
            continue;
        }
        if (packedFragments === null) {
            issues.push(createSizeIssue(content, createObjectID(content, groupIndex, continuationIndex), fragment, candidateBytes));
            continue;
        }
        records.push(buildFragmentRecord(content, groupIndex, continuationIndex, packedFragments));
        continuationIndex += 1;
        const single = [fragment];
        const singleBytes = measureRecordBytes(buildFragmentRecord(content, groupIndex, continuationIndex, single));
        if (singleBytes > MAX_RECORD_BYTES) {
            issues.push(createSizeIssue(content, createObjectID(content, groupIndex, continuationIndex), fragment, singleBytes));
            packedFragments = null;
            continue;
        }
        packedFragments = single;
    }
    if (packedFragments !== null) {
        records.push(buildFragmentRecord(content, groupIndex, continuationIndex, packedFragments));
    }
    return { records, issues };
};
const createFallbackRecord = (content) => {
    const objectID = `${content.id}_0`;
    const record = assembleRecord(content, {
        objectID,
        url: content.url,
        html: '',
        headings: [],
        anchor: null,
        position: FALLBACK_POSITION,
        heading: FALLBACK_HEADING_RANK
    });
    const bytes = measureRecordBytes(record);
    if (bytes > MAX_RECORD_BYTES) {
        return { records: [], issues: [createSizeIssue(content, objectID, null, bytes)] };
    }
    return { records: [record], issues: [] };
};
/**
 * Builds every Algolia record for one prepared Ghost content item in anchor-group order, then
 * continuation order. Content without extraction fragments emits the single fallback record.
 */
export const createContentRecords = (content, groups) => {
    if (groups.length === 0) {
        return createFallbackRecord(content);
    }
    const records = [];
    const issues = [];
    for (const [groupIndex, group] of groups.entries()) {
        const packed = packAnchorGroup(content, groupIndex, group);
        records.push(...packed.records);
        issues.push(...packed.issues);
    }
    return { records, issues };
};
//# sourceMappingURL=records.mjs.map