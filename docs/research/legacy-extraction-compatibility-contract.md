# Legacy extraction compatibility contract

## Decision

The compatibility-first `@tryghost/algolia-html-extractor` release must preserve the final Algolia records produced by the current fragmenter exactly. Compatibility is judged at the public record seam, not by reproducing unused internals of `algolia-html-extractor@0.0.1`.

## Observable extraction behaviour

- Parse an HTML string with browser-compatible HTML5 tree construction.
- Visit `h1` through `h6` and selected `p`, `pre`, `td`, and `li` elements in document order, including nested selected elements.
- Track six heading levels. A heading replaces its own level and clears every deeper level; skipped levels remain absent from the emitted heading path.
- Extract heading and selected-node content with DOM `textContent` semantics.
- Ignore a selected node only when its text content has length zero. Whitespace-only content remains observable.
- Serialize selected nodes as trimmed `outerHTML`.
- Prefer a heading's `name`, then its `id`, then the first descendant carrying `name` or `id` as its anchor.
- Preserve the previous anchor when a later heading has no anchor. This surprising carry-forward behaviour is part of parity.
- Number only emitted, non-empty selected nodes from zero.
- Rank content outside headings at 100, under `h1` at 90, decreasing by 10 per level through `h6` at 40.

## Observable fragmenter behaviour

- Group extraction fragments by strict anchor equality within one Ghost content item, preserving the first occurrence's position, headings, ranking, and order.
- Merge all unanchored fragments into the first `null`-anchor group; merge repeated anchors even when they occur in separate parts of the document.
- Append ordinary selected-node HTML without a separator and append its text with one leading space.
- When merging a `pre` node, discard its markup and append its text with one leading space to both accumulated HTML and text.
- Remove the extractor's DOM node and text fields before producing records.
- Ignore the extractor's generated ID. Assign final IDs as `<Ghost content id>_<group index>`.
- Add `#<anchor>` to the Ghost content URL when the group has an anchor.
- Spread the grouped extraction fields over the post projection to create the final Algolia record.

## Non-contract internals

The replacement does not need to preserve the abandoned package's constructor shape, MD5 generator, generic CSS-selector API, tag-exclusion option, exposed DOM node, or `object.omit` usage unless the separate public-API decision deliberately adopts one of them.

## Parity evidence required

Differential tests must compare complete final records and cover:

- every heading level, skipped levels, and hierarchy resets;
- direct `name`, direct `id`, descendant anchors, missing anchors, and repeated anchors;
- headingless content and multiple unanchored elements;
- `p`, `pre`, `td`, and `li` order, including nested selected elements;
- empty and whitespace-only nodes;
- inline markup, entities, Unicode, void elements, and exact serialization;
- malformed HTML and table tree construction;
- merge order, deep-link URLs, ranking, and final IDs;
- representative Ghost 6 rendered HTML from the reviewed fixture corpus.

Real Ghost output contains cards, captions, image alternative text, table headers, blockquotes, and other structures outside the legacy selector. Ignoring those structures remains intentional in the compatibility release; richer extraction belongs to its own decision.

## Sources

- [`algolia-html-extractor` implementation](https://github.com/stonecircle/html-extractor/blob/master/lib/algoliaHtmlExtractor.js)
- [Original Algolia Ruby extractor](https://github.com/algolia/html-extractor/blob/develop/lib/algolia_html_extractor.rb)
- [Ghost Content API posts](https://docs.ghost.org/content-api/posts)
- `packages/algolia-fragmenter/lib/transformer.js`
- `packages/algolia-fragmenter/test/fragmenter.test.js`
- `packages/algolia/test/cli-ghost-v6.acceptance.test.js`
