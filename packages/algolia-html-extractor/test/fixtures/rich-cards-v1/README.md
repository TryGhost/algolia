# Rendered Ghost card fixtures

`rendered.json` contains synthetic Lexical cards and their captured Ghost HTML.
The renderer and node versions recorded in the file are part of its provenance.
All content is authored for tests; URLs use `fixture.invalid`. No live Ghost
content or credentials are needed.

The fixtures cover authored card text beside generated controls and states.
Tests assert the expected searchable text through `extractRich()` and check the
capture's SHA-256 digest. Keep the original compatibility corpus unchanged.

To reproduce the capture, use a Ghost checkout with the renderer dependencies
and exact versions required by `capture.mts` installed:

```sh
node packages/algolia-html-extractor/test/fixtures/rich-cards-v1/capture.mts /path/to/Ghost/ghost/core/package.json
```

Review any changed HTML before updating its digest or expected fragments. Add a
new fixture family when the renderer structure changes; keep existing captures
as regression evidence.
