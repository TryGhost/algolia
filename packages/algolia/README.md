# Algolia Ghost CLI

`@tryghost/algolia` is a CLI for initially indexing the full published content of a Ghost site in Algolia.

The CLI uses the Ghost 6 Content API. By default, it requests the [maximum 100 posts](https://docs.ghost.org/content-api/parameters#limit) at a time, follows Ghost's [`meta.pagination.next`](https://docs.ghost.org/content-api/pagination) value, and pauses briefly between pages until the full site has been fetched.

## Install

Add the CLI to a project:

```sh
npm install @tryghost/algolia
```

or

```sh
pnpm add @tryghost/algolia
```

## Usage

Copy [`example.config.json`](example.config.json) to a local file such as `config.json`, then set the Ghost Content API and Algolia credentials. `indexSettings` contains the current defaults and can be customized or removed.

Configuration files contain secrets and should not be committed. Files matching `packages/algolia/config*.json` are ignored by this repository.

The CLI requires `@tryghost/algolia-fragmenter` 0.4.0 or newer. The package dependency supplies a compatible version; do not override it with an older fragmenter.

After installing the package in another project, run its binary through that project's package runner:

```sh
npx algolia index config.json [options]
```

From this repository, invoke the entrypoint directly:

```sh
cd packages/algolia
node bin/cli.js index config.json [options]
```

### Options

- `pathToConfig` is the path, relative to the current directory, to the JSON configuration file.
- `-s, --skip` excludes a comma-separated list of post slugs from the index.
- `-V, --verbose` enables verbose output.
- `-l, --limit` makes a single request for 1 to 100 posts instead of fetching every page.
- `-p, --page` selects the page for that single request and requires `--limit`.
- `-sjs, --skipjsonslugs` currently controls only a log message about `ignore_slugs`; it does not control exclusion. Configured `ignore_slugs` are always excluded after posts are fetched.

### Ghost content projection

The optional top-level `contentProjection` object selects which Ghost fields are repeated in every Algolia record. When it is omitted, the CLI projects `image`, `tags`, `authors`, and `excerpt`. Supplying it replaces that default list, so an empty `fields` array selects no optional fields:

```json
{
  "contentProjection": {
    "fields": [
      "image",
      {"source": "tags", "as": "topics"},
      {"source": "custom_excerpt", "as": "summary"},
      "featured",
      "reading_time"
    ],
    "customRanking": [
      {"source": "featured", "as": "isFeatured"},
      {"source": "reading_time", "as": "readingMinutes"}
    ]
  }
}
```

Available fields are `image`, `tags`, `authors`, `excerpt`, `custom_excerpt`, `feature_image_alt`, `feature_image_caption`, `canonical_url`, `featured`, `visibility`, `created_at`, `updated_at`, `published_at`, and `reading_time`. Optional fields can use a validated `{source, as}` alias. Ranking siblings support only `featured` and `reading_time` and require an alias. See the [Fragmenter projection contract](../algolia-fragmenter/README.md#options) for value normalization and exact `FragmenterError` behavior.

The CLI validates projection policy before making a Ghost or Algolia request. It never sends a Ghost `fields` parameter. It requests `tags`, `authors`, both, or neither through `include` according to the enabled fields, including aliased fields.

Projection and index settings are independent. Adding `excerpt`, an alias, or a ranking sibling does not make it searchable, retrievable, faceted, highlighted, snippeted, or ranked. In particular, the default `excerpt` is display-only unless you explicitly reference it in `algolia.indexSettings`. The CLI continues to apply the configured `algolia.indexSettings`, or the indexer's existing defaults when that object is omitted; it does not derive settings from `contentProjection`.

Slug replacement requires the effective index settings to contain `filterOnly(slug)`. Algolia settings updates are partial, so a custom `algolia.indexSettings` patch may omit `attributesForFaceting` and preserve the index's existing facets. If the patch explicitly replaces `attributesForFaceting`, it must retain the exact `filterOnly(slug)` entry; otherwise, the CLI rejects the configuration before any Ghost or Algolia request. The CLI never adds or repairs the facet implicitly, and the indexer's defaults already include it.

### Preflight and record size

The CLI fetches the complete requested batch and runs the Fragmenter's deterministic preflight before connecting to Algolia. Invalid Ghost content and records over the 9,999-byte compact UTF-8 ceiling fail with `INVALID_GHOST_CONTENT` or `RECORD_TOO_LARGE`; no Algolia request is made and no partial record set is returned. Whole extraction fragments can be packed into continuation records, but they are never truncated. An indivisible fragment that cannot fit reports the affected object ID and byte excess.

Resolve an affected ID to a slug and exclude it from the batch:

```sh
npx algolia index config.json --skip post-slug,another-post-slug
```

If a long `--skip` filter causes a `414 Request-URI Too Large` response, put the slugs in the configuration file's `ignore_slugs` array. The CLI always applies that array after fetching posts; `--skipjsonslugs` is not required and currently affects logging only.

### Migration, replacement, and rollback

After preflight succeeds, the CLI runs its existing index-settings setup, with the effective `filterOnly(slug)` facet documented above. It then uses the legacy slug filter to delete all indexed records matching each unique fetched, non-ignored slug before saving the complete new record set. These deletions are deliberately awaited in first-seen order because Algolia's [`deleteBy` operation cannot run in parallel and is rate-limited](https://www.algolia.com/doc/libraries/sdk/v1/methods/delete-by). This replacement step removes stale heading or continuation records when content shrinks and makes repeated runs converge on the same records. Posts excluded by `--skip` are not fetched; posts excluded by `ignore_slugs` are fetched but are neither deleted nor saved.

Algolia replacement is not transactional. A network failure after one or more slug deletions can leave a partial external update, and the CLI does not promise automatic rollback. Before migrating a production index, retain the prior configuration and a recoverable index backup or replica. To roll back indexed state, restore or switch to that retained index. Switching back to an earlier compatible CLI/configuration stops new projection behavior, but an older CLI cannot recreate records already deleted by a failed replacement; do not treat rerunning it as an index restore, and never unpublish or reuse a released version.

## Development

Install dependencies from the repository root with `pnpm install`. From the root, run this package's tests and lint checks with:

```sh
pnpm --filter @tryghost/algolia test
```

Run the full monorepo suite with `pnpm test`.

---

## Copyright & License

Copyright (c) 2013-2026 Ghost Foundation - Released under the [MIT license](LICENSE). Ghost and the Ghost Logo are trademarks of Ghost Foundation Ltd. Please see our [trademark policy](https://ghost.org/trademark/) for info on acceptable usage.
