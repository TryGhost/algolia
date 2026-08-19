import type {ExtractionFragment} from '@tryghost/algolia-html-extractor';

export type NonEmptyFragments = readonly [ExtractionFragment, ...ExtractionFragment[]];

export type FragmentGroup = Readonly<{
    anchor: string | null;
    fragments: NonEmptyFragments;
}>;

type MutableFragmentGroup = {
    anchor: string | null;
    fragments: [ExtractionFragment, ...ExtractionFragment[]];
};

/**
 * Collects extraction fragments into first-seen anchor groups. Non-adjacent fragments that
 * repeat an anchor join the existing group, which is the legacy grouping rule shared by the
 * deprecated wrappers and the deep record interface.
 */
export const groupFragmentsByAnchor = (
    fragments: readonly ExtractionFragment[]
): readonly FragmentGroup[] => {
    const groups: MutableFragmentGroup[] = [];
    for (const fragment of fragments) {
        const existingGroup = groups.find(group => group.anchor === fragment.anchor);
        if (existingGroup === undefined) {
            groups.push({anchor: fragment.anchor, fragments: [fragment]});
            continue;
        }
        existingGroup.fragments.push(fragment);
    }

    return groups;
};

/**
 * Merges the fragments of one record. The first fragment contributes its markup verbatim;
 * every later preformatted fragment contributes its text only.
 */
export const mergeRecordHtml = (fragments: readonly ExtractionFragment[]): string => {
    return fragments
        .map((fragment, index) =>
            index > 0 && fragment.sourceTag === 'pre' ? ` ${fragment.text}` : fragment.html
        )
        .join('');
};
