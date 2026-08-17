# Richer extraction-fragment representation

## Decision

The richer `@tryghost/algolia-html-extractor` interface returns emitted
extraction fragments only. Candidate discovery, parser-node identity, local
semantic-container identity, comparison normalization, precedence, and
duplicate suppression remain private extractor concerns.

The synchronous package-root operation remains:

```ts
export function extract(
    renderedHtml: string
): readonly ExtractionFragment[];
```

Its richer fragment representation is:

```ts
export type ElementFragmentSource = Readonly<{
    kind: 'element';
    tagName: string;
    selection: 'content' | 'card-heading-fallback';
}>;

export type AttributeFragmentSource = Readonly<{
    kind: 'attribute';
    tagName: 'img';
    attributeName: 'alt';
}>;

export type FragmentSource =
    | ElementFragmentSource
    | AttributeFragmentSource;

export type ExtractionFragment = Readonly<{
    html: string;
    text: string;
    headingPath: readonly string[];
    anchor: string | null;
    position: number;
    headingRank: HeadingRank;
    source: FragmentSource;
}>;
```

This replaces the compatibility interface's `sourceTag` with a source value
that can represent element text, an image alternative, and a card-heading
fallback without exposing parse5 nodes. The compatible release retains its
already-approved interface and exact output. The implementation and release
sequence decides the semver boundary for the richer default.

## Emission boundary

An **extraction candidate** is a possible unit of searchable rendered meaning
before the extractor applies descendant precedence and local duplicate
suppression. It may carry private processing facts such as:

- a traversal or parser-node identity;
- its local semantic-container identity;
- its normalized comparison key;
- whether compatibility precedence protects it; and
- a suppression reason.

None of those facts crosses the public seam. Suppressed candidates are absent
from the return value. Every returned value is an extraction fragment ready for
the fragmenter to group without filtering or reapplying semantic policy.

`position` remains the contiguous zero-based position of an emitted fragment.
It is ranking and ordering context, not stable source-node identity.

## Comparison normalization

The extractor compares rich candidates only within the local semantic
container established by the approved richer semantics. It derives the private
comparison key from preserved source text by:

1. applying Unicode NFC normalization;
2. trimming leading and trailing whitespace;
3. collapsing each internal JavaScript whitespace run to one ASCII space; and
4. applying deterministic Unicode lowercase conversion with
   `String.prototype.toLowerCase()`.

It does not remove punctuation or diacritics, decode URLs, stem words, or
rewrite the preserved `text` or `html` values. Compatibility fragments are
never suppressed. Identical keys in separate local semantic containers remain
separate meaning.

This normalization is extractor policy rather than public fragment data. Its
observable inclusion results are contractual, while its keys, container IDs,
and source IDs are not.

## HTML and text

Every extraction fragment exposes one uniform `html` string:

- an element source uses the selected element's trimmed serialized outer HTML;
- a card-heading fallback uses its selected heading element's trimmed
  serialized outer HTML; and
- an image-alternative source uses the preserved alternative text escaped for
  safe HTML text content, without an invented wrapper element.

This broadens `html` from "selected outer HTML" to **searchable fragment HTML**:
safe content that the fragmenter may group and index without switching on the
source. It does not promise sanitized arbitrary author HTML; element sources
retain the same rendered-HTML trust boundary as the compatibility interface.

`text` preserves the source value selected by the extractor. Trimming and
normalization decide eligibility and local equality but do not rewrite the
returned source text.

## Source contract

`source` describes the emitted meaning rather than parser identity:

- `kind: 'element'` carries the lowercase source `tagName`;
- `selection: 'content'` covers compatibility elements, general richer
  elements, supported card roles, and ordinary fallback containers;
- `selection: 'card-heading-fallback'` identifies the one heading selected when
  a supported heading-only card would otherwise emit nothing; and
- `kind: 'attribute'` identifies the supported `img` `alt` source.

The public element `tagName` remains a string so adding a fixture-backed card
adapter does not require widening a closed tag-name union. The attribute arm is
deliberately narrow because the approved semantics define only meaningful
image alternatives as attribute-derived meaning.

The source value is immutable data. It never contains a parse5 node, candidate
ID, CSS selector, card adapter name, caller-defined profile, or callback.

## Fragmenter boundary

The fragmenter consumes all richer fragments through the same shape:

- `html` and `text` feed legacy-compatible grouping;
- `headingPath`, `anchor`, `position`, and `headingRank` retain their approved
  meanings; and
- `source.kind === 'element' && source.tagName === 'pre'` preserves the special
  preformatted merge rule.

It does not compare normalized meaning, suppress duplicates, interpret image
alternatives, escape attribute values, choose card headings, or know card
adapters. Anchor grouping, deep links, complete-record packing, Ghost content
projection, final IDs, and Algolia record construction remain fragmenter
responsibilities.

## Package and compatibility contract

The richer interface keeps the approved package shape:

- one synchronous named `extract` function at the package root;
- strict TypeScript source;
- generated ESM and synchronous CommonJS runtime and declaration artifacts;
- no options, selectors, parser injection, card configuration, or public
  subpaths; and
- native input and runtime errors.

The compatibility-first fragment stream and final Algolia records remain exact
in their release slice. Richer semantics deliberately add fragments and evolve
the source representation, so they ship only through the separately reviewed
follow-on boundary owned by the compatible implementation and release
sequence.

## Rejected representations

### Public candidates

Returning included and suppressed candidates would expose normalization keys,
local scopes, parser traversal identities, and suppression reasons that the
fragmenter does not use. Those internal mechanisms would become versioned
public contracts without enabling a caller recovery action.

### Source-specific payloads

Returning outer HTML only for element sources while attributes and fallbacks
carry raw values would preserve the old narrow `html` wording. It would also
force the fragmenter and every other consumer to escape attributes, invent
fallback markup, and track future source variants. Searchable fragment HTML
belongs with the extractor that understands the source.

### Caller-configurable card policy

Public profiles, selectors, adapters, and callbacks would move fixture-backed
Ghost semantics to callers and permanently expose parser and card structure.
The extractor continues to own one reviewed semantic policy.

## Evidence

- [Interactive prototype](https://github.com/TryGhost/algolia/blob/2799cadffc30fbe85ec0dc67fe0f72ee6c4956f5/packages/algolia-html-extractor/prototype/PROTOTYPE-richer-fragment-representation.html)
- [Strict TypeScript prototype source](https://github.com/TryGhost/algolia/blob/2799cadffc30fbe85ec0dc67fe0f72ee6c4956f5/packages/algolia-html-extractor/prototype/PROTOTYPE-richer-fragment-representation.ts)
- [Richer rendered-HTML extraction semantics](richer-rendered-html-extraction-semantics.md)
- [Public HTML extractor interface](public-html-extractor-interface.md)
- [Design the richer extraction-fragment representation](https://github.com/TryGhost/algolia/issues/208)
- [`CONTEXT.md`](../../CONTEXT.md)
