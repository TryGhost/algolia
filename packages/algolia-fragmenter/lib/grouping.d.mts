import type { ExtractionFragment } from '@tryghost/algolia-html-extractor';
export type NonEmptyFragments = readonly [ExtractionFragment, ...ExtractionFragment[]];
export type FragmentGroup = Readonly<{
    anchor: string | null;
    fragments: NonEmptyFragments;
}>;
/**
 * Collects extraction fragments into first-seen anchor groups. Non-adjacent fragments that
 * repeat an anchor join the existing group, which is the legacy grouping rule shared by the
 * deprecated wrappers and the deep record interface.
 */
export declare const groupFragmentsByAnchor: (fragments: readonly ExtractionFragment[]) => readonly FragmentGroup[];
/**
 * Merges the fragments of one record. The first fragment contributes its markup verbatim;
 * every later preformatted fragment contributes its text only.
 */
export declare const mergeRecordHtml: (fragments: readonly ExtractionFragment[]) => string;
//# sourceMappingURL=grouping.d.mts.map