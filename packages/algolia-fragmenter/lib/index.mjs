import { extract } from '@tryghost/algolia-html-extractor';
const createLegacyFragment = (fragment) => ({
    html: fragment.html,
    content: fragment.text,
    headings: [...fragment.headingPath],
    anchor: fragment.anchor,
    sourceTag: fragment.sourceTag,
    customRanking: {
        position: fragment.position,
        heading: fragment.headingRank
    }
});
const reduceFragmentsUnderHeadings = (groups, fragment) => {
    const existingGroup = groups.find(group => group.anchor === fragment.anchor);
    if (existingGroup === undefined) {
        groups.push(fragment);
        return groups;
    }
    existingGroup.html += fragment.sourceTag === 'pre' ? ` ${fragment.content}` : fragment.html;
    existingGroup.content += ` ${fragment.content}`;
    return groups;
};
const toAlgoliaRecord = (ghostContent, fragment, index) => {
    const { content: _content, sourceTag: _sourceTag, ...groupedFragment } = fragment;
    const url = fragment.anchor === null ? ghostContent.url : `${ghostContent.url}#${fragment.anchor}`;
    return {
        ...ghostContent,
        ...groupedFragment,
        url,
        objectID: `${ghostContent.objectID}_${index}`
    };
};
/**
 * @deprecated Retained for compatibility while the deep record-building API is introduced.
 */
export const fragmentTransformer = (recordAccumulator, ghostContent) => {
    const groupedFragments = extract(ghostContent.html)
        .map(createLegacyFragment)
        .reduce(reduceFragmentsUnderHeadings, []);
    const records = groupedFragments.map((fragment, index) => toAlgoliaRecord(ghostContent, fragment, index));
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