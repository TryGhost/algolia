# Optional Netlify deployment selection (unreleased)

Existing root and package-directory deployments keep their build configuration, webhook URLs, and authentication behavior. No new environment variables or published deployment release are required to keep them working.

The new deployment setup is an explicit opt-in through the Deploy to Netlify button or the [migration steps](../../packages/algolia-netlify/README.md#existing-installations):

- Base directory `deployment` selects published runtimes and provides a guided setup page. The page verifies the existing webhook secret before generating private URLs for Ghost. Initial indexing still uses the CLI.
- Unset `ALGOLIA_INTEGRATION_VERSION` or `0` selects the latest stable `0.x` release on rebuild, including from forks. Major upgrades require an explicit selection. Exact published versions support pinning and rollback; automatic updates exclude prereleases.
- Netlify and npm share the `@tryghost/algolia-netlify` version. Successful npm publication promotes an immutable GitHub Release with its source commit. Each runtime uses its pinned pnpm version and dependency lockfile.
- Only the opt-in deployment wrappers require a configured `NETLIFY_KEY` and one matching query key. Configure the secret and update Ghost's webhook URLs before switching the base directory. Missing server configuration returns `503`; invalid request keys return `401`.
- Opt-in preview and branch-deploy handlers return `403` before loading the runtime. Production runtime credentials are excluded from build subprocesses.

Publishing still upserts without deleting existing records first, and unpublishing deletes by slug. This change requires no index settings or data migration. Stale-fragment cleanup remains deferred. Code rollback does not undo accepted index writes.

The first stable Netlify package release is required for the new customer button's default selection. Existing source deployments remain independent of that release; the explicit prerelease supports testing the new setup before merge. Hosted preview isolation and cross-version rollback validation remain pending.
