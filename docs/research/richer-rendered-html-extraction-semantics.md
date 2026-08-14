# Richer rendered-HTML extraction semantics

## Decision

A follow-on extractor version should extract **searchable rendered meaning** from
Ghost-rendered HTML. This is an additive semantic layer over the
compatibility-first release: the observable extraction of `p`, `pre`, `td`, and
`li` elements remains unchanged, including its existing traversal, whitespace,
heading, anchor, position, and duplication behaviour.

Searchable rendered meaning is author-controlled meaning intended for readers.
It includes meaningful text that is not necessarily visible, such as an image
alternative, but excludes generated controls and states, provider chrome, URLs,
decorative content, and content explicitly marked as non-semantic.

## Semantic selection

The richer layer emits the smallest qualifying semantic units in document
order. It must not add a container fragment when qualifying descendants already
represent the same meaning. A wrapper is a fallback only when it contains
otherwise-unrepresented searchable meaning.

Compatibility-preserved `p`, `pre`, `td`, and `li` elements count as qualifying
descendants for this precedence rule. For example,
`<blockquote><p>Quote</p><cite>Author</cite></blockquote>` emits the legacy `p`
and the rich `cite`, but no duplicate `blockquote`; a plain
`<blockquote>Quote</blockquote>` emits the `blockquote` fallback. Likewise,
`<figcaption><p>Caption</p></figcaption>` emits the legacy `p` rather than a
duplicate `figcaption`, while a plain-text `figcaption` emits a rich fragment.

Add these general semantic units:

- `th` for table headers, alongside compatibility-preserved `td` cells;
- `figcaption` for authored image, gallery, video, or embed captions;
- `cite` for quote attribution;
- `blockquote` only when qualifying descendants do not already represent the
  quote; and
- a non-empty meaningful `img` alternative as attribute-derived meaning.

New element text preserves its source value. Trimmed text determines whether a
candidate is empty. A normalized comparison key suppresses duplicate meaning,
such as an image alternative repeated by its caption, without rewriting the
preserved source value. The richer public-interface decision owns the exact
comparison normalization.

Duplicate suppression applies only among rich candidates within the same local
semantic container, such as an image and its figure caption. It never removes,
rewrites, or suppresses a compatibility fragment, and it does not deduplicate
identical meaning repeated in separate parts of the document.

An image alternative is excluded when it is empty or whitespace-only, repeated
by a caption, explicitly non-semantic, or part of known renderer-generated
chrome such as an audio thumbnail. The extractor must not attempt subjective
quality scoring of author-provided alternative text.

Attribute-derived image meaning occurs at the image's document position, before
a following caption.

## Ghost card boundaries

A Ghost card wrapper is not itself evidence that all of its text is searchable.
Supported cards need explicit, fixture-backed adapters that identify authored
semantic roles.

Include authored titles, headings, descriptions, captions, substantive text,
and editorial labels from supported cards. This includes meaningful content in
image, gallery, blockquote, button, callout, file, header, product, toggle,
audio, video, and signup structures when that content satisfies the semantic
selection rules.

Exclude:

- player controls, current time, duration, playback rate, and volume state;
- file names, file sizes, download chrome, and media-thumbnail placeholders;
- form inputs, placeholders, validation, loading, success, and error states;
- decorative emoji and SVG control text;
- provider-supplied bookmark, embed, and NFT metadata;
- source URLs, link targets, media URLs, and dimensions; and
- arbitrary descendant text from an unknown card or raw wrapper.

Unknown cards and raw HTML contribute only descendants covered by the general
semantic rules. A new card adapter is added only after a controlled
Ghost-rendered fixture proves where its authored meaning ends and its chrome
begins. Card support follows structural roles and Ghost-owned `kg-*` boundaries,
not a generic all-card selector.

## Non-semantic subtrees

For new semantic roles, ignore candidates inside `script`, `style`, `template`,
`noscript`, and SVG chrome, or inside a subtree marked with `hidden`, `inert`, or
`aria-hidden="true"`. Card adapters additionally exclude their known control and
state regions.

Do not evaluate stylesheets or infer visual visibility from classes or inline
CSS. These exclusions do not remove or rewrite compatibility-preserved `p`,
`pre`, `td`, or `li` fragments; changing those existing observations would be a
separate breaking semantics decision.

## Heading, anchor, and card-only behaviour

New fragments inherit the active compatibility heading path, heading rank, and
heading-derived anchor. Card-internal `h1` through `h6` elements retain their
existing effect on that state. IDs or names on cards and semantic content
elements do not establish new anchors.

Ordinary headings remain context rather than independent fragments. When a
supported card contains authored headings but no other qualifying semantic
unit, emit one fallback card-heading fragment so a heading-only card is not
lost.

A card-only content item emits fragments when it contains qualifying meaning,
such as an image alternative, caption, callout, or authored card heading. A card
with no qualifying meaning emits no placeholder fragment. Whether a Ghost
content title or other projected field should create an Algolia record without
an extraction fragment belongs to the separate field-projection decision.

## Compatibility and public-interface consequences

Richer semantics are not part of the compatibility-first extractor release.
They deliberately change fragment streams and final Algolia records, so they
belong in a separately reviewed follow-on release.

The compatibility interface cannot express all of this policy unchanged:

- `ExtractedTagName` currently names only `p`, `pre`, `td`, and `li`;
- `html` currently promises a selected element's serialized outer HTML;
- image alternatives are attribute-derived rather than DOM `textContent`; and
- a fallback card-heading fragment may represent a semantic role rather than a
  legacy selected element.

A follow-on prototype decision must define the richer extraction-fragment
representation, including element and attribute sources, `html`, `text`, source
identity, comparison normalization, and generated ESM/CommonJS declarations.
The Ghost field-projection decision separately owns which fragment and projected
fields become searchable Algolia record attributes.

## Evidence and verification consequences

The compact Ghost-rendered evidence corpus should reuse its intentional-gap
family for table headers, captions, blockquotes, and image alternatives, then add
only the structurally distinct card specimens needed by settled adapters.

Offline tests should cover:

- `th` and `td` ordering;
- plain and nested blockquotes, including `p` and `cite` descendants;
- empty, meaningful, repeated, and renderer-generated image alternatives;
- caption ordering and alternative/caption deduplication;
- supported card roles beside excluded controls and states;
- hidden, inert, `aria-hidden`, SVG, and raw-wrapper boundaries;
- card-internal heading state and heading-only fallback;
- card-only content with and without qualifying meaning; and
- unchanged complete compatibility records for legacy-selected content.

Required pull-request verification remains deterministic and offline. The live
structural census may identify card shapes needing controlled reproduction, but
mutable editorial content never becomes fixture data or an exact CI assertion.

## Sources

- [Ghost theme content and editor-card output](https://docs.ghost.org/themes/content)
- [Legacy extraction compatibility contract](legacy-extraction-compatibility-contract.md)
- [Ghost HTML evidence corpus](ghost-html-evidence-corpus.md)
- [Public HTML extractor interface](public-html-extractor-interface.md)
- [Decide richer rendered-HTML extraction semantics](https://github.com/TryGhost/algolia/issues/197)
- [Decide the Ghost field projection and excerpt contract](https://github.com/TryGhost/algolia/issues/196)
- [`CONTEXT.md`](../../CONTEXT.md)
