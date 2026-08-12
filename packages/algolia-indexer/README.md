# Algolia Indexer

`@tryghost/algolia-indexer` configures an Algolia index and saves or removes the records produced by the Ghost Algolia tools.

## Install

```sh
npm install @tryghost/algolia-indexer
```

or

```sh
yarn add @tryghost/algolia-indexer
```

## Usage

Create an indexer with an Algolia application ID, Admin API key, and index name:

```js
const IndexFactory = require('@tryghost/algolia-indexer');

async function indexFragments(fragments) {
    const index = new IndexFactory({
        appId: process.env.ALGOLIA_APP_ID,
        apiKey: process.env.ALGOLIA_API_KEY,
        index: process.env.ALGOLIA_INDEX
    });

    await index.setSettingsForIndex();
    await index.save(fragments);
}
```

Call `initIndex()` before `delete(slug)` when removing every fragment associated with a post slug. `setSettingsForIndex()` initializes the index and applies the package's required settings unless custom `indexSettings` are supplied to the constructor.

## Development

Install dependencies from the repository root with `yarn`. From the root, run this package's tests and ESLint checks with:

```sh
yarn workspace @tryghost/algolia-indexer test
```

Run the full monorepo suite with `yarn test`.

---

## Copyright & License

Copyright (c) 2013-2026 Ghost Foundation - Released under the [MIT license](LICENSE). Ghost and the Ghost Logo are trademarks of Ghost Foundation Ltd. Please see our [trademark policy](https://ghost.org/trademark/) for info on acceptable usage.
