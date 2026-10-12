# Netlify deployment selection (unreleased)

Source deployments now use the root Netlify configuration and a fixed integration release. This implements the local build and safety work for #331; hosted validation remains pending.

- The default release is `2026-10-12.1`, the indexing runtime from commit `631381e`. Optional `ALGOLIA_INTEGRATION_VERSION` selects an entry from the append-only release catalog. The selected commit, pnpm version, and frozen dependency lockfile control the runtime build. Later npm or source changes do not automatically select new indexing code.
- Both current package handlers and deployment wrappers require a configured `NETLIFY_KEY` and one matching query key. Existing unauthenticated webhooks must add the key before upgrading. Missing server configuration returns `503`; missing, incorrect, empty, or duplicate request keys return `401`.
- Generated preview and branch-deploy handlers return `403` before loading the indexing runtime. Production runtime credentials are excluded from build subprocesses. Existing function basenames stay unchanged.
- The baseline preserves #330's upsert-only publishing, optional content projection, and slug-based unpublishing. It adds no index settings or data migration. Stale-fragment cleanup remains deferred.

Clear legacy Netlify base/package/build overrides before adopting the root configuration. Revert the selected release or restore a previous deploy to roll back code. Recovering index changes requires a retained index copy or reindexing; code rollback does not undo writes.

Package publication remains subject to the existing scoped Publish workflow. Installing an older npm package directly bypasses deployment guards. Source deployments receive these guards when they adopt this revision, independently of npm publication.
