import { extract } from '@tryghost/algolia-html-extractor';
import { groupFragmentsByAnchor, mergeRecordHtml } from './grouping.mjs';
export { createAlgoliaRecords } from './create-algolia-records.mjs';
export { FragmenterError } from './errors.mjs';
const toAlgoliaRecord = (ghostContent, group, index) => {
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
export const fragmentTransformer = (recordAccumulator, ghostContent) => {
    const groups = groupFragmentsByAnchor(extract(ghostContent.html));
    const records = groups.map((group, index) => toAlgoliaRecord(ghostContent, group, index));
    return [...recordAccumulator, ...records];
};
const projectLegacyRelations = (value, fieldName) => {
    const relations = value;
    if (!relations?.length) {
        return [];
    }
    if (typeof relations.forEach !== 'function') {
        throw new TypeError(`post.${fieldName}.forEach is not a function`);
    }
    const projected = [];
    relations.forEach(relation => {
        projected.push({ name: relation.name, slug: relation.slug });
    });
    return projected;
};
/**
 * @deprecated Retained for compatibility while the deep record-building API is introduced.
 */
export const transformToAlgoliaObject = (posts, ignoreSlugs) => {
    const algoliaObjects = [];
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
export default { fragmentTransformer, transformToAlgoliaObject };
//# sourceMappingURL=index.mjs.map