# Ghost Algolia HTML extractor

`@tryghost/algolia-html-extractor` turns rendered Ghost HTML into an ordered list of fragments. It
is an ESM-only package and exports one synchronous function, `extract`, from the package root.

```ts
import {
    extract,
    type ExtractionFragment
} from '@tryghost/algolia-html-extractor';

const fragments: readonly ExtractionFragment[] = extract(ghostContent.html);
```

## What it extracts

`extract` tracks the current `h1`–`h6` path while it walks the document. It emits fragments for
`p`, `pre`, `td`, and `li` elements in document order. Empty elements are skipped, but whitespace
is kept.

Each fragment contains the element's serialized HTML and text, its heading path and anchor, its
position, its heading rank, and the source tag. The returned values are read-only.

The package handles HTML parsing itself and has no configuration options. Turning fragments into
Algolia records, merging `pre` content, and sending records to Algolia are separate jobs handled by
the downstream packages.
