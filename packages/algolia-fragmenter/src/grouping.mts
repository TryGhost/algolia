import type {ExtractionFragment, RichExtractionFragment} from '@tryghost/algolia-html-extractor';

export type RecordFragment = ExtractionFragment | RichExtractionFragment;

export type NonEmptyFragments = readonly [RecordFragment, ...RecordFragment[]];

export type FragmentGroup = Readonly<{
    anchor: string | null;
    fragments: NonEmptyFragments;
}>;

type MutableFragmentGroup = {
    anchor: string | null;
    fragments: [RecordFragment, ...RecordFragment[]];
};

/**
 * Collects extraction fragments into first-seen anchor groups. Non-adjacent fragments that
 * repeat an anchor join the existing group, which is the legacy grouping rule shared by the
 * deprecated wrappers and the deep record interface.
 */
export const groupFragmentsByAnchor = (
    fragments: readonly RecordFragment[]
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

const isPreformatted = (fragment: RecordFragment): boolean => {
    return 'sourceTag' in fragment
        ? fragment.sourceTag === 'pre'
        : fragment.source.kind === 'element' && fragment.source.tagName === 'pre';
};

/**
 * Merges the fragments of one record. The first fragment contributes its markup verbatim;
 * every later preformatted fragment contributes its text only.
 */
export const mergeRecordHtml = (fragments: readonly RecordFragment[]): string => {
    return fragments
        .map((fragment, index) =>
            index > 0 && isPreformatted(fragment) ? ` ${fragment.text}` : fragment.html
        )
        .join('');
};
