# Algolia Netlify

`@tryghost/algolia-netlify` provides Netlify Functions that listen to Ghost post webhooks and update an Algolia search index.

The public package exports the native Request/Response handlers from its root and from explicit subpaths:

```js
import {postPublished, postUnpublished} from '@tryghost/algolia-netlify';
import publishedHandler from '@tryghost/algolia-netlify/post-published';
import unpublishedHandler from '@tryghost/algolia-netlify/post-unpublished';
```

The named and subpath exports reference the same handlers. Consumers can wrap either subpath in a basename-preserving Netlify Function entry; this repository deploys the canonical `post-published` and `post-unpublished` entries directly.

## Security

> [!WARNING]
> The current handlers do not enforce authentication when the `key` query parameter is omitted; they reject only a supplied key that does not match `NETLIFY_KEY`. Netlify Function URLs are public endpoints, not secrets, and the user-agent check can be spoofed. Pause or restrict exposure outside the handlers until mandatory authentication is implemented before public use.

Use a restricted Algolia API key to limit the impact of unauthorized requests.

## Usage

### Set up Algolia

Run the [`@tryghost/algolia` CLI](../algolia/README.md) once before enabling the webhooks. It creates the index and adds `filterOnly(slug)`, which both webhooks use to delete all records for a post. If you use custom index settings, add `filterOnly(slug)` to `attributesForFaceting` yourself.

The functions need your Algolia Application ID and an API key restricted to the target index. Give this key these permissions:

- Add records (`addObject`)
- Delete records matching a filter (`deleteIndex`)

Algolia requires `deleteIndex` for filtered deletions. The name is a bit misleading: this permission can also delete the whole index, so do not grant the key access to any other index. The publish webhook does not read or change settings, so the key does not need `settings` or `editSettings` after setup.

### Deploy the Netlify Functions

Deploy manually, and do not expose the deployed functions publicly until mandatory authentication is implemented or access is restricted outside the handlers:

1. Create a Netlify site and connect this repository manually.
2. Configure the site and set the environment variables described in [`.env.example`](.env.example):
   - Set `ALGOLIA_ACTIVE` to `TRUE` to enable indexing.
   - Set the Algolia Application ID, API key, and index name.
   - Choose a `NETLIFY_KEY` for the webhook query parameter. Setting it does not protect current handlers when the parameter is omitted.

The repository's [`netlify.toml`](../../netlify.toml) builds and deploys these functions from `packages/algolia-netlify`. The explicit `public` publish directory contains only a static landing page so package files, function sources, and function build artifacts are not exposed as site files.

### Set up Ghost webhooks

In Ghost Admin, create a **Custom Integration** under **Settings → Integrations** and add these webhooks:

| Ghost event | Function |
| --- | --- |
| `post.published` | `post-published` |
| `post.published.edited` | `post-published` |
| `post.unpublished` | `post-unpublished` |
| `post.deleted` | `post-unpublished` |

Use the function URL shown by Netlify and pass the configured `NETLIFY_KEY` as the `key` query parameter. For example:

```text
https://YOUR-SITE-ID.netlify.app/.netlify/functions/post-published?key=NETLIFY_KEY
```

Once configured, these webhooks keep post changes in sync without touching the index settings.

## Ghost content projection

The handlers use the same projection contract as `@tryghost/algolia` 0.3.6 or later and `@tryghost/algolia-fragmenter` 0.4.0 or later. Set `ALGOLIA_CONTENT_PROJECTION` to the projection object as JSON, without a surrounding `contentProjection` property:

```json
{
  "fields": [
    "image",
    {"source": "tags", "as": "topics"},
    "excerpt",
    {"source": "custom_excerpt", "as": "summary"}
  ],
  "customRanking": [
    {"source": "featured", "as": "isFeatured"},
    {"source": "reading_time", "as": "readingMinutes"}
  ]
}
```

Omitting the environment variable selects `image`, `tags`, `authors`, and `excerpt`. An explicit `fields` array replaces those defaults; `{"fields":[]}` selects no optional fields. An empty string is invalid JSON, so remove the variable to use defaults.

Available fields are `image`, `tags`, `authors`, `excerpt`, `custom_excerpt`, `feature_image_alt`, `feature_image_caption`, `canonical_url`, `featured`, `visibility`, `created_at`, `updated_at`, `published_at`, and `reading_time`. Aliases use `{source, as}` and must match `^[A-Za-z][A-Za-z0-9_]*$`; protected, reserved, duplicate, and conflicting names are rejected. Ranking siblings support only `featured` and `reading_time` and require aliases. See the [Fragmenter projection contract](../algolia-fragmenter/README.md#options) for normalization and validation details.

Projection changes record data only. `excerpt` is Ghost's display text; consumers must choose it in their search UI and own the associated searchable, retrieval, snippet, and ranking settings. Neither handler reads or changes Algolia settings.

### Validation and replacement

The publish handler transforms the webhook's current post directly, without fetching it again from the Content API. It validates the entire new record set before any Algolia request. Empty searchable content produces a fallback record. Complete records are limited to 9,999 compact UTF-8 bytes; whole extraction fragments can move into deterministic continuation records, but content is never truncated.

Both handlers reject malformed projection JSON or invalid policy before any Algolia request. Publish also rejects invalid Ghost content and indivisible oversized records before any request. Failures use the existing JSON `500` response with a `msg` property; fragmenter validation messages identify `INVALID_POLICY`, `INVALID_GHOST_CONTENT`, or `RECORD_TOO_LARGE`. Existing activation, optional-key authentication, user-agent checks, envelope handling, and valid text responses are preserved.

After preflight, publish deletes all existing records for the current post's slug, then saves the complete new set. This removes stale continuations when content shrinks. Unpublish deletes by the current resource's slug, falling back to the previous resource when current is absent or empty. This release retains legacy slug identity; it does not introduce stable content-ID reconciliation.

Replacement is not transactional. A failed delete prevents saving; a failed save after deletion may leave records missing or partially updated. External failures return the same JSON `500` envelope and do not promise rollback. Keep an index backup or replica and the previous package/configuration before rollout. Disable webhooks with `ALGOLIA_ACTIVE=FALSE` while restoring or switching the index and reverting to a compatible package/configuration. Reverting the package alone cannot restore deleted records. Never unpublish or reuse a released version.

## Development

Install the monorepo dependencies from the repository root with `pnpm install`. Then configure and run this package locally:

```sh
cd packages/algolia-netlify
cp .env.example .env
# Replace the example values in .env with development credentials.
pnpm dev
```

`pnpm dev` starts Netlify Dev, which builds the TypeScript functions as needed. Use the local URL it prints for endpoints such as `/.netlify/functions/post-published`.

Run this package's tests and lint checks from the repository root:

```sh
pnpm --filter @tryghost/algolia-netlify test
pnpm --filter @tryghost/algolia-netlify typecheck
pnpm --filter @tryghost/algolia-netlify build
```

Run the full monorepo suite with `pnpm test`.

The modern handlers use native `Request` and `Response` objects. Malformed, empty, or structurally invalid JSON now receives `400 Invalid request body`; a valid Ghost envelope with no selected post remains a `200 No valid request body detected` response. Existing valid webhook behavior, endpoint URLs, and optional `key` handling are unchanged.

From this package directory, `pnpm pack` builds an ESM-only package with generated TypeScript declarations. The supported Node range is declared in [`package.json`](package.json). The package intentionally exposes only the two handlers; webhook utilities remain internal.

---

## Copyright & License

Copyright (c) 2013-2026 Ghost Foundation - Released under the [MIT license](LICENSE). Ghost and the Ghost Logo are trademarks of Ghost Foundation Ltd. Please see our [trademark policy](https://ghost.org/trademark/) for info on acceptable usage.
