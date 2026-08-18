import {extract, type ExtractedTagName, type HeadingRank} from '@tryghost/algolia-html-extractor';

export type GhostContent = Readonly<Record<string, unknown>>;

export type AlgoliaRecord = Record<string, unknown>;

type GhostRelation = Readonly<Record<string, unknown>>;

type LegacyRelationCollection = {
    length: number;
    forEach(callback: (relation: GhostRelation) => void): void;
};

type GroupedFragment = {
    html: string;
    headings: string[];
    anchor: string | null;
    customRanking: {
        position: number;
        heading: HeadingRank;
    };
};

type LegacyFragment = GroupedFragment & {
    content: string;
    sourceTag: ExtractedTagName;
};

const createLegacyFragment = (fragment: ReturnType<typeof extract>[number]): LegacyFragment => ({
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

const reduceFragmentsUnderHeadings = (
    groups: LegacyFragment[],
    fragment: LegacyFragment
): LegacyFragment[] => {
    const existingGroup = groups.find(group => group.anchor === fragment.anchor);
    if (existingGroup === undefined) {
        groups.push(fragment);
        return groups;
    }

    existingGroup.html += fragment.sourceTag === 'pre' ? ` ${fragment.content}` : fragment.html;
    existingGroup.content += ` ${fragment.content}`;
    return groups;
};

const toAlgoliaRecord = (
    ghostContent: AlgoliaRecord,
    fragment: LegacyFragment,
    index: number
): AlgoliaRecord => {
    const {content: _content, sourceTag: _sourceTag, ...groupedFragment} = fragment;
    const url =
        fragment.anchor === null ? ghostContent.url : `${ghostContent.url}#${fragment.anchor}`;

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
export const fragmentTransformer = (
    recordAccumulator: AlgoliaRecord[],
    ghostContent: AlgoliaRecord
): AlgoliaRecord[] => {
    const groupedFragments = extract(ghostContent.html as string)
        .map(createLegacyFragment)
        .reduce(reduceFragmentsUnderHeadings, []);
    const records = groupedFragments.map((fragment, index) =>
        toAlgoliaRecord(ghostContent, fragment, index)
    );

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
