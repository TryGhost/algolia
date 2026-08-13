# Algolia Fragmenter

`@tryghost/algolia-fragmenter` converts Ghost posts into Algolia records and breaks long HTML into heading-based fragments.

## Install

```sh
npm install @tryghost/algolia-fragmenter
```

or

```sh
pnpm add @tryghost/algolia-fragmenter
```

## Usage

Convert Ghost Content API posts, then reduce the resulting records into fragments:

```js
const transforms = require('@tryghost/algolia-fragmenter');

const records = transforms.transformToAlgoliaObject(posts);
const fragments = records.reduce(transforms.fragmentTransformer, []);
```

`transformToAlgoliaObject` accepts an optional array of post slugs to exclude as its second argument. `fragmentTransformer` is designed to be passed directly to `Array#reduce`.

## Development

Install dependencies from the repository root with `pnpm install`. From the root, run this package's tests and lint checks with:

```sh
pnpm --filter @tryghost/algolia-fragmenter test
```

Run the full monorepo suite with `pnpm test`.

---

## Copyright & License

Copyright (c) 2013-2026 Ghost Foundation - Released under the [MIT license](LICENSE). Ghost and the Ghost Logo are trademarks of Ghost Foundation Ltd. Please see our [trademark policy](https://ghost.org/trademark/) for info on acceptable usage.
