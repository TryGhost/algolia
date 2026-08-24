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

`createAlgoliaRecords` turns Ghost content into complete final Algolia records in one synchronous call. It owns projection, HTML extraction, heading-anchor grouping, fallback records, deep links, identifiers, ranking metadata, record-size handling, and validation:

```js
import {createAlgoliaRecords} from '@tryghost/algolia-fragmenter';

const records = createAlgoliaRecords(posts);
```

Every record contains the package-owned fields `objectID`, `slug`, `url`, `html`, `title`, `headings`, `anchor`, and `customRanking` with its `position` and `heading` values. Ghost content that produces no extraction fragments emits one fallback record with empty `html`, no anchor, and the headingless rank. The required Ghost input fields are `id`, `slug`, `url`, `title`, and `html`.

### Options

```js
const records = createAlgoliaRecords(posts, {
    ignoreSlugs: ['secret-page'],
    contentProjection: {
        fields: ['image', 'tags', {source: 'reading_time', as: 'readingMinutes'}],
        customRanking: [{source: 'featured', as: 'isFeatured'}]
    }
});
```

- `ignoreSlugs` excludes content by slug before the rest of its fields are validated.
- `contentProjection.fields` is required whenever `contentProjection` is supplied and is the complete optional field set; it replaces the default set rather than patching it, and `[]` selects no optional fields. Without `contentProjection`, the optional fields are `image`, `tags`, `authors`, and `excerpt`.
- `contentProjection.customRanking` adds ranking siblings beside the package-owned `position` and `heading` values. Each sibling needs a validated alias.

The optional source allowlist is `image`, `tags`, `authors`, `excerpt`, `custom_excerpt`, `feature_image_alt`, `feature_image_caption`, `canonical_url`, `featured`, `visibility`, `created_at`, `updated_at`, `published_at`, and `reading_time`. Ranking siblings may only be sourced from `featured` and `reading_time`. A field may be aliased with `{source, as}`, where `as` matches `^[A-Za-z][A-Za-z0-9_]*$` and changes only the output key.

Enabled optional fields are repeated in every record derived from the same Ghost content. A missing scalar becomes `null`, missing `tags` or `authors` become `[]`, and meaningful `false`, `0`, and empty-string values are preserved. `image` reads Ghost's `feature_image`, and `tags` and `authors` keep the `{name, slug}` shape.

### Record size

Every complete record stays within 9,999 compact UTF-8 bytes. Whole extraction fragments are packed greedily and never truncated: the first record of an anchor group keeps `<content id>_<group index>` and continuations add `_<continuation index>`. An indivisible fragment, or required metadata that leaves no room for one, fails instead of being shortened.

### Errors

`createAlgoliaRecords` validates the whole batch and returns no records when any deterministic problem exists — it never returns a partial array. It throws one `FragmenterError` whose `code` is `INVALID_POLICY`, `INVALID_GHOST_CONTENT`, or `RECORD_TOO_LARGE`, and whose `issues` array lists every issue in input order:

```js
import {createAlgoliaRecords, FragmenterError} from '@tryghost/algolia-fragmenter';

try {
    createAlgoliaRecords(posts, options);
} catch (error) {
    if (error instanceof FragmenterError) {
        console.error(error.code, error.issues);
    }
}
```

Policy issues carry the configuration `path` that must change. Content issues add the batch `index`, the Ghost content id, and the expected type; both are `null` when the batch itself is not an array, and the content id is also `null` when the content has no usable `id`. Size issues add the record's `objectID`, the anchor and source position when available, the measured `bytes`, the 9,999-byte `limit`, and the `excess`.

### Deprecated wrappers

```js
import {fragmentTransformer, transformToAlgoliaObject} from '@tryghost/algolia-fragmenter';

const records = transformToAlgoliaObject(posts);
const fragments = records.reduce(fragmentTransformer, []);
```

`transformToAlgoliaObject` accepts an optional array of post slugs to exclude as its second argument. `fragmentTransformer` is designed to be passed directly to `Array#reduce`.

Both operations are deprecated compatibility wrappers. They keep their existing output, do not receive the projection policy, and do not apply the record-size behaviour. New callers should use `createAlgoliaRecords`.

This package is ESM-only and requires Node.js 24 or later.

## Development

Install dependencies from the repository root with `pnpm install`. From the root, run this package's tests and lint checks with:

```sh
pnpm --filter @tryghost/algolia-fragmenter test
```

Run the full monorepo suite with `pnpm test`.

---

## Copyright & License

Copyright (c) 2013-2026 Ghost Foundation - Released under the [MIT license](LICENSE). Ghost and the Ghost Logo are trademarks of Ghost Foundation Ltd. Please see our [trademark policy](https://ghost.org/trademark/) for info on acceptable usage.
