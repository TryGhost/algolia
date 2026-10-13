# Testing a Netlify prerelease

Use this flow to test a PR before merging. You need push and workflow access to `TryGhost/algolia`, a test Ghost site, a dedicated Netlify site, and a separate Algolia index. npm publication uses the repository's trusted publisher.

The Netlify setup comes from the connected branch; its indexing runtime comes from the selected release's immutable commit. Runtime changes need a new prerelease. Setup page or loader changes need an updated repository copy and rebuild.

## Check locally

Use the Node version in `.nvmrc`. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --dir deployment install --frozen-lockfile --ignore-scripts
pnpm --dir deployment build:css
pnpm test:coverage
pnpm typecheck
pnpm lint
```

These checks run offline after installation. They cover release selection, publication failures, retries, legacy build configuration, setup verification, and webhook indexing with a fake Algolia requester.

## Publish a candidate

Commit your changes on the PR branch first. Choose an unused version in the form `BASE-pr.PR_NUMBER.SEQUENCE`. Start the sequence at 1 and increment it for each published candidate.

From that clean branch, replace `MAJOR.MINOR.PATCH` with the intended stable version. The command reads the PR number from GitHub:

```sh
candidate_branch=$(git branch --show-current)
candidate_base=MAJOR.MINOR.PATCH
candidate_pr=$(gh pr view --repo TryGhost/algolia --json number --jq .number)
candidate_sequence=1
candidate_version="$candidate_base-pr.$candidate_pr.$candidate_sequence"
candidate_channel="pr-$candidate_pr"

pnpm ship "$candidate_version" --projects=@tryghost/algolia-netlify --dry-run
pnpm ship "$candidate_version" --projects=@tryghost/algolia-netlify
```

Review the dry run before running the second command. It creates and pushes the version commit and tag. Branch pushes do not publish automatically. If Nx includes dependent packages, every unpublished version must match the PR channel; the workflow rejects stable versions on this channel.

Preview publication from the pushed branch:

```sh
gh workflow run publish.yml --repo TryGhost/algolia --ref "$candidate_branch" \
  -f dry-run=true -f prerelease-tag="$candidate_channel"
gh run list --repo TryGhost/algolia --workflow publish.yml --branch "$candidate_branch" --limit 1
```

Open that run and confirm the queued packages and versions. Record the current stable npm tag with `npm view @tryghost/algolia-netlify dist-tags --json`. Then publish:

```sh
gh workflow run publish.yml --repo TryGhost/algolia --ref "$candidate_branch" \
  -f dry-run=false -f prerelease-tag="$candidate_channel"
```

Wait for both **Publish to npm** and **Promote Netlify integration** to succeed. Check:

```sh
npm view @tryghost/algolia-netlify dist-tags --json
gh release view "@tryghost/algolia-netlify@$candidate_version" --repo TryGhost/algolia
```

The PR channel must point to your candidate and `latest` must be unchanged. The GitHub Release must be marked as a prerelease and contain `netlify-release.json` with the candidate version and full tagged commit. Never replace published tags or assets. For a failed run, rerun the same commit; for changed runtime code, increment the sequence and publish again.

## Deploy the customer flow

Generate a Deploy to Netlify link using the branch and version variables from the publication steps:

```sh
node --input-type=module - "$candidate_branch" "$candidate_version" <<'JS'
const [branch, version] = process.argv.slice(2);
const url = new URL('https://app.netlify.com/start/deploy');
url.search = new URLSearchParams({
    repository: 'https://github.com/TryGhost/algolia',
    branch,
    base: 'deployment'
});
url.hash = new URLSearchParams({
    ALGOLIA_ACTIVE: 'FALSE',
    ALGOLIA_APP_ID: '',
    ALGOLIA_API_KEY: '',
    ALGOLIA_INDEX: '',
    NETLIFY_KEY: '',
    ALGOLIA_INTEGRATION_VERSION: version
});
console.log(url.href);
JS
```

Open the printed link to start the guided deployment. It creates a repository copy, so push or sync subsequent setup changes into that copy before rebuilding.

Follow [the customer setup guide](../USAGE.md) with test credentials. Start with `ALGOLIA_ACTIVE=FALSE` to verify configuration without indexing. For an existing dedicated test site, keep base directory `deployment` and set the exact candidate in `ALGOLIA_INTEGRATION_VERSION` for production Builds. Algolia credentials and `NETLIFY_KEY` must be available to production Functions. Redeploy after environment changes.

1. In the build log, confirm `deployment/netlify.toml` and `Prepared Algolia integration VERSION (COMMIT)`. Compare both values with the release manifest. A successful build alone does not verify function credentials.
2. Open the setup page. It must report indexing paused. A wrong secret must fail verification and hide webhook URLs; the configured secret must reveal them. Editing the secret must hide them again.
3. With indexing paused, open each generated webhook URL and confirm the response is `Algolia is not activated`. Add the four Ghost webhooks shown on the page and publish a test post; the index must remain unchanged.
4. Set `ALGOLIA_ACTIVE=TRUE` and redeploy. Confirm the page reports indexing enabled. Publish a post with a distinctive phrase and several headings, then edit it and unpublish it. Check that records appear, change, and disappear. Inspect all records for the slug: Algolia's distinct search setting can hide fragments.
5. Confirm requests without a key or with a wrong key return `401`. On the test site only, remove `NETLIFY_KEY`, redeploy, and confirm webhook requests return `503`; restore it and redeploy afterward.
6. Build a deploy preview of the opted-in setup. Its webhook functions must return `403`, URL generation must be disabled, and the index must remain unchanged. A production deploy permalink must generate URLs for the canonical site domain.

Once the publish, edit, and unpublish checks pass, the customer can close the setup page. Webhooks continue running.

## Verify updates and rollback

Publish a second candidate with a new sequence, select its exact version, and repeat the webhook checks. Then select the first version, redeploy, and verify the build log and webhooks again. Code rollback does not undo index writes.

Repeat the install from a fork with base `deployment` and the exact candidate version. Also keep the legacy root/package build checks passing: existing installations must remain independent of release selection.

Record the tested branch commit, candidate version, runtime commit, Netlify deploy ID, and results in the PR. Keep incomplete checks in the PR. Prereleases require an exact selection; ordinary major selections ignore them.

Before merging the PR, restore any candidate package versions to their current stable versions on `main`. Keep published prerelease tags and assets unchanged; exact candidate deployments continue using their tagged source. Create the next stable release through `pnpm ship` after merge.
