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

`@tryghost/algolia` depends on `@tryghost/algolia-fragmenter` 0.4.0 or later. Do not override it with an older version.

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

Use the optional top-level `contentProjection` object to choose which Ghost fields the CLI copies into every Algolia record. If you leave it out, the CLI uses `image`, `tags`, `authors`, and `excerpt`. If you provide it, its `fields` array replaces those defaults. An empty array selects no optional fields:

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

Available fields are `image`, `tags`, `authors`, `excerpt`, `custom_excerpt`, `feature_image_alt`, `feature_image_caption`, `canonical_url`, `featured`, `visibility`, `created_at`, `updated_at`, `published_at`, and `reading_time`. To rename an optional field, use a validated `{source, as}` alias. Ranking siblings support only `featured` and `reading_time`, and they require an alias. See the [Fragmenter projection contract](../algolia-fragmenter/README.md#options) for value normalization and exact `FragmenterError` behavior.

The CLI validates the projection before making a Ghost or Algolia request. It never sends a Ghost `fields` parameter. Its `include` parameter requests `tags`, `authors`, both, or neither based on the selected fields, including aliases.

`contentProjection` changes record data only. It does not update Algolia settings. The default `excerpt` is display-only unless you reference it in `algolia.indexSettings`. The CLI applies the configured settings, or the indexer's defaults when `algolia.indexSettings` is omitted.

Slug replacement works only when the effective index settings contain `filterOnly(slug)`. Algolia settings updates are partial, so a custom `algolia.indexSettings` patch may omit `attributesForFaceting` and keep the index's existing facets. If the patch replaces `attributesForFaceting`, it must retain the exact `filterOnly(slug)` entry. Otherwise, the CLI rejects the configuration before any Ghost or Algolia request. The CLI does not add or repair this facet; the indexer's defaults already include it.

### Preflight and record size

The CLI builds and validates every record before connecting to Algolia. Invalid content and oversized records fail with `INVALID_GHOST_CONTENT` or `RECORD_TOO_LARGE`, without making an Algolia request. Records are limited to 9,999 compact UTF-8 bytes. The Fragmenter may move whole extracted fragments into continuation records, but it never truncates them. If one fragment cannot fit, the error reports its object ID and byte excess.

Resolve an affected ID to a slug and exclude it from the batch:

```sh
npx algolia index config.json --skip post-slug,another-post-slug
```

If a long `--skip` filter causes a `414 Request-URI Too Large` response, put the slugs in the configuration file's `ignore_slugs` array. The CLI always applies that array after fetching posts; `--skipjsonslugs` is not required and currently affects logging only.

### Migration, replacement, and rollback

After validation, the CLI applies the configured index settings. It then deletes old records for each unique fetched, non-ignored slug before saving the new batch. Deletes run one at a time, in source order, because Algolia's [`deleteBy` operation cannot run in parallel and is rate-limited](https://www.algolia.com/doc/libraries/sdk/v1/methods/delete-by). This removes stale fragments when content shrinks. Posts excluded by `--skip` are not fetched. Posts in `ignore_slugs` are fetched but are neither deleted nor saved.

Replacement is not transactional. If a request fails after deletion starts, the index may contain a partial update. Keep the previous configuration and an index backup or replica before migrating. Restoring or switching the index is the rollback path; rerunning an older CLI will not restore deleted records. Never unpublish or reuse a released version.

## Development

Install dependencies from the repository root with `pnpm install`. From the root, run this package's tests and lint checks with:

```sh
pnpm --filter @tryghost/algolia test
```

Run the full monorepo suite with `pnpm test`.

---

## Copyright & License

Copyright (c) 2013-2026 Ghost Foundation - Released under the [MIT license](LICENSE). Ghost and the Ghost Logo are trademarks of Ghost Foundation Ltd. Please see our [trademark policy](https://ghost.org/trademark/) for info on acceptable usage.
