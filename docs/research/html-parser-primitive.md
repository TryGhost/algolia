# HTML parser primitive

## Decision

Use `parse5` as the parser and serializer primitive for the compatibility-first public extractor. The initial implementation established parity on version 7.3.0, but parser updates should go through the normal dependency update flow.

Implement the extraction state machine as clean-room Ghost code against parse5's tree-adapter data. Do not port the abandoned JavaScript package or the Ruby extractor.

## Why parse5

- It implements WHATWG HTML parsing and serialization, which is the right baseline for malformed HTML, entities, tables, and browser-like tree construction.
- It is MIT-licensed and has one runtime dependency, `entities`.
- It is implemented in TypeScript and publishes declaration files that the extractor can consume directly.
- It exposes parsing and serialization primitives without a browser simulation, network stack, or general selector engine that this fixed traversal contract does not need.

The extractor is ESM-only, so parse5's module format does not require a Renovate version restriction. Renovate can propose parser updates. The compatibility suite decides whether an update is safe by comparing exact public fragments and final records with reviewed literals.

## Rejected alternatives

- **jsdom**: closest to the abandoned implementation's DOM surface, but simulates substantially more browser behaviour and carries a much larger dependency graph than the extraction contract needs.
- **Cheerio**: provides convenient selectors and supports Node 24, but arbitrary selectors are not part of the chosen narrow package boundary and its dependency surface is broader.
- **htmlparser2 or LinkeDOM**: optimize for different performance or DOM trade-offs; strict browser-compatible HTML tree construction and serialization are more important for differential parity.
- **Copying either extractor**: retains unused API baggage and introduces avoidable provenance and attribution work. The npm tarball declares ISC but does not contain a license file; the upstream Ruby implementation is MIT.

## Validation required during implementation

The parser choice is conditional on the exact differential suite passing against the frozen legacy contract. The suite covers `outerHTML` serialization, entity spelling, document parsing rather than fragment parsing, malformed tables, foreign content, void elements, and nested selected nodes. A parser update that changes those results needs a compatibility decision; its output should not be accepted by rewriting fixtures as part of the dependency update.

The Netlify package must continue to expose the parser to its file tracer through an explicit direct dependency or an equivalently verified packaged seam.

## Sources

- [parse5 7.3.0 package metadata](https://github.com/inikulin/parse5/blob/v7.3.0/packages/parse5/package.json)
- [published parse5 7.3.0 package tarball](https://registry.npmjs.org/parse5/-/parse5-7.3.0.tgz)
- [parse5 7.3.0 TypeScript entry point](https://github.com/inikulin/parse5/blob/v7.3.0/packages/parse5/lib/index.ts)
- [parse5 7.3.0 TypeScript build configuration](https://github.com/inikulin/parse5/blob/v7.3.0/packages/parse5/tsconfig.json)
- [parse5 8 package metadata](https://github.com/inikulin/parse5/blob/v8.0.0/packages/parse5/package.json)
- [parse5 project](https://github.com/inikulin/parse5)
- [`algolia-html-extractor` implementation](https://github.com/stonecircle/html-extractor/blob/master/lib/algoliaHtmlExtractor.js)
- [Algolia Ruby extractor license](https://github.com/algolia/html-extractor/blob/develop/LICENSE.txt)
