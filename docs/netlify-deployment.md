# Netlify deployment policy

The root `netlify.toml` builds through `deployment/build.mts`. This path works when Netlify connects to TryGhost/algolia or a fork. Direct package builds are for development and do not select a fixed integration release.

## Release selection

`deployment/releases.mts` maps integration release names to full Git commit IDs. The loader fetches the selected commit from TryGhost/algolia into `deployment/runtime`, verifies the commit, and installs with that revision's exact pnpm version and frozen lockfile. Dependency lifecycle scripts are disabled. The generated functions retain their existing basenames and add authentication and deployment-context guards.

The unset default is permanently `2026-10-12.1`, pointing to `631381e58cb5d74b5ee797b6da70f03b7bae39b7`. Existing installations adopt that baseline when they switch to the root deployment configuration. They must configure authenticated webhook URLs before upgrading.

Releases are append-only: never move an existing name or change the default. A new release requires:

1. A committed, tested runtime and frozen dependency lockfile with a pinned package manager.
2. A new catalog entry and concise migration notes, including any index-contract change.
3. Packaged-handler tests covering publish, unpublish, failed saves, configuration, upgrade, and rollback through the external Algolia requester seam.
4. A controlled Netlify deployment against a separate index before recommending the release.

Reject unsupported selections; never resolve branches, tags, ranges, or `latest`. npm releases remain separate and use the existing Publish workflow. An npm version alone does not pin the dependencies of a source deployment.

## Deployment boundaries

Authentication and non-production guards belong to the loader. These guards can change independently of the selected indexing runtime, so review loader changes for compatibility. Netlify build tooling, source availability, and registry availability also affect rebuilds. This design does not make a mutable upstream loader or an arbitrarily modified fork immutable.

Builds must not contact Algolia or need customer credentials. The loader uses the build context to disable non-production functions; it does not depend on `CONTEXT` being available at function runtime. Keep production credentials scoped to production Functions. Use a separate Netlify site's production deployment and a separate index for upgrade acceptance.

## Index changes and recovery

Code deployment must not migrate index data or settings. A release that changes the index contract needs explicit migration instructions: retain the old index, populate and verify a replacement, then coordinate the writer and search-UI switch. Roll back both consumers to the retained index if verification fails. Never restore delete-before-save as an upgrade or cleanup strategy.

## Hosted validation

Hosted validation is pending. Before marking #331 complete, use a controlled Netlify site to verify runtime environment loading, packaged function URLs, authenticated publish and unpublish, preview isolation, and a release rollback. Local package and build tests do not establish hosted behavior.

References: [Netlify monorepo configuration](https://docs.netlify.com/build/configure-builds/monorepos/), [Functions environment variables](https://docs.netlify.com/build/functions/environment-variables/), [build context](https://docs.netlify.com/build/configure-builds/environment-variables/).

For the first hosted check, use a test site's production deployment with `ALGOLIA_ACTIVE=FALSE` and a new `NETLIFY_KEY`. A request with the matching key should return `Algolia is not activated`; missing or incorrect keys should return `401`. This checks runtime variable injection without Algolia credentials or writes. Verify both handler URLs before enabling a separate test index.
