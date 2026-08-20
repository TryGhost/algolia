/**
 * Collects extraction fragments into first-seen anchor groups. Non-adjacent fragments that
 * repeat an anchor join the existing group, which is the legacy grouping rule shared by the
 * deprecated wrappers and the deep record interface.
 */
export const groupFragmentsByAnchor = (fragments) => {
    const groups = [];
    for (const fragment of fragments) {
        const existingGroup = groups.find(group => group.anchor === fragment.anchor);
        if (existingGroup === undefined) {
            groups.push({ anchor: fragment.anchor, fragments: [fragment] });
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
export const mergeRecordHtml = (fragments) => {
    return fragments
        .map((fragment, index) => index > 0 && fragment.sourceTag === 'pre' ? ` ${fragment.text}` : fragment.html)
        .join('');
};
//# sourceMappingURL=grouping.mjs.map