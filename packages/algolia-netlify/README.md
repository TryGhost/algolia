# Algolia Netlify

`@tryghost/algolia-netlify` provides Netlify Functions that listen to Ghost post webhooks and update an Algolia search index.

The public package exports the native Request/Response handlers from its root and from explicit subpaths:

```js
import {postPublished, postUnpublished} from '@tryghost/algolia-netlify';
import publishedHandler from '@tryghost/algolia-netlify/post-published';
import unpublishedHandler from '@tryghost/algolia-netlify/post-unpublished';
```

The named and subpath exports reference the same handlers. The repository's deployment loader preserves the `post-published` and `post-unpublished` function URLs.

## Usage

### Set up Algolia

Run the [`@tryghost/algolia` CLI](../algolia/README.md) once before enabling the webhooks. It creates the index and adds `filterOnly(slug)`, which the unpublish webhook uses to delete all records for a post. If you use custom index settings, add `filterOnly(slug)` to `attributesForFaceting` yourself.

The functions need your Algolia Application ID and an API key restricted to the target index. Give this key these permissions:

- Add records (`addObject`)
- Delete records matching a filter (`deleteIndex`)

Algolia requires `deleteIndex` for filtered deletions. The name is a bit misleading: this permission can also delete the whole index, so do not grant the key access to any other index. The publish webhook does not read or change settings, so the key does not need `settings` or `editSettings` after setup.

### Deploy the Netlify Functions

1. Connect this repository or your fork to a Netlify site. Use the root [`netlify.toml`](../../netlify.toml): base `deployment`, build command `node build.mts`, functions `functions`, publish `public`. Node is pinned there; pnpm is pinned in [`deployment/package.json`](../../deployment/package.json).
2. In **Project configuration → Environment variables**, add the values from [`.env.example`](.env.example) in the **production** context, available to Functions. Set `ALGOLIA_ACTIVE=TRUE`, your Algolia credentials and index, and a non-empty `NETLIFY_KEY`.
3. Deploy, then configure the Ghost webhooks below. Redeploy after changing environment variables.

For local development, `.env` belongs in `packages/algolia-netlify/`. Hosted functions use Netlify environment variables. Never commit credentials or put them in `netlify.toml`.

#### Existing installations

Before upgrading, set `NETLIFY_KEY` and add the same `?key=...` value to every Ghost webhook URL. Missing or incorrect request keys now return `401`; an unset or empty `NETLIFY_KEY` returns `503`.

Clear old base, package-directory, and build-command overrides in Netlify so the root configuration applies. In particular, deploying directly from `packages/algolia-netlify` bypasses release selection. Existing webhook paths stay unchanged.

#### Releases and rollback

With `ALGOLIA_INTEGRATION_VERSION` unset, the loader always selects `2026-10-12.1`, based on commit `631381e` from #330. It fetches that source revision and builds with its pinned pnpm version and frozen dependency lockfile. Later source changes and npm releases do not change the selected indexing code.

To upgrade, choose a release from [`deployment/releases.mts`](../../deployment/releases.mts), set `ALGOLIA_INTEGRATION_VERSION` in the **Builds** scope for **production**, and redeploy. Unknown values fail the build. Review the release's migration instructions first.

To roll back, restore the previous release setting and redeploy. Code rollback does not undo accepted Algolia writes. Before an index migration, retain the old index, verify the replacement separately, and coordinate the webhook and search-UI switch.

The loader disables indexing in non-production deploy contexts. Test upgrades on a separate Netlify site's production deployment with a separate Algolia index and restricted credentials. Keep production credentials scoped to production; builds do not need them.

A mutable upstream loader or modified fork can still change deployment behavior. See the [deployment policy](../../docs/netlify-deployment.md) for release maintenance and validation status.

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

Existing installations need no new environment variables, API permissions, or index settings for publishing. Leaving `ALGOLIA_CONTENT_PROJECTION` unset includes `image`, `tags`, `authors`, and `excerpt` in each record.

To choose fields, set `ALGOLIA_CONTENT_PROJECTION` in Netlify to a JSON object:

```json
{
  "fields": ["image", "tags", "authors", "excerpt", {"source": "custom_excerpt", "as": "summary"}],
  "customRanking": [{"source": "featured", "as": "isFeatured"}]
}
```

Explicit fields replace the defaults. Remove the variable to restore defaults; an empty string is invalid. Use the same projection in the CLI and webhooks. See the [fragmenter options](../algolia-fragmenter/README.md#options) for allowed fields and aliases. This requires fragmenter 0.4.0 or later; CLI 0.3.6 or later supports the same configuration shape.

`excerpt` is available for your search UI to display. The handlers do not change Algolia settings.

Publish validates all records before saving, including the 9,999-byte record limit. It adds or updates records without deleting existing ones. A failed save returns an error and triggers no cleanup, though some updates may have succeeded. Old fragments can remain searchable when a post shrinks; automatic cleanup is deferred until it can safely identify stale records. Unpublishing still deletes the post's records by slug.

Invalid configuration or content returns JSON with a `msg` property and status `500`, without contacting Algolia. Check the function logs for the validation error.

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

The modern handlers use native `Request` and `Response` objects. Malformed, empty, or structurally invalid JSON now receives `400 Invalid request body`; a valid Ghost envelope with no selected post remains a `200 No valid request body detected` response. Valid Ghost envelopes and endpoint URLs remain supported. Every request requires the configured `key`.

From this package directory, `pnpm pack` builds an ESM-only package with generated TypeScript declarations. The supported Node range is declared in [`package.json`](package.json). The package intentionally exposes only the two handlers; webhook utilities remain internal.

---

## Copyright & License

Copyright (c) 2013-2026 Ghost Foundation - Released under the [MIT license](LICENSE). Ghost and the Ghost Logo are trademarks of Ghost Foundation Ltd. Please see our [trademark policy](https://ghost.org/trademark/) for info on acceptable usage.
