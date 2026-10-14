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

See the [customer guide](USAGE.md) for setup, updates, and rollback, the [configuration reference](docs/netlify-configuration.md) for settings and copyable examples, and [existing-installation instructions](packages/algolia-netlify/README.md#existing-installations) if search is already running. After opting in, rebuilds receive compatible patch and minor releases, including from forks. Major upgrades require your selection.

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

Package-specific development and verification commands are documented in each package README. To test Netlify changes before merging, follow [Testing a Netlify prerelease](docs/testing-prereleases.md).

## Publishing

Include an Nx version plan with each change that needs a package release:

```sh
pnpm exec nx release plan --projects=@tryghost/algolia
```

Choose the bump, describe what someone upgrading needs to know, and commit the generated file in `.nx/version-plans/` with the change. Create a separate plan for each package so maintainers can release them independently. Keep this directory for version plans only.

Pull requests that change package source need a version plan; documentation and test-only changes do not.

From a clean checkout of `main`, preview the release, then ship it:

```sh
pnpm ship --dry-run
pnpm ship
```

`ship` runs the tests, applies the plans, and generates each released package's `CHANGELOG.md`. It commits the version changes, changelogs, and consumed plans together, creates the tags, and tests the versioned files before pushing them. With no plans, it releases nothing.

If verification fails after versioning, keep the prepared commit and tags, fix the failure, and rerun `pnpm test`. Do not run `pnpm ship` again. Once verification passes, or after fixing a rejected push, run `git push --atomic --follow-tags` to the same remote. This pushes the prepared release without changing versions again.

To release one package, add its Nx project name to both commands:

```sh
pnpm ship --projects=@tryghost/algolia --dry-run
pnpm ship --projects=@tryghost/algolia
```

Nx may also update internal dependants. Plans for other packages remain pending. A plan that spans selected and unselected packages must be split before a scoped release.

For a release without plans, the explicit `pnpm ship patch`, `pnpm ship minor`, and `pnpm ship major` overrides remain available, along with their `ship:patch`, `ship:minor`, and `ship:major` aliases. Preview and scope these commands as needed. Explicit stable releases require no pending version plans.

The [`Publish` workflow](.github/workflows/publish.yml) publishes through npm trusted publishing. After publication, it promotes the Netlify package version as a GitHub Release with the generated changelog entry. Netlify and npm use the same version. See the [deployment policy](docs/netlify-deployment.md) for release prerequisites and verification. Never run `npm publish` by hand.

---

## Copyright & License

Copyright (c) 2013-2026 Ghost Foundation - Released under the [MIT license](LICENSE). Ghost and the Ghost Logo are trademarks of Ghost Foundation Ltd. Please see our [trademark policy](https://ghost.org/trademark/) for info on acceptable usage.
