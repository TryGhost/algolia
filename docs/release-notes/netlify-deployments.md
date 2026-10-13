# Netlify deployment selection (unreleased)

Source deployments now use the root Netlify configuration and receive compatible runtime updates on rebuild. This implements the local build and safety work for #331; hosted validation remains pending.

- The Deploy to Netlify button creates a repository copy and prompts for configuration. After deployment, the site guides setup and generates the private webhook URLs to copy into Ghost. Existing forks can use Netlify’s repository import; build settings come from the repository. Initial indexing still uses the CLI.
- Unset `ALGOLIA_INTEGRATION_VERSION` or `1` selects the latest stable `1.x` release on rebuild. Major upgrades require an explicit selection such as `2`. Pin an exact version such as `1.0.0` for controlled upgrades or rollback. Patch and minor releases preserve configuration and index contracts.
- Major selections fetch the shared upstream catalog on `aileen/integration-releases`, including on forks. Catalog promotion uses reviewed PRs to that branch, separately from merging source changes. Exact pins use the checkout’s catalog when it contains that version, otherwise upstream. An invalid or unavailable required catalog fails the build. Each release pins its source commit, pnpm version, and dependency lockfile; `deployment/release.json` records the resolved version and commit. The first release, `1.0.0`, uses commit `631381e`.
- Both current package handlers and deployment wrappers require a configured `NETLIFY_KEY` and one matching query key. Existing unauthenticated webhooks must add the key before upgrading. Missing server configuration returns `503`; missing, incorrect, empty, or duplicate request keys return `401`.
- Generated preview and branch-deploy handlers return `403` before loading the indexing runtime. Production runtime credentials are excluded from build subprocesses. Existing function basenames stay unchanged.
- The baseline preserves #330's upsert-only publishing, optional content projection, and slug-based unpublishing. It adds no index settings or data migration. Stale-fragment cleanup remains deferred.

If present, clear legacy Netlify base/package/build overrides before adopting the root configuration. Pin the previous exact release or restore a previous deploy to roll back code. Recovering index changes requires a retained index copy or reindexing; code rollback does not undo writes.

Package publication remains subject to the existing scoped Publish workflow. Installing an older npm package directly bypasses deployment guards. Source deployments receive these guards when they adopt this revision, independently of npm publication.
