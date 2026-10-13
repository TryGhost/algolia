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

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https%3A%2F%2Fgithub.com%2FTryGhost%2Falgolia&base=deployment#ALGOLIA_ACTIVE=TRUE&ALGOLIA_APP_ID=&ALGOLIA_API_KEY=&ALGOLIA_INDEX=&NETLIFY_KEY=)

Existing Netlify installations keep their current build settings and webhook behavior. No configuration changes are required.

The button opts into release-based deployments, creates a copy in your GitHub account, and guides you through configuration. Start with an existing Algolia index, or [import your posts with the CLI](packages/algolia/README.md). After deploying, open your Netlify site to get the webhook URLs for Ghost.

See the [setup guide](USAGE.md) for the required credentials and [existing-installation instructions](packages/algolia-netlify/README.md#existing-installations) if search is already running. After opting in, rebuilds receive compatible patch and minor releases, including from forks. Major upgrades require your selection.

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

From a clean checkout of `main`, run `pnpm ship` and choose the version bump. Nx versions the
packages independently. You can also choose the bump directly:

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
publishes those versions through npm trusted publishing, then promotes the Netlify package version as a GitHub Release for deployment updates. Netlify and npm use the same version. See the [deployment policy](docs/netlify-deployment.md) for release prerequisites and verification. Never run `npm publish` by hand.

---

## Copyright & License

Copyright (c) 2013-2026 Ghost Foundation - Released under the [MIT license](LICENSE). Ghost and the Ghost Logo are trademarks of Ghost Foundation Ltd. Please see our [trademark policy](https://ghost.org/trademark/) for info on acceptable usage.
