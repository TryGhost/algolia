# Algolia Netlify

`@tryghost/algolia-netlify` provides Netlify Functions that listen to Ghost post webhooks and update an Algolia search index.

## Security

> [!WARNING]
> The current handlers do not enforce authentication when the `key` query parameter is omitted; they reject only a supplied key that does not match `NETLIFY_KEY`. Netlify Function URLs are public endpoints, not secrets, and the user-agent check can be spoofed. Pause or restrict exposure outside the handlers until mandatory authentication is implemented before public use.

Use a restricted Algolia API key to limit the impact of unauthorized requests.

## Usage

### Set up Algolia

The functions need the Algolia Application ID and an API key that can update the target index. The general Admin API key works, but a key scoped to this index is preferable. A scoped key needs these permissions:

- Add records (`addObject`)
- Delete records matching a filter (`deleteIndex`)
- Get index settings (`settings`)
- Set index settings (`editSettings`)

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

These webhooks keep future post changes synchronized. Use the [`@tryghost/algolia` CLI](../algolia/README.md) to create the initial index.

## Development

Install the monorepo dependencies from the repository root with `yarn`. Then configure and run this package locally:

```sh
cd packages/algolia-netlify
cp .env.example .env
# Replace the example values in .env with development credentials.
yarn dev
```

`yarn dev` starts Netlify Dev, which builds the TypeScript functions as needed. Use the local URL it prints for endpoints such as `/.netlify/functions/post-published`.

Run this package's tests and ESLint checks from the repository root:

```sh
yarn workspace @tryghost/algolia-netlify test
yarn workspace @tryghost/algolia-netlify typecheck
yarn workspace @tryghost/algolia-netlify build
```

Run the full monorepo suite with `yarn test`.

The modern handlers use native `Request` and `Response` objects. Malformed, empty, or structurally invalid JSON now receives `400 Invalid request body`; a valid Ghost envelope with no selected post remains a `200 No valid request body detected` response. Existing valid webhook behavior, endpoint URLs, and optional `key` handling are unchanged.

This runtime migration does not repair the package's pre-existing npm artifact: the published tarball does not contain an importable entry point or the function sources. Deploy this workspace from the repository with Netlify; making `@tryghost/algolia-netlify` installable remains separate release work.

---

## Copyright & License

Copyright (c) 2013-2026 Ghost Foundation - Released under the [MIT license](LICENSE). Ghost and the Ghost Logo are trademarks of Ghost Foundation Ltd. Please see our [trademark policy](https://ghost.org/trademark/) for info on acceptable usage.
