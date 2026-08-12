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
yarn add @tryghost/algolia
```

## Usage

Copy [`example.config.json`](example.config.json) to a local file such as `config.json`, then set the Ghost Content API and Algolia credentials. `indexSettings` contains the current defaults and can be customized or removed.

Configuration files contain secrets and should not be committed. Files matching `packages/algolia/config*.json` are ignored by this repository.

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

### Large fragments

The [Fragmenter](../algolia-fragmenter/README.md) splits large HTML strings by heading. A fragment can still exceed Algolia's record-size limit; the resulting error includes the post ID. Resolve the ID to a slug and exclude it from the batch:

```sh
npx algolia index config.json --skip post-slug,another-post-slug
```

If a long `--skip` filter causes a `414 Request-URI Too Large` response, put the slugs in the configuration file's `ignore_slugs` array. The CLI always applies that array after fetching posts; `--skipjsonslugs` is not required and currently affects logging only.

## Development

Install dependencies from the repository root with `yarn`. From the root, run this package's tests and ESLint checks with:

```sh
yarn workspace @tryghost/algolia test
```

Run the full monorepo suite with `yarn test`.

---

## Copyright & License

Copyright (c) 2013-2026 Ghost Foundation - Released under the [MIT license](LICENSE). Ghost and the Ghost Logo are trademarks of Ghost Foundation Ltd. Please see our [trademark policy](https://ghost.org/trademark/) for info on acceptable usage.
