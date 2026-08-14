# Public HTML extractor interface

## Decision

`@tryghost/algolia-html-extractor` exposes one synchronous named function at its package root:

```ts
export type ExtractedTagName = 'p' | 'pre' | 'td' | 'li';

export type HeadingRank = 40 | 50 | 60 | 70 | 80 | 90 | 100;

export type ExtractionFragment = Readonly<{
    html: string;
    text: string;
    headingPath: readonly string[];
    anchor: string | null;
    position: number;
    headingRank: HeadingRank;
    sourceTag: ExtractedTagName;
}>;

export function extract(renderedHtml: string): readonly ExtractionFragment[];
```

The package has no default export, class, factory, configuration object, parser injection, or public subpath. Its interface is rendered HTML in and ordered extraction fragments out.

All source, tests, build tooling, and smoke tooling added for this package must be authored in strict TypeScript. ESM and CommonJS JavaScript, source maps, and declarations are generated artifacts and must not be hand-authored or hand-edited.

## Module contract

The strict TypeScript implementation produces conditional package exports:

- ESM consumers import the named `extract` function from the generated `index.mjs` entry and receive `index.d.mts` declarations.
- CommonJS consumers synchronously require the same named `extract` function from the generated `index.cjs` entry and receive `index.d.cts` declarations.
- The package root `.` is the only public export seam.
- Runtime and declaration acceptance tests cover both module conditions from a clean packed package.

```ts
import {
    extract,
    type ExtractionFragment
} from '@tryghost/algolia-html-extractor';

const fragments: readonly ExtractionFragment[] = extract(ghostContent.html);
```

CommonJS callers use the equivalent namespace shape:

```ts
import extractor = require('@tryghost/algolia-html-extractor');

const fragments = extractor.extract(ghostContent.html);
```

The package pins `parse5@7.3.0` as a direct runtime dependency. Parse5 types, tree-adapter nodes, traversal primitives, and serialization functions remain behind the package seam.

## Extraction-fragment contract

- `html` is the selected element's trimmed serialized outer HTML.
- `text` uses DOM `textContent` semantics.
- `headingPath` contains the non-empty active heading values in level order.
- `anchor` is the current heading anchor or `null`, including the legacy anchor carry-forward behaviour.
- `position` is a contiguous zero-based number assigned only to emitted extraction fragments.
- `headingRank` is `100` outside a heading and decreases from `90` for `h1` to `40` for `h6`.
- `sourceTag` exposes the smallest source fact the fragmenter needs to preserve the legacy special handling of merged `pre` elements without exposing an HTML node.

Extraction fragments are immutable values returned in document order, including nested selected elements. The implementation is deterministic and performs no I/O.

The HTML extractor owns HTML5 parsing, traversal, selected-element recognition, text extraction, serialization, six-level heading state, anchor discovery, empty-content filtering, position numbering, and heading-rank calculation.

The fragmenter continues to own anchor grouping, preformatted-content merging, deep-link construction, Ghost field projection, final IDs, size policy, and Algolia record construction. It maps the domain-clean extraction-fragment fields to the existing record fields:

- `text` to the temporary grouping `content` value;
- `headingPath` to `headings`;
- `position` and `headingRank` to `customRanking`;
- `sourceTag === 'pre'` to the existing preformatted merge rule.

## Options and errors

There is no options parameter. The selected elements, heading behaviour, anchor behaviour, and parser are compatibility rules owned by the package rather than caller policy. Richer rendered-HTML semantics require their own explicit interface decision instead of a speculative compatibility mode or public selector language.

Every string is valid input. Empty input returns an empty array, and malformed HTML uses normal HTML5 recovery. A non-string value from an untyped caller throws a native `TypeError` synchronously. Unexpected resource or runtime failures remain native errors; their messages and parse5 provenance are not contractual.

No custom error hierarchy is exposed because callers have no distinct domain recovery action.

## Performance contract

Extraction is synchronous and parses the complete input. Time and memory are proportional to parsing and traversal plus the total serialized output. Nested selected elements may duplicate serialized content in separate extraction fragments. The compatibility-first interface does not expose streaming or asynchronous variants.

## Rejected interfaces

- A callable default export makes the common call slightly shorter but requires different ESM and CommonJS declaration shapes and creates avoidable default-import interoperability risk.
- A public profile compiler moves extraction policy to callers and makes a matching language, ordering rules, validation errors, and extension semantics permanent support obligations.
- A class or factory implies state and lifecycle that the extractor does not own.
- Compatibility-shaped fields such as `content`, `headings`, and `customRanking` conflate extraction fragments with the fragmenter's Algolia record policy.
- Exposing parse5 nodes or a parser adapter leaks implementation details. Parse5 is an in-process dependency with one selected implementation, so an adapter would create a hypothetical seam.

## Evidence

- [Approved interface prototype](https://github.com/TryGhost/algolia/blob/aileen/prototype-html-extractor-interface/packages/algolia-html-extractor/prototype/PROTOTYPE-public-interface.html)
- [Strict TypeScript prototype source](https://github.com/TryGhost/algolia/blob/aileen/prototype-html-extractor-interface/packages/algolia-html-extractor/prototype/PROTOTYPE-public-interface.ts)
- [Design the public HTML extractor API](https://github.com/TryGhost/algolia/issues/193)
- `docs/research/legacy-extraction-compatibility-contract.md`
- `docs/research/html-parser-primitive.md`
