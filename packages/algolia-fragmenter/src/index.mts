import {extract} from '@tryghost/algolia-html-extractor';

import {groupFragmentsByAnchor, mergeRecordHtml, type FragmentGroup} from './grouping.mjs';
import type {GhostContent} from './projection.mjs';
import type {AlgoliaRecord} from './records.mjs';

export {createAlgoliaRecords} from './create-algolia-records.mjs';
export {FragmenterError} from './errors.mjs';
export type {
    ExpectedValueType,
    FragmenterErrorCode,
    FragmenterIssue,
    GhostContentIssue,
    GhostContentIssueReason,
    PolicyIssue,
    PolicyIssueReason,
    RecordSizeIssue
} from './errors.mjs';
export type {
    ContentProjection,
    CreateAlgoliaRecordsOptions,
    OptionalProjectionSource,
    ProjectionField,
    RankingField,
    RankingSource
} from './policy.mjs';
export type {GhostContent} from './projection.mjs';
export type {AlgoliaRecord} from './records.mjs';

type GhostRelation = Readonly<Record<string, unknown>>;

type LegacyRelationCollection = {
    length: number;
    forEach(callback: (relation: GhostRelation) => void): void;
};

const toAlgoliaRecord = (
    ghostContent: AlgoliaRecord,
    group: FragmentGroup,
    index: number
): AlgoliaRecord => {
    const [first] = group.fragments;
    const url = group.anchor === null ? ghostContent.url : `${ghostContent.url}#${group.anchor}`;

    return {
        ...ghostContent,
        html: mergeRecordHtml(group.fragments),
        headings: [...first.headingPath],
        anchor: group.anchor,
        customRanking: {
            position: first.position,
            heading: first.headingRank
        },
        url,
        objectID: `${ghostContent.objectID}_${index}`
    };
};

/**
 * @deprecated Retained for compatibility while the deep record-building API is introduced.
 */
export const fragmentTransformer = (
    recordAccumulator: AlgoliaRecord[],
    ghostContent: AlgoliaRecord
): AlgoliaRecord[] => {
    const groups = groupFragmentsByAnchor(extract(ghostContent.html as string));
    const records = groups.map((group, index) => toAlgoliaRecord(ghostContent, group, index));

    return [...recordAccumulator, ...records];
};

const projectLegacyRelations = (
    value: unknown,
    fieldName: 'tags' | 'authors'
): Array<{name: unknown; slug: unknown}> => {
    const relations = value as Partial<LegacyRelationCollection> | null | undefined;
    if (!relations?.length) {
        return [];
    }
    if (typeof relations.forEach !== 'function') {
        throw new TypeError(`post.${fieldName}.forEach is not a function`);
    }

    const projected: Array<{name: unknown; slug: unknown}> = [];
    relations.forEach(relation => {
        projected.push({name: relation.name, slug: relation.slug});
    });
    return projected;
};

/**
 * @deprecated Retained for compatibility while the deep record-building API is introduced.
 */
export const transformToAlgoliaObject = (
    posts: readonly GhostContent[],
    ignoreSlugs?: readonly string[]
): AlgoliaRecord[] => {
    const algoliaObjects: AlgoliaRecord[] = [];

    for (const post of posts) {
        if (ignoreSlugs?.some(slug => slug === post.slug)) {
            continue;
        }

        algoliaObjects.push({
            objectID: post.id,
            slug: post.slug,
            url: post.url,
            html: post.html,
            image: post.feature_image,
            title: post.title,
            tags: projectLegacyRelations(post.tags, 'tags'),
            authors: projectLegacyRelations(post.authors, 'authors')
        });
    }

    return algoliaObjects;
};

export default {fragmentTransformer, transformToAlgoliaObject};
