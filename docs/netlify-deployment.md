# Netlify deployment policy

The root `netlify.toml` builds through `deployment/build.mts`. This path works when Netlify connects to TryGhost/algolia or a fork. Direct package builds are for development and bypass release selection.

## Release selection

Major selections fetch the shared [upstream catalog](https://raw.githubusercontent.com/TryGhost/algolia/refs/heads/aileen/integration-releases/deployment/releases.json). The catalog lives on the dedicated `aileen/integration-releases` branch. It maps stable semantic versions to full Git commit IDs, so forks can receive runtime updates without syncing their source checkout. Exact selections use `deployment/releases.json` from the checkout if it contains that version; otherwise they fetch the upstream catalog.

`ALGOLIA_INTEGRATION_VERSION` accepts a major version or an exact release. Unset or `1` selects the newest stable `1.x` release; `2` explicitly opts into major 2; `1.0.0` pins that exact release. The default major is permanently `1`. Builds fail if a required catalog is unavailable or invalid, or the selection has no matching release. Major selections never fall back to the checkout’s catalog. Branches, tags, ranges, and `latest` are unsupported.

The loader fetches the resolved commit from TryGhost/algolia into `deployment/runtime`, verifies it, and installs with that revision's exact pnpm version and frozen lockfile. Dependency lifecycle scripts are disabled. `deployment/release.json` records the requested selection, resolved version, and commit. The loader generates wrappers inside `deployment/runtime/packages/algolia-netlify/deployment-functions` so Netlify traces dependencies from the selected runtime package. They retain the existing function basenames and add authentication and deployment-context guards.

The first release, `1.0.0`, points to `631381e58cb5d74b5ee797b6da70f03b7bae39b7`. Existing installations must configure authenticated webhook URLs before adopting the root deployment configuration.

Catalog entries are append-only: never change or remove an existing version. Patch and minor releases must preserve existing configuration and index contracts. Required configuration changes, incompatible behavior, or index migrations require a major release and explicit user selection. A new release requires:

1. A committed, tested runtime and frozen dependency lockfile with a pinned package manager.
2. A new catalog entry and concise release notes, with migration instructions for a major release.
3. Packaged-handler tests covering publish, unpublish, failed saves, configuration, upgrade, and rollback through the external Algolia requester seam.
4. A controlled Netlify deployment against a separate index before promoting the catalog entry. Add the candidate entry to the source branch’s local catalog and select its exact version for this test. Then open a reviewed PR targeting `aileen/integration-releases` to append the entry to its `deployment/releases.json`. Once merged there, the next rebuild within that major can select it automatically. Merging source code to `main` alone does not promote a runtime release.

npm releases remain separate and use the existing Publish workflow. An npm version alone does not pin the dependencies of a source deployment.

## Deployment boundaries

Authentication and non-production guards belong to the loader. These guards can change independently of the selected indexing runtime, so review loader changes for compatibility. Netlify build tooling, source availability, and registry availability also affect rebuilds. This design does not make a mutable upstream loader or an arbitrarily modified fork immutable.

Builds must not contact Algolia or need customer credentials. The loader uses the build context to disable non-production functions; it does not depend on `CONTEXT` being available at function runtime. Keep production credentials scoped to production Functions. Use a separate Netlify site's production deployment and a separate index for upgrade acceptance.

## Index changes and recovery

Code deployment must not migrate index data or settings. A release that changes the index contract needs explicit migration instructions: retain the old index, populate and verify a replacement, then coordinate the writer and search-UI switch. Roll back both consumers to the retained index if verification fails. Never restore delete-before-save as an upgrade or cleanup strategy.

## Hosted validation

Hosted validation is pending. Before marking #331 complete, use a controlled Netlify site to verify runtime environment loading, packaged function URLs, authenticated publish and unpublish, preview isolation, and a release rollback. Local package and build tests do not establish hosted behavior.

References: [Netlify monorepo configuration](https://docs.netlify.com/build/configure-builds/monorepos/), [Functions environment variables](https://docs.netlify.com/build/functions/environment-variables/), [build context](https://docs.netlify.com/build/configure-builds/environment-variables/).

### Test the customer installation from this PR

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https%3A%2F%2Fgithub.com%2FTryGhost%2Falgolia&branch=aileen%2Fsafe-netlify-deployments&base=deployment#ALGOLIA_ACTIVE=TRUE&ALGOLIA_APP_ID=&ALGOLIA_API_KEY=&ALGOLIA_INDEX=&NETLIFY_KEY=)

Use the standard [Deploy to Netlify flow](https://docs.netlify.com/deploy/create-deploys/#deploy-to-netlify-button). As checked on 13 October 2026, the public Netlify app redirects `fullConfiguration=true` links to a template flow without preserving `branch` or `base`. Keep that parameter off these buttons; link the setup guide directly and provide the remaining instructions on the deployed site.

This button follows the customer flow using the PR branch. It needs no manual build settings or version pin: the default major resolves through the shared catalog before the source PR merges.

1. Prepare a separate Algolia test index with the CLI and an index-restricted API key.
2. Read [the setup guide](../USAGE.md), then use the button and enter the test credentials and a new webhook secret. Keep the prefilled `ALGOLIA_ACTIVE=TRUE`.
3. Compare the build’s resolved version and commit with the newest stable `1.x` entry in the shared catalog, then open the published setup page. Enter the same secret and copy its generated URLs into a test Ghost integration.
4. Publish, edit, and unpublish a test post. Check the resulting records in Algolia. Missing or incorrect query keys must return `401`; removing the configured secret and redeploying must return `503`.
5. Confirm preview functions return `403` and do not change the test index. The preview setup page must disable URL generation. On production deploy permalinks, generated webhook URLs must use Netlify’s canonical site URL so Ghost follows future deployments.
6. Repeat from an existing fork without manual build overrides. Check that the default major reads the same upstream catalog.

For an injection-only check, set `ALGOLIA_ACTIVE=FALSE` in the template. Matching-key requests to both functions should return `Algolia is not activated`; missing or incorrect keys should return `401`. Restore `TRUE` and redeploy before indexing tests.

Verify upgrades and rollback against a second tested release before claiming hosted cross-version validation. Code rollback does not undo Algolia writes.
