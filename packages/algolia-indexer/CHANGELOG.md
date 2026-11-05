## 0.3.6 (2026-11-05)

### 🚀 Features

- Added dormant Ghost content identity operations: `browseContentIdentities()`, `replaceContent()`, `deleteContent()`, and `reconcileContent()` group, replace, delete, and reconcile package-managed records by stable Ghost content ID instead of slug. The existing slug-based operations and settings behavior are unchanged, and nothing uses the new operations until an index opts in through the one-time identity migration. One small fix in the shared error mapping: a transport error without a message now reports `Error processing Algolia` instead of `[object Object]`; the error fields are otherwise unchanged.

## 0.3.5 (2026-10-14)

### 🩹 Fixes

- Added `prepareIndex()` and `replace(records, contents)` for safe batch imports. Replacement waits for saves to finish before removing stale managed records and skips cleanup if a save fails. Existing settings are preserved unless an explicit settings patch is supplied. Keys without browse permission can still save records and receive `cleanupSkipped: true`.