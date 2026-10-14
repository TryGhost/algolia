## 0.3.5 (2026-10-14)

### 🩹 Fixes

- Added `prepareIndex()` and `replace(records, contents)` for safe batch imports. Replacement waits for saves to finish before removing stale managed records and skips cleanup if a save fails. Existing settings are preserved unless an explicit settings patch is supplied. Keys without browse permission can still save records and receive `cleanupSkipped: true`.