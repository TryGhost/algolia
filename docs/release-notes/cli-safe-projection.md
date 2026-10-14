# Safe CLI record replacement

Existing CLI configurations and flags continue to work. Projection defaults, aliases, pagination, and record IDs are unchanged. The CLI validates the complete fetched batch before making an Algolia request.

Imports save records and wait for Algolia to finish before deleting stale fragments. Cleanup removes only previously identified package-managed records for the imported post IDs and slugs. A failed save never triggers deletion. Empty or fully excluded batches make no Algolia requests.

Cleanup uses the key's `browse` permission and needs no slug facet. If browsing returns `403`, indexing continues with a warning and leaves old fragments in place. Existing keys need no changes to keep indexing. A missing index starts empty. Other browsing failures stop the import before records are saved or deleted.

Explicit `algolia.indexSettings` still applies your settings patch. Omitting it preserves an existing index's settings; defaults are applied only when the index does not exist. Projection never chooses search settings for you.

Pause other imports and webhook updates during an authoritative import. Replacement is not transactional: a large save can partly succeed, and cleanup can fail after the new records are saved. Rerun after resolving the error. Retain an index copy before changing record schemas or settings, because reverting the CLI cannot restore prior data.

Release the CLI and indexer together so the CLI receives the replacement API it requires. Review any dependency-only Netlify release for unchanged handler behavior.
