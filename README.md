# Ghost Algolia tools

JavaScript tools for turning Ghost posts into records and keeping an Algolia search index up to date.

> [!IMPORTANT]
> Maintenance of this repository has resumed. The CLI supports Ghost 6 by requesting up to 100 posts at a time and following Ghost's pagination metadata until every post has been fetched.

## Tools

This pnpm monorepo contains five packages:

- [`@tryghost/algolia`](packages/algolia/README.md) provides a CLI for initially indexing a Ghost site's published posts.
- [`@tryghost/algolia-netlify`](packages/algolia-netlify/README.md) provides Netlify Functions that process Ghost post webhooks and update an index.
- [`@tryghost/algolia-fragmenter`](packages/algolia-fragmenter/README.md) converts Ghost posts into Algolia records and splits their HTML by heading.
- [`@tryghost/algolia-indexer`](packages/algolia-indexer/README.md) manages Algolia index settings, records, and deletions.
- [`@tryghost/algolia-html-extractor`](packages/algolia-html-extractor/README.md) extracts ordered text fragments from rendered Ghost HTML.

## Usage

### Netlify Functions

> [!WARNING]
> The current handlers do not enforce authentication when the `key` query parameter is omitted. A public function URL is not a secret; do not expose these functions publicly until authentication is enforced or access is restricted outside the handlers.

Deployment, Algolia configuration, and Ghost webhook setup are described in the [`@tryghost/algolia-netlify` guide](packages/algolia-netlify/README.md).

The Netlify deployment publishes only a static landing page alongside the functions; repository package and function files are not site assets.

### CLI

Use the CLI for the initial batch index of a site's published posts. Installation, configuration, and command options are documented in the [`@tryghost/algolia` guide](packages/algolia/README.md).

## Development

Use the Node version declared in [`.nvmrc`](.nvmrc), then install the monorepo dependencies and link its workspaces:

```sh
pnpm install
```

Run the full test suite, including package lint checks:

```sh
pnpm test
```

Run only the lint and formatting checks across the packages:

```sh
pnpm lint
```

Package-specific development and verification commands are documented in each package README.

## Publishing

The repository uses Nx to version packages independently. For routine releases, run one of the
root aliases from a clean checkout of `main`:

```sh
pnpm ship:patch
pnpm ship:minor
pnpm ship:major
```

To release one package, call `pnpm ship` with its Nx project name. Preview the result first:

```sh
pnpm ship patch --projects=@tryghost/algolia --dry-run
pnpm ship patch --projects=@tryghost/algolia
```

`ship` runs the test suite, updates the selected versions and their internal dependants, creates the
release commit and tags, then pushes them upstream. The [`Publish` workflow](.github/workflows/publish.yml)
publishes those versions through npm trusted publishing. Never run `npm publish` by hand.

---

## Copyright & License

Copyright (c) 2013-2026 Ghost Foundation - Released under the [MIT license](LICENSE). Ghost and the Ghost Logo are trademarks of Ghost Foundation Ltd. Please see our [trademark policy](https://ghost.org/trademark/) for info on acceptable usage.
