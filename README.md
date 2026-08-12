# Ghost Algolia tools

JavaScript tools for turning Ghost posts into records and keeping an Algolia search index up to date.

> [!IMPORTANT]
> Maintenance of this repository has resumed. The CLI supports Ghost 6 by requesting up to 100 posts at a time and following Ghost's pagination metadata until every post has been fetched.

## Tools

This Yarn and Lerna monorepo contains four public packages:

- [`@tryghost/algolia`](packages/algolia/README.md) provides a CLI for initially indexing a Ghost site's published posts.
- [`@tryghost/algolia-netlify`](packages/algolia-netlify/README.md) provides Netlify Functions that process Ghost post webhooks and update an index.
- [`@tryghost/algolia-fragmenter`](packages/algolia-fragmenter/README.md) converts Ghost posts into Algolia records and splits their HTML by heading.
- [`@tryghost/algolia-indexer`](packages/algolia-indexer/README.md) manages Algolia index settings, records, and deletions.

## Usage

### Netlify Functions

> [!WARNING]
> The current handlers do not enforce authentication when the `key` query parameter is omitted. A public function URL is not a secret; do not expose these functions publicly until authentication is enforced or access is restricted outside the handlers.

Deployment, Algolia configuration, and Ghost webhook setup are described in the [`@tryghost/algolia-netlify` guide](packages/algolia-netlify/README.md).

### CLI

Use the CLI for the initial batch index of a site's published posts. Installation, configuration, and command options are documented in the [`@tryghost/algolia` guide](packages/algolia/README.md).

## Development

Use the Node version declared in [`.nvmrc`](.nvmrc), then install the monorepo dependencies and link its workspaces:

```sh
yarn
```

Run the full test suite, including package lint checks:

```sh
yarn test
```

Run only ESLint across the packages:

```sh
yarn lint
```

Package-specific development and verification commands are documented in each package README.

## Publishing

The repository currently publishes changed packages through Lerna:

```sh
yarn ship
```

This is a maintainer-only release operation for public npm packages and runs the full test suite first.

---

## Copyright & License

Copyright (c) 2013-2026 Ghost Foundation - Released under the [MIT license](LICENSE). Ghost and the Ghost Logo are trademarks of Ghost Foundation Ltd. Please see our [trademark policy](https://ghost.org/trademark/) for info on acceptable usage.
