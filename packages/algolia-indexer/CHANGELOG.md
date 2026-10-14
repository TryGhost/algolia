# Changelog

## [Unreleased]

### Added

- `prepareIndex()` preserves existing settings, initializes missing indexes, and applies explicit settings patches.
- `replace(records, contents)` confirms saves before deleting stale managed records. It reports skipped cleanup when the key lacks browse permission.

### Fixed

- Keep constructor defaults out of the caller's options object, so reusing it does not overwrite existing index settings.
