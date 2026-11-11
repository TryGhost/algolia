## 0.4.3 (2026-11-11)

### 🩹 Fixes

- Added a maintainer differential record smoke harness beside the package source. It compares the workspace's record output with the latest published release over live Ghost content in a scheduled workflow. Nothing changes for package consumers: records, options, exports, and the published build output are identical.

## 0.4.2 (2026-11-05)

### 🚀 Features

- Added an opt-in `contentType` option to `createAlgoliaRecords`. Declaring the batch as `'post'` or `'page'` content repeats the protected `contentId` and `contentType` fields in every derived record, counted inside the record byte ceiling. Records keep their existing shape when the option is omitted. One configuration contract change: projection and ranking aliases can no longer take the two identity names, so rename any alias called `contentId` or `contentType` before upgrading.

## 0.4.1 (2026-10-14)

### 🚀 Features

- Added `{extraction: 'rich'}` to opt in to richer rendered meaning when building Algolia records. Default extraction, deprecated wrappers, and record-size safeguards remain unchanged.

### 🧱 Updated Dependencies

- Updated @tryghost/algolia-html-extractor to 0.1.1