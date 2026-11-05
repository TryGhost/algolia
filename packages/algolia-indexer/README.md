# Algolia Indexer

`@tryghost/algolia-indexer` configures an Algolia index and saves or removes the records produced by the Ghost Algolia tools.

## Install

```sh
npm install @tryghost/algolia-indexer
```

or

```sh
pnpm add @tryghost/algolia-indexer
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

## Safe replacement

For a batch import, call `prepareIndex()` to preserve existing settings. It applies an explicitly supplied `indexSettings` patch, or initializes defaults when the index does not exist.

After validating the entire batch with the fragmenter, call `replace(records, contents)`. Each entry in `contents` must provide the imported post's `id` and `slug`. Replacement captures existing managed record IDs, saves the new records, waits for Algolia to finish, then removes captured IDs that are absent from the new set. Failed saves prevent cleanup; cleanup errors reject the operation and can be retried.

If the key cannot browse the index, replacement still saves records and returns `{cleanupSkipped: true}`. Callers should warn that stale fragments remain. Pause concurrent writers during a batch import; replacement is not transactional.

## Ghost content identity

These operations work on the protected `contentId` and `contentType` fields that the fragmenter repeats in every record when its `contentType` option is set. They stay dormant until an index has completed the one-time identity migration; the slug-based operations above keep working unchanged. None of them reads or writes index settings.

- `browseContentIdentities()` returns every record's `objectID`, `slug`, `contentId`, and `contentType` (missing values come back as `null`) for classification and migration preflight.
- `replaceContent(records, contents)` mirrors `replace`, keyed by Ghost content ID instead of slug. Each entry in `contents` provides `contentId` and `contentType`, every record must belong to one of those identities, and saves are confirmed before that content's stale records are removed. A key without browse permission still saves and returns `{cleanupSkipped: true}`.
- `deleteContent(contentId)` removes every record carrying one Ghost content ID and waits for completion. It needs the `filterOnly(contentId)` facet from the identity migration.
- `reconcileContent(records)` removes the identity-managed records a complete run no longer produces, leaving records without identity fields untouched. Run it only after every replacement save is confirmed.

## Development

Install dependencies from the repository root with `pnpm install`. From the root, run this package's tests and lint checks with:

```sh
pnpm --filter @tryghost/algolia-indexer test
```

Run the full monorepo suite with `pnpm test`.

---

## Copyright & License

Copyright (c) 2013-2026 Ghost Foundation - Released under the [MIT license](LICENSE). Ghost and the Ghost Logo are trademarks of Ghost Foundation Ltd. Please see our [trademark policy](https://ghost.org/trademark/) for info on acceptable usage.
