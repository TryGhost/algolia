# Ghost-rendered extractor fixture provenance

This directory has three sets of fixtures rendered by Ghost. The source strings and URLs are
synthetic and use reserved `.invalid` domains. `controlled-capture.json` maps each source to its
Lexical state and rendered HTML.

## Runtime and capture

The fixtures were captured at `2026-08-17T13:28:07.402Z` with:

- Ghost `6.57.1`
- image tag `ghost:6.57.1-alpine`
- pinned image `ghost@sha256:6e37900accfb12e16fbc15bf94500e09829cb17e6448b3051e9c76446b4fbf53`
- local image ID `sha256:1984dc765a374721616ed6bd43819fec66f70b97c365b0aee57a217a4e2b28c6`
- platform `linux/arm64` and image Node `22.23.2`
- bundled `@tryghost/kg-html-to-lexical@1.3.3`,
  `@tryghost/kg-lexical-html-renderer@1.4.3`, and `@tryghost/kg-default-nodes@2.1.5`

`capture.mts` runs `renderer.mts` in the pinned image with Docker networking disabled. It converts
each source string to Lexical and renders it with Ghost's default nodes. The captured file contains
the synthetic source, Lexical state, rendered HTML, purpose, source ID, and package versions. The
render request uses the `html` target and `https://fixture.invalid/` as its site URL. Image
transforms, email unique IDs, and picture formats are disabled.

The capture does not start a Ghost server or call the Content API. The renderer has no credentials
and receives no live or editorial data.

## Source-to-render mapping

`controlled-source.mts` defines the three inputs:

1. `synthetic-html-import-legacy-flow-v1` maps to `legacy-selected-flow`. It covers heading IDs,
   inline markup, entities, Unicode, a synthetic link, ordered and nested unordered lists, a code
   block, table cells, and content around a Ghost HTML card.
2. `synthetic-html-import-semantic-gaps-v1` maps to `intentional-semantic-gaps`. It covers an image
   with alt text and a caption, a blockquote, table headings and cells, HTML-card comments, and an
   embed-card figure. Only the `td` is emitted by the compatibility extractor.
3. `synthetic-html-import-image-card-v1` maps to `controlled-card-boundary`. It places the existing
   controlled image-card fixture between two selected paragraphs. The card is not included in the
   compatibility stream.

`evidence.json` also references the earlier controlled renderer fixture at
`packages/algolia/test/fixtures/ghost-v6/ghost-renderer-proof.json`. That fixture is checked
separately and is only used for the structures it contains.

## Expected results and integrity

`controlled-expectations.json`, `expected-fragments.json`, and `expected-final-records.json` contain
reviewed literal values. The capture script does not write these files. Offline tests compare the
public `extract` output and the complete legacy-mapped records against them.

`integrity.json` records the byte count and SHA-256 digest for eight files in this directory: the
controlled source, renderer, capture script, captured output, reviewed expectations, and the
earlier-proof projection in `evidence.json`. `compatibility.test.ts` separately checks
`packages/algolia/test/fixtures/ghost-v6/ghost-renderer-proof.json` against the digest in
`evidence.json`. The tests also check the pinned runtime and request fields, source mappings,
package versions, and rendered structures.

## Limitations

These fixtures do not use an authenticated census of `main.ghost.is`. They show how the pinned
Ghost version renders the controlled inputs listed above. They do not show which cards appear on
the live site, how often they appear, or every card Ghost supports. `controlled-card-boundary` is a
starting fixture; a separate live census can replace it with normalized signatures without
retaining editorial material.

## Recapture

With the pinned image already present, run from the repository root:

```sh
source ~/.nvm/nvm.sh && nvm use
node packages/algolia-html-extractor/test/fixtures/ghost-rendered-v1/capture.mts
```

Recapturing changes the timestamp, so review the result and update the integrity data. Do not
generate expected fragments or final records from the extractor under test.

All retained values are synthetic. No customer data or real personal information is present.
