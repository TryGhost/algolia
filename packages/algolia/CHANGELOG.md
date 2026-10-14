## 0.3.8 (2026-10-14)

### 🧱 Updated Dependencies

- Updated @tryghost/algolia-fragmenter to 0.4.1

## 0.3.7 (2026-10-14)

### 🩹 Fixes

- Imports now wait for new records to finish saving before removing stale fragments. A failed save prevents cleanup. Existing configuration keeps working, and index settings are preserved unless explicitly supplied. Keys without browse permission can still save records; the CLI warns when cleanup is skipped. Pause other imports and webhook updates during a batch import.

### 🧱 Updated Dependencies

- Updated @tryghost/algolia-indexer to 0.3.5