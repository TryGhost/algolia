# Netlify deployment policy

The root `netlify.toml` builds through `deployment/build.mts`. This path works when Netlify connects to TryGhost/algolia or a fork. Direct package builds are for development and bypass release selection.

## Release selection

Major selections fetch the shared [upstream catalog](https://raw.githubusercontent.com/TryGhost/algolia/main/deployment/releases.json). It maps stable semantic versions to full Git commit IDs, so forks can receive runtime updates without syncing their source checkout. Exact selections use `deployment/releases.json` from the checkout if it contains that version; otherwise they fetch the upstream catalog.

`ALGOLIA_INTEGRATION_VERSION` accepts a major version or an exact release. Unset or `1` selects the newest stable `1.x` release; `2` explicitly opts into major 2; `1.0.0` pins that exact release. The default major is permanently `1`. Builds fail if a required catalog is unavailable or invalid, or the selection has no matching release. Major selections never fall back to the checkout’s catalog. Branches, tags, ranges, and `latest` are unsupported.

The loader fetches the resolved commit from TryGhost/algolia into `deployment/runtime`, verifies it, and installs with that revision's exact pnpm version and frozen lockfile. Dependency lifecycle scripts are disabled. `deployment/release.json` records the requested selection, resolved version, and commit. Generated functions retain their existing basenames and add authentication and deployment-context guards.

The first release, `1.0.0`, points to `631381e58cb5d74b5ee797b6da70f03b7bae39b7`. Existing installations must configure authenticated webhook URLs before adopting the root deployment configuration.

Catalog entries are append-only: never change or remove an existing version. Patch and minor releases must preserve existing configuration and index contracts. Required configuration changes, incompatible behavior, or index migrations require a major release and explicit user selection. A new release requires:

1. A committed, tested runtime and frozen dependency lockfile with a pinned package manager.
2. A new catalog entry and concise release notes, with migration instructions for a major release.
3. Packaged-handler tests covering publish, unpublish, failed saves, configuration, upgrade, and rollback through the external Algolia requester seam.
4. A controlled Netlify deployment against a separate index before merging the catalog entry. Add the candidate entry on a branch and select its exact version for this test. Once merged, the next rebuild within that major can select it automatically.

npm releases remain separate and use the existing Publish workflow. An npm version alone does not pin the dependencies of a source deployment.

## Deployment boundaries

Authentication and non-production guards belong to the loader. These guards can change independently of the selected indexing runtime, so review loader changes for compatibility. Netlify build tooling, source availability, and registry availability also affect rebuilds. This design does not make a mutable upstream loader or an arbitrarily modified fork immutable.

Builds must not contact Algolia or need customer credentials. The loader uses the build context to disable non-production functions; it does not depend on `CONTEXT` being available at function runtime. Keep production credentials scoped to production Functions. Use a separate Netlify site's production deployment and a separate index for upgrade acceptance.

## Index changes and recovery

Code deployment must not migrate index data or settings. A release that changes the index contract needs explicit migration instructions: retain the old index, populate and verify a replacement, then coordinate the writer and search-UI switch. Roll back both consumers to the retained index if verification fails. Never restore delete-before-save as an upgrade or cleanup strategy.

## Hosted validation

Hosted validation is pending. Before marking #331 complete, use a controlled Netlify site to verify runtime environment loading, packaged function URLs, authenticated publish and unpublish, preview isolation, and a release rollback. Local package and build tests do not establish hosted behavior.

References: [Netlify monorepo configuration](https://docs.netlify.com/build/configure-builds/monorepos/), [Functions environment variables](https://docs.netlify.com/build/functions/environment-variables/), [build context](https://docs.netlify.com/build/configure-builds/environment-variables/).

For the first hosted check, use a test site's production deployment with `ALGOLIA_ACTIVE=FALSE`, a new `NETLIFY_KEY`, and `ALGOLIA_INTEGRATION_VERSION=1.0.0`. The exact pin uses the checkout’s baseline before the upstream catalog reaches `main`. After merging, remove the pin to verify selection through the shared catalog. A request with the matching key should return `Algolia is not activated`; missing or incorrect keys should return `401`. This checks runtime variable injection without Algolia credentials or writes. Verify both handler URLs before enabling a separate test index.

Deploy-preview and branch-deploy contexts pin `1.0.0` in the root configuration so they can build before the catalog reaches `main`. Their generated handlers still disable indexing.
