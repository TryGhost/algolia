# Ghost 6 Content API fixture provenance

Captured on 2026-08-13 from a disposable local Ghost site containing only
synthetic data.

## Runtime

- Ghost version: `6.57.1`
- Official image: `ghost:6.57.1-alpine`
- Pinned image reference: `ghost@sha256:6e37900accfb12e16fbc15bf94500e09829cb17e6448b3051e9c76446b4fbf53`
- Local image ID: `sha256:1984dc765a374721616ed6bd43819fec66f70b97c365b0aee57a217a4e2b28c6`
- Platform: `linux/arm64`
- Ghost image Node version: `22.23.2`
- Site URL: `http://127.0.0.1:23689`
- Raw Content API capture times: `2026-08-13T07:45:47Z` and
  `2026-08-13T07:45:48Z`

The exact image was run in development mode with SQLite according to the
[Docker Official Image instructions](https://hub.docker.com/_/ghost). The tag
was resolved and then the container was run by digest.

## Synthetic source

`generate-import.mjs` creates a Ghost 6 import file with 101 published posts.
The source uses deterministic slugs, UUIDs, dates, source URLs, tags, and
relationships. Ghost allocates its own database ObjectIDs during import; the
real IDs returned by the API are frozen in the captured raw payloads.

The source follows Ghost's documented
[migration JSON format](https://docs.ghost.org/migration/custom/). Posts contain
source HTML rather than pre-rendered API JSON. Ghost imports that HTML into
Lexical and renders the final HTML on save. `ghost-renderer-proof.json` preserves
the Lexical tree and rendered HTML for the representative post without any
session or integration data.

The imported dataset covers:

- two API pages (`100 + 1` posts);
- included tags and authors;
- an ignored-slug candidate, `ignored-by-config`;
- a post with no tags and a null feature image;
- deterministic UUIDs, publication dates, slugs, and URLs;
- Ghost-rendered `h2` and `h3` IDs, paragraph content, an internal link, a
  list, a code block, and an image card.

Ghost's import endpoint adds a time-based internal `#Import ...` tag. That tag
was deleted through the local Admin API before capture so it could not make the
fixture nondeterministic. No source content was otherwise edited after import.

## Capture requests

A disposable custom integration was created in the local Ghost Admin. Its
Content API key was held in a mode-`0600` temporary file and is represented here
only as `<redacted>`:

```http
GET /ghost/api/content/posts/?key=<redacted>&include=tags,authors&limit=100&page=1
Accept-Version: v6.0

GET /ghost/api/content/posts/?key=<redacted>&include=tags,authors&limit=100&page=2
Accept-Version: v6.0
```

The response bodies were written directly by `curl`, without rewriting or
normalizing them. Ghost documents `include=tags,authors` and the browse
pagination parameters in the
[Content API posts documentation](https://docs.ghost.org/content-api/posts)
and [parameter reference](https://docs.ghost.org/content-api/parameters).

The representative renderer proof came from the authenticated local Admin API
and was projected to only `ghost_version`, `source_format`, `slug`, `uuid`,
`lexical`, and `html`. It is evidence for the renderer path, not a raw Content
API response.

## Equivalent recapture outline

This process regenerates equivalent synthetic content, but not byte-identical
raw responses. Ghost assigns time-dependent database ObjectIDs during import;
the IDs in `posts-page-1.json` and `posts-page-2.json` are therefore frozen
capture evidence.

1. Pull `ghost:6.57.1-alpine` and verify its repo digest.
2. Run the pinned digest with `--platform linux/arm64`,
   `NODE_ENV=development`, SQLite, the fixed local URL above, and a disposable
   content directory.
3. Complete `/ghost/api/admin/authentication/setup/` with synthetic local
   credentials, create a session, and delete the generated starter content.
4. Run `node generate-import.mjs` and upload `synthetic-import.json` as the
   `importfile` field to `/ghost/api/admin/db/`.
5. Delete the importer-created internal `#Import ...` tag through the Admin API.
6. Create a disposable integration at `/ghost/api/admin/integrations/`, keep
   its generated keys only in mode-`0600` temporary files, and make the two
   redacted Content API requests shown above.
7. Run `node validate-fixture.mjs`.
8. Remove the container, bind-mounted SQLite content, cookies, and API keys.

## Validation

`node validate-fixture.mjs` proves:

- page 1 contains 100 posts and `meta.pagination.next === 2`;
- page 2 contains one post and `meta.pagination.next === null`;
- the combined dataset contains 101 unique Ghost IDs and UUIDs;
- every post has a real author array and a tag array;
- tags, authors, the ignored slug, null feature image, and no-tags case exist;
- the representative Lexical tree contains heading, paragraph, list,
  code-block, and image nodes;
- Ghost's final rendered HTML matches the captured Content API HTML, including
  generated heading IDs and the absolute internal URL.

`expected-algolia-records.json` was created once from these captured responses
through the pinned production fragmenter and then frozen as a reviewed literal.
After excluding `ignored-by-config`, 100 posts produce 101 ordered Algolia
records because the representative rich post produces two heading fragments.
`expected-index-settings.json` freezes the settings sent by the production
indexer. The acceptance test compares the real SDK request bodies exactly to
both literals; neither expected file is generated while tests run.

Run `node verify-fixture.mjs` to verify the reviewed source, response, renderer,
and golden bytes before using them. Run `node validate-fixture.mjs` for the
independent Ghost response and renderer assertions.

## Integrity

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `generate-import.mjs` | 5,007 | `796eb6a79e5342c2b3f2917c723b09421ad6d0b3a60f8f706489a8bcd613a76b` |
| `synthetic-import.json` | 122,713 | `f103591138ad14c229b5386b9cf210900824d4c6fa5c7142ac99dd66aa5be14d` |
| `validate-fixture.mjs` | 3,867 | `3089aafd2275ac01c37c0efa451e7692462ee8c0d434969ded475d4441ae67a7` |
| `posts-page-1.json` | 302,331 | `73044a66fad131f06b3fcf1707008c130a355077f2f63e07c2ab5aaab8cf6750` |
| `posts-page-2.json` | 3,382 | `d54736bef9403db3ddf8dec0bbd2c5c70f3cc11aef7cef9a505309b4376619a7` |
| `ghost-renderer-proof.json` | 3,503 | `9a244eb05c432e2e3d4ec1a4821364f94d025f8e3419e2cb1c3e456a552ccc95` |
| `expected-algolia-records.json` | 67,033 | `ea8f562606161641b54ccb4d52f2fe382cbe00942ea58564fba9cd9e9b5ca31a` |
| `expected-index-settings.json` | 357 | `ed515127d16fa025e3f4b13e9f9d360273e18a750162c0bdf7d217c7de8c1a08` |
| `verify-fixture.mjs` | 1,523 | `e0ca27d51037b580607423c632bad7aa120e59a96d4625f7e1ed5e20c9644787` |

## Safety and privacy

- All post, author, tag, image, and site values are synthetic.
- Reserved `.invalid` domains are used for source media and setup email data.
- No live Ghost or Algolia service was contacted.
- No customer data was read or copied.
- No real password, session cookie, Admin API key, or Content API key is
  present in the retained artifacts. The acceptance harness uses only explicit
  synthetic credentials.
- The disposable container, SQLite data, cookies, and integration secrets were
  removed after capture.
