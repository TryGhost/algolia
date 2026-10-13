# Netlify deployment policy

The root `netlify.toml` runs `pnpm build` in `deployment`: it compiles Tailwind CSS, then runs `build.mts`. This path works when Netlify connects to TryGhost/algolia or a fork. Direct package builds are for development and bypass release selection.

## Release selection

Netlify uses the `@tryghost/algolia-netlify` npm package version. `ALGOLIA_INTEGRATION_VERSION` accepts a major or an exact published version. Unset or `0` selects the newest stable `0.x` release; `1` explicitly opts into major 1. The default major is permanently `0`. Patch and minor releases must preserve configuration and index contracts, including within `0.x`. Incompatible changes or required migrations need a major release.

The loader reads published GitHub Releases tagged `@tryghost/algolia-netlify@VERSION` and their `netlify-release.json` assets. Each asset records the version and full source commit. Drafts are excluded. Unset and major selections ignore prereleases; an exact prerelease version explicitly opts into testing it. Invalid metadata, unavailable releases, and unsupported selections fail the build; branches, ranges, and `latest` are unsupported.

The loader fetches the resolved commit from TryGhost/algolia into `deployment/runtime`, verifies it, and installs with that revision's exact pnpm version and frozen lockfile. Dependency lifecycle scripts are disabled. `deployment/release.json` records the selection, resolved version, and commit. Generated wrappers retain the existing function URLs and add authentication and deployment-context guards.

## Releasing

Use the existing `pnpm ship` flow. Nx versions the selected packages, creates the release commit and tags, and pushes them. The Publish workflow validates and builds the packages, then publishes through npm OIDC. Only after that job succeeds does the dependent promotion job create a draft GitHub Release at the workflow commit, attach `netlify-release.json`, and publish the release. There is no separate catalog or promotion branch.

Nx keeps its normal pre-1.0 bump behavior. When ready for the first major, select `1.0.0` explicitly.

Before the first release, verify each of the five public packages trusts GitHub repository `TryGhost/algolia`, workflow filename `publish.yml`, for `npm publish`. These npm account settings need separate verification. Never replace a published Netlify release tag or manifest; reruns verify existing metadata and reject conflicts.

For a Netlify-only release, preview the scoped command, then run it from a clean `main` checkout:

```sh
pnpm ship patch --projects=@tryghost/algolia-netlify --dry-run
pnpm ship patch --projects=@tryghost/algolia-netlify
```

The current stable package version is `0.4.6`, but no deployable stable GitHub Release exists yet. After this change merges, the first successful Netlify `pnpm ship` release is required before the main customer deployment button can work. Merging source changes alone does not publish a runtime update.

To test before merging, publish an isolated prerelease through the manual Publish workflow on the candidate branch. Set `prerelease-tag` to `pr-333` (its default is empty) and disable dry-run only when ready to publish. Non-main publication requires this explicit input, and every queued version must be a prerelease. npm uses `pr-333`, leaving `latest` unchanged; the matching GitHub Release is marked as a prerelease.

## Deployment boundaries

Authentication and non-production guards belong to the loader. These guards can change independently of the selected indexing runtime, so review loader changes for compatibility. Netlify build tooling, source availability, and registry availability also affect rebuilds. This design does not make a mutable upstream loader or an arbitrarily modified fork immutable.

Builds must not contact Algolia or need customer credentials. The loader uses the build context to disable non-production functions; it does not depend on `CONTEXT` being available at function runtime. Keep production credentials scoped to production Functions. Use a separate Netlify site's production deployment and a separate index for upgrade acceptance.

## Index changes and recovery

Code deployment must not migrate index data or settings. A release that changes the index contract needs explicit migration instructions: retain the old index, populate and verify a replacement, then coordinate the writer and search-UI switch. Roll back both consumers to the retained index if verification fails. Never restore delete-before-save as an upgrade or cleanup strategy.

## Hosted validation

Hosted validation is pending. Before marking #331 complete, use a controlled Netlify site to verify runtime environment loading, packaged function URLs, authenticated publish and unpublish, preview isolation, and a release rollback. Local package and build tests do not establish hosted behavior.

References: [Netlify monorepo configuration](https://docs.netlify.com/build/configure-builds/monorepos/), [Functions environment variables](https://docs.netlify.com/build/functions/environment-variables/), [build context](https://docs.netlify.com/build/configure-builds/environment-variables/).

### Test the customer installation

Use the published candidate [`0.4.7-pr.333.1`](https://github.com/TryGhost/algolia/releases/tag/%40tryghost/algolia-netlify%400.4.7-pr.333.1) to test this PR before merging:

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https%3A%2F%2Fgithub.com%2FTryGhost%2Falgolia&branch=aileen%2Fsafe-netlify-deployments&base=deployment#ALGOLIA_ACTIVE=TRUE&ALGOLIA_APP_ID=&ALGOLIA_API_KEY=&ALGOLIA_INDEX=&NETLIFY_KEY=&ALGOLIA_INTEGRATION_VERSION=0.4.7-pr.333.1)

Use a separate test account, Netlify site, Algolia index, and index-restricted credentials. The button selects the candidate and supplies the build settings. Use the test site's production deployment so indexing can run; deploy previews remain disabled. Keep customer accounts and production indexes out of this verification.

1. Follow [the setup guide](../USAGE.md), using a new webhook secret.
2. Check that the build resolves `0.4.7-pr.333.1` and matches its GitHub Release commit. Open the setup page and copy its generated URLs into a test Ghost integration.
3. Publish, edit, and unpublish a test post, checking the resulting Algolia records. Missing or incorrect query keys must return `401`; removing the configured secret and redeploying must return `503`.
4. Confirm preview functions return `403` without changing the index, and the preview setup page disables URL generation. Production deploy permalinks must generate webhook URLs using Netlify’s canonical site URL.
5. Repeat from a fork with the same exact prerelease selection and no manual build overrides.

For an injection-only check, set `ALGOLIA_ACTIVE=FALSE` in the template. Matching-key requests to both functions should return `Algolia is not activated`; missing or incorrect keys should return `401`. Restore `TRUE` and redeploy before indexing tests.

Verify upgrades and rollback against a second tested release before claiming hosted cross-version validation. Code rollback does not undo Algolia writes.

## Setup page styles

Run `pnpm install --frozen-lockfile` in `deployment`, then `pnpm build:css` after editing the setup page. Tailwind reads `public/index.html` and generates `public/setup.css`; edit `styles.css` for the theme and focus rules. The generated stylesheet is not committed.
