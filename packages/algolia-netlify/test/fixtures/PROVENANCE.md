# Ghost 6 webhook fixture provenance

The handler acceptance tests wrap the representative post from
`packages/algolia/test/fixtures/ghost-v6/posts-page-1.json` in the Ghost webhook
envelope. That post is synthetic content captured from Ghost 6.57.1; its full
runtime, generation, integrity, and privacy record is in the adjacent
`packages/algolia/test/fixtures/ghost-v6/PROVENANCE.md`.

The envelope shape is based on Ghost's official webhook serializer at commit
`75e2a73ab55f98fa40c2c7689839c506840dbd75`: it emits
`{post: {current, previous}}`, serializes current posts with `html` and
`plaintext` formats, and loads `tags` and `authors`. Ghost's official serializer
and end-to-end webhook tests also establish that deleted resources use
`previous`, while published, edited, and unpublished events carry `current`.

The tests build published, edited, unpublished, and deleted envelopes from
those two documented resources. The fixtures contain no live site content,
credentials, webhook secrets, or customer data. The tests use
`expected-algolia-records.json` as the expected output instead of generating it
during the test run.
