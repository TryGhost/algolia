# Netlify deployment policy

Existing root and package-directory deployments keep building their connected source revision with unchanged configuration and webhook authentication. They do not use release selection or require a stable GitHub Release.

The Deploy to Netlify button explicitly selects base directory `deployment`, whose `netlify.toml` runs `pnpm build`: it compiles Tailwind CSS, then runs `build.mts`. Existing sites can [migrate voluntarily](../packages/algolia-netlify/README.md#existing-installations). Set the production Functions secret and update Ghost's webhook URLs before switching the base directory.

The release policy below applies to sites that opt into `deployment`.

## Release selection

Netlify uses the `@tryghost/algolia-netlify` npm package version. `ALGOLIA_INTEGRATION_VERSION` accepts a major or an exact published version. Unset or `0` selects the newest stable `0.x` release; `1` explicitly opts into major 1. The default major is permanently `0`. Patch and minor releases must preserve configuration and index contracts, including within `0.x`. Incompatible changes or required migrations need a major release.

The loader reads published GitHub Releases tagged `@tryghost/algolia-netlify@VERSION` and their `netlify-release.json` assets. Each asset records the version and full source commit. Drafts are excluded. Unset and major selections ignore prereleases; an exact prerelease version explicitly opts into testing it. Invalid metadata, unavailable releases, and unsupported selections fail the build; branches, ranges, and `latest` are unsupported.

If release lookups hit GitHub API rate limits, optionally set `GITHUB_TOKEN` in Netlify’s production Builds scope and retry. Public repository access is sufficient. The loader sends it only to `https://api.github.com`; it is excluded from asset downloads and runtime build subprocesses. Existing source deployments do not need it.

The loader fetches the resolved commit from TryGhost/algolia into `deployment/runtime`, verifies it, and installs with that revision's exact pnpm version and frozen lockfile. Dependency lifecycle scripts are disabled. `deployment/release.json` records the selection, resolved version, and commit. Generated wrappers retain the existing function URLs and add authentication and deployment-context guards.

## Releasing

Use the existing `pnpm ship` flow. Nx versions the selected packages, creates the release commit and tags, and pushes them. The Publish workflow validates and builds the packages, then publishes through npm OIDC. Only after that job succeeds does the dependent promotion job create a draft GitHub Release at the workflow commit, attach `netlify-release.json`, and publish the release. There is no separate catalog or promotion branch.

Nx keeps its normal pre-1.0 bump behavior. When ready for the first major, select `1.0.0` explicitly.

Each public package must trust GitHub repository `TryGhost/algolia`, workflow filename `publish.yml`, for `npm publish`. Never replace a published Netlify release tag or manifest; reruns verify existing metadata and reject conflicts.

For a Netlify-only release, preview the scoped command, then run it from a clean `main` checkout:

```sh
pnpm ship patch --projects=@tryghost/algolia-netlify --dry-run
pnpm ship patch --projects=@tryghost/algolia-netlify
```

Release-based deployments require a published GitHub Release for the selected version or major. Existing source deployments build independently of releases. Merging source changes does not publish a runtime update.

For pre-merge development, follow [Testing a Netlify prerelease](testing-prereleases.md) to version, publish, deploy, and verify an isolated candidate. Ordinary customer updates ignore prereleases.

## Deployment boundaries

Mandatory authentication and non-production guards belong to the opt-in loader. Direct source handlers accept requests with a missing or empty `key`. A non-empty `key` must match `NETLIFY_KEY`; duplicate keys are rejected. These guards can change independently of the selected indexing runtime, so review loader changes for compatibility. Netlify build tooling, source availability, and registry availability also affect rebuilds. This design does not make a mutable upstream loader or an arbitrarily modified fork immutable.

Builds must not contact Algolia or need customer credentials. The loader uses the build context to disable non-production functions; it does not depend on `CONTEXT` being available at function runtime. Keep production credentials scoped to production Functions. Use a separate Netlify site's production deployment and a separate index for upgrade acceptance.

## Index changes and recovery

Code deployment must not migrate index data or settings. A release that changes the index contract needs explicit migration instructions: retain the old index, populate and verify a replacement, then coordinate the writer and search-UI switch. Roll back both consumers to the retained index if verification fails. Never restore delete-before-save as an upgrade or cleanup strategy.

## Hosted validation

Use a dedicated Netlify site, a test Ghost site, and a separate Algolia index to verify runtime configuration, authenticated webhooks, preview isolation, and rollback. Follow [the prerelease testing guide](testing-prereleases.md) for the steps and expected results.

### Test the customer installation

Generate a Deploy to Netlify link for the branch and exact release you want to test using [the deployment instructions](testing-prereleases.md#deploy-the-customer-flow). Test the production deployment of the dedicated site; previews intentionally disable indexing. Repeat the installation from a fork.

Record results and incomplete checks in the pull request.

References: [Netlify monorepo configuration](https://docs.netlify.com/build/configure-builds/monorepos/), [Functions environment variables](https://docs.netlify.com/build/functions/environment-variables/), [build context](https://docs.netlify.com/build/configure-builds/environment-variables/).

## Setup page styles

Run `pnpm install --frozen-lockfile` in `deployment`, then `pnpm build:css` after editing the setup page. Tailwind reads `public/index.html` and generates `public/setup.css`; edit `styles.css` for the theme and focus rules. The generated stylesheet is not committed.
