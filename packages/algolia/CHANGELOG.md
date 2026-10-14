# Changelog

## [Unreleased]

### Fixed

- Wait for Algolia to finish saving imported records before deleting stale fragments. Failed saves leave existing fragments available.
- Preserve existing index settings when `algolia.indexSettings` is omitted. Explicit settings still apply as configured.
- Keep indexing with existing keys that lack browse permission, and warn when stale-fragment cleanup is skipped.
- Leave unrelated records untouched and make no Algolia requests when every post is excluded or the import is empty.
