# Live Ghost Content API smoke contract

## Recommendation

Run a dedicated, non-blocking `Live Ghost content smoke` GitHub Actions
workflow against `https://main.ghost.is` once per day at `04:17 UTC` and on
manual dispatch. The non-zero minute avoids the high-load start of the hour,
where GitHub says scheduled runs are more likely to be delayed or dropped.
Scheduled workflows run only from the default branch, and a public repository's
schedule can be disabled after 60 days without repository activity, so manual
dispatch remains the recovery and investigation path.
([GitHub schedule documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule))

The workflow is observational infrastructure, not a pull-request check:

- trigger it only with `schedule` and `workflow_dispatch`, never `pull_request`,
  `pull_request_target`, `push`, or `workflow_run`;
- keep it in a workflow separate from `.github/workflows/test.yml`;
- do not add it to the repository's `Required checks pass` aggregator or the
  default-branch required-status-check ruleset; and
- let a drift or operational error fail this workflow visibly without blocking
  a pull request, merge, package publication, or deployment.

That separation preserves the repository decision that required CI is
deterministic and offline, while the live check observes mutable content. The
current test workflow's aggregator depends only on its offline `test` job, and
the active default-branch ruleset currently requires only `Required checks
pass`.
([map notes](https://github.com/TryGhost/algolia/issues/186),
[`test.yml`](../../.github/workflows/test.yml),
[current ruleset](https://api.github.com/repos/TryGhost/algolia/rulesets/20801218))

## Repository evidence

These are observed or already-settled facts, not new recommendations:

- The repository calls a published post or page returned by the Content API
  **Ghost content**, and defines a **live content smoke test** as a non-blocking
  structural-drift check that does not assert exact editorial content.
  ([`CONTEXT.md`](../../CONTEXT.md))
- The repository already pins `@tryghost/content-api@1.12.10`, configures it
  with API version `v6.0`, and paginates posts with `limit=100` until
  `meta.pagination.next` is `null`.
  ([`package.json`](../../packages/algolia/package.json),
  [`cli.js`](../../packages/algolia/bin/cli.js),
  [`fetch-posts.js`](../../packages/algolia/lib/fetch-posts.js))
- The repository-scoped Actions secret `MAIN_GHOST_CONTENT_API_KEY` was listed
  by GitHub on 2026-08-14. The access decision explicitly keeps
  `GHOST_URL=https://main.ghost.is` and `GHOST_API_VERSION=v6.0` in workflow
  configuration and prohibits adding a staff token for this read.
  ([provisioning resolution](https://github.com/TryGhost/algolia/issues/190#issuecomment-5289038849))
- The evidence-corpus decision already defines the privacy-minimized structural
  census and requires aggregate signature identifiers and counts rather than
  live HTML, prose, identifiers, links, or media values.
  ([`ghost-html-evidence-corpus.md`](ghost-html-evidence-corpus.md))

Ghost's official documentation confirms that the Content API is read-only,
serves published content, authenticates with an API key in the query string,
and accepts `Accept-Version: v6.0`. It exposes stable `posts` and `pages`
endpoints. Browse endpoints accept `fields`, `formats`, `limit`, and `page`,
with at most 100 records per page and pagination metadata under
`meta.pagination`.
([Content API overview](https://docs.ghost.org/content-api/),
[parameters](https://docs.ghost.org/content-api/parameters),
[pagination](https://docs.ghost.org/content-api/pagination))

## Workflow and trust boundary

Use an exact job guard equivalent to:

```yaml
if: github.repository == 'TryGhost/algolia' && github.ref == 'refs/heads/main'
```

This guard matters for both triggers. GitHub requires the workflow file for a
manual dispatch to exist on the default branch, but a dispatcher can select the
ref that receives the dispatch. The authenticated job must therefore refuse a
non-`main` ref rather than checking out and executing branch-controlled smoke
code with the repository secret.
([workflow-dispatch documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch))

Use only `contents: read` for `GITHUB_TOKEN`, pin third-party actions to complete
commit SHAs as the repository's existing workflows do, and set
`persist-credentials: false` on checkout. Map `MAIN_GHOST_CONTENT_API_KEY` into
the one smoke-execution step, not workflow-wide or job-wide environment. Keep
the non-secret URL and version explicit:

```yaml
env:
  GHOST_URL: https://main.ghost.is
  GHOST_API_VERSION: v6.0
  MAIN_GHOST_CONTENT_API_KEY: ${{ secrets.MAIN_GHOST_CONTENT_API_KEY }}
```

The smoke program must reject a missing key with a fixed message before making
a request. It must also require the URL to equal `https://main.ghost.is`, use
HTTPS, and reject redirects rather than risk forwarding the query-string key to
another origin. Never pass the key as a command-line argument. GitHub recommends
environment variables or standard input instead of command-line secret values,
and notes that non-`GITHUB_TOKEN` secrets are not passed to workflows triggered
from forks.
([GitHub secret guidance](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets))

Do not add a pull-request trigger merely to obtain a skipped check, and do not
use `pull_request_target`. GitHub deliberately withholds secrets from untrusted
fork pull-request code; `pull_request_target` restores elevated trust and becomes
unsafe if branch-controlled code is fetched and executed.
([GitHub `pull_request_target` security guidance](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target))

In a fork, the exact-repository guard skips the authenticated job. A fork owner
may copy and manually invoke the workflow in their own repository, but it must
not attempt to use the upstream secret and its result has no relationship to
the upstream required check.

## Read contract

Read both published posts and pages. This observes the rendered-HTML input seam
for both kinds of Ghost content; it does **not** decide whether the indexing CLI
should index posts, pages, or both. That source-selection decision remains with
[Define the page indexing contract](https://github.com/TryGhost/algolia/issues/199).

For each of `/ghost/api/content/posts/` and `/ghost/api/content/pages/`:

1. Send `GET` with `Accept-Version: v6.0`, the repository key, `fields=html`,
   `formats=html`, `limit=100`, and `page=1`.
2. Validate a successful JSON response containing the named resource array and
   an object at `meta.pagination`.
3. Process only each item's `html` string in memory. Ignore and immediately
   discard any additional response fields.
4. Follow the integer `meta.pagination.next` page until it is `null`; reject a
   missing, invalid, or repeated next-page value.
5. Discard each raw response page after its HTML has been normalized. Never
   write a response body to disk, cache, an artifact, a job summary, or a test
   fixture.

The request shape deliberately uses the public REST contract rather than a
staff API. If implementation reuses the repository's pinned Ghost SDK, its
source shows that the key is added to request parameters and Axios error objects
retain request/configuration details. Catch and sanitize errors at the smoke
boundary; never print or serialize a raw SDK, Axios, `fetch`, URL, request, or
response error.
([pinned Content API client source](https://github.com/TryGhost/SDK/blob/f4d2106a0763d89e408b5009c4fed4403f9207c5/packages/content-api/lib/content-api.js))

## Structural census

Parse each HTML value in memory with the parser selected for the public
extractor. Build a deterministic canonical signature from structural facts only:

- tag names and document order within the signature;
- Ghost-owned `kg-*` class tokens, sorted and deduplicated, with every other
  class value dropped;
- presence, never values, of `id`, `name`, `href`, `src`, `alt`, and relevant
  `data-*` attributes;
- parent and ancestor relationships for selected elements;
- heading-level sequences and whether a heading has a direct or descendant
  anchor;
- counts of the legacy-selected `p`, `pre`, `td`, and `li` elements; and
- presence of captions, `th`, blockquotes, figures, and Ghost card wrappers.

Serialize that normalized structure canonically, hash only the normalized
structure to obtain a stable signature identifier, and aggregate occurrence
counts. Never hash raw HTML or text: such hashes add no structural evidence and
can still fingerprint editorial content. Aggregate posts and pages for the
extractor comparison, while reporting only total item counts per resource so a
maintainer can distinguish endpoint failure from a structural change. This is
the census already specified by the evidence-corpus decision.
([`ghost-html-evidence-corpus.md`](ghost-html-evidence-corpus.md))

The smoke program has four layers of assertions:

1. **Target and transport:** exact origin and API version, non-empty key,
   successful non-redirected JSON responses.
2. **Content API schema:** resource arrays, pagination object, valid progress to
   `next === null`, a string or `null` `html` value for every item, and at least
   one observed `html` string in the combined read. A `null` value is counted
   per resource, contributes no signature, and never reaches the normalizer or
   the extractor; every other non-string value remains schema drift. Because a
   read whose items all carry `null` exercises neither the normalizer nor the
   extractor, it fails as an empty census exactly like a read with no items.
3. **Normalizer privacy and determinism:** parsing succeeds; two passes over the
   same in-memory HTML yield the same normalized signature; and emitted
   signatures contain only the structural allowlist above.
4. **Drift:** every observed signature identifier is in the reviewed baseline.
   A new identifier fails the live workflow. Missing identifiers and changed
   occurrence counts are reported but do not fail, because mutable editorial
   content can remove or duplicate structures without changing Ghost's renderer.

Amended on 2026-08-20. Layer 2 originally required a string `html` value for
every item. Two manual dispatches failed `schema-drift` on that assertion alone
([run 32368632595](https://github.com/TryGhost/algolia/actions/runs/32368632595),
[run 32372419243](https://github.com/TryGhost/algolia/actions/runs/32372419243)).
A maintainer-led aggregate classification of the first posts page found
`{"null": 8, "string": 92}` over healthy pagination, and all eight `null`-`html`
items were `public`: empty-bodied published posts, not restricted content. Ghost
returns `null` `html` for an empty published post, and equally for members-only
and paid posts, so the pinned assertion contradicted live Content API behaviour
and made every dispatch fail regardless of key or timing. Empty published posts
are mutable editorial content, which this contract requires to be reported
rather than treated as fatal.
([amendment](https://github.com/TryGhost/algolia/issues/239))

Once `@tryghost/algolia-html-extractor` exists, also invoke its public `extract`
seam for every live HTML value and assert only interface invariants: no throw,
an array result, allowed `sourceTag` and `headingRank` values, contiguous
zero-based positions, string `html`/`text`/heading values, and string-or-null
anchors. Do not assert exact fragments, prose, HTML serialization, fragment
counts, anchors, or headings from the live site; exact behaviour belongs to the
reviewed offline fixtures.
([public extractor contract](public-html-extractor-interface.md),
[legacy compatibility contract](legacy-extraction-compatibility-contract.md))

## First authenticated read and baseline bootstrap

The first authenticated read cannot safely run on the implementation pull
request: the workflow file must first exist on the default branch for manual
dispatch, and the repository secret must not be exposed to pull-request or fork
code.
([workflow-dispatch documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch),
[GitHub secret guidance](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets))

Bootstrap in two reviewed changes:

1. Merge the strict-TypeScript census/smoke program, deterministic offline tests,
   and an upstream-`main`-guarded workflow with **manual dispatch only** and a
   fixed `bootstrap` mode. The program must have no baseline-update or live-data
   write path.
2. Dispatch that workflow explicitly on `main`. This is the first authenticated
   read using `MAIN_GHOST_CONTENT_API_KEY`. It should succeed only if target,
   transport, schema, pagination, privacy, determinism, and extractor invariants
   pass, then emit the sanitized aggregate described below.
3. Have a maintainer other than the operator review the run summary. Record the
   run URL, UTC observation time, API version, item/page totals, normalized
   signature identifiers, and aggregate counts in a baseline/provenance change.
   Record no response body, editorial field, or structural description derived
   from live content.
4. Merge a second change that adds the reviewed baseline, switches the program
   to comparison mode, and enables `cron: '17 4 * * *'`. Manually dispatch the
   final comparison workflow once to prove the baseline and scheduled path use
   the same contract.

This sequence resolves the bootstrap dependency without weakening fork safety
or pretending that mutable live data was reviewed in the implementation PR.
The actual first read remains future implementation evidence; this research did
not execute it because no live-smoke workflow exists on `main` yet.

## Reporting and retention

On every run, write one compact, deterministic report to the GitHub job summary:

- result category: `ok`, `operational-failure`, `schema-drift`,
  `structural-drift`, or `extractor-failure`;
- UTC observation time, explicit safe origin, and API version;
- pages and items read per resource;
- items without an `html` value per resource, as a count only, so the summary is
  itself the complete census of empty-bodied published content;
- total distinct normalized signatures;
- signature identifier and aggregate count for each observed signature;
- added, missing, and count-changed identifiers relative to baseline.

GitHub supports Markdown job summaries through `GITHUB_STEP_SUMMARY`. The
summary should make a failure classifiable without downloading logs or
artifacts; deeper structural interpretation remains a local, maintainer-led
investigation.
([workflow-command documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands#adding-a-job-summary))

Logs may contain the same aggregates plus fixed progress messages. They must
not contain the API key, request URL/query, response headers or body, raw error
objects, live HTML or text, titles, slugs, IDs/UUIDs, URLs or link targets,
media values, author/tag values, or hashes of any editorial value. Do not upload
an artifact, persist a cache containing results, or automatically modify the
baseline or Ghost-rendered fixtures. GitHub masks configured secrets, but safe
logging must not depend on redaction; GitHub itself warns against printing
secrets and recommends explicit masking for other sensitive values.
([GitHub secret guidance](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets),
[workflow-command masking guidance](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands#masking-a-value-in-a-log))

A new signature starts an investigation. It never automatically updates a
baseline or fixture. First distinguish editorial content-mix churn from a Ghost
renderer change; then reproduce relevant new coverage with synthetic source in
a disposable pinned Ghost instance according to the evidence-corpus policy.

## Failure ownership

The TryGhost/algolia maintainers own the smoke workflow and first triage. The
maintainer who creates or most recently changes the cron syntax must enable
failed-workflow GitHub notifications and treat that notification responsibility
as part of reviewing a cron change. GitHub sends scheduled-workflow
notifications to the workflow creator, or to the later user who changes the
cron syntax or re-enables the workflow; this implicit ownership can drift, so it
must be acknowledged during review.
([GitHub workflow notification documentation](https://docs.github.com/en/actions/concepts/workflows-and-actions/notifications-for-workflow-runs))

For a failed scheduled run, the notified maintainer should inspect the sanitized
summary and manually rerun the workflow on `main` before escalating:

- **Missing key, 401, or 403:** the repository maintainer with Actions-secret
  access owns checking the repository secret and the `main.ghost.is` custom
  integration, rotating the key if necessary, and rerunning. Never reveal the
  old or replacement value.
- **Network, redirect, 404, 429, or 5xx:** the repository maintainer first proves
  the fixed target/version and checks for a GitHub Actions incident. A repeated
  failure is handed to the owner of `main.ghost.is` or the Ghost Content API
  with the sanitized status/category and run URL only.
- **Schema or pagination failure:** the repository maintainer opens a focused
  compatibility investigation and involves the Ghost Content API owner; do not
  loosen the assertion or change API version from the workflow alone.
- **New structural signature:** the repository maintainer links the run from a
  focused issue, performs any necessary local lookup only after the settled
  `ghst` checks prove active profile `main` and URL exactly
  `https://main.ghost.is`, and follows the synthetic-reproduction and independent
  review policy before changing baseline or corpus.
- **Extractor invariant failure:** the repository maintainer treats it as an
  extractor defect, reproduces it with a minimized synthetic offline fixture,
  and fixes it through the normal pull-request checks. Live HTML does not enter
  the regression fixture.

Do not grant the workflow `issues: write` or auto-create recurring issues. The
failed run and notification provide the initial signal; a human creates one
focused issue only after classification, avoiding duplicate or editorially
revealing automation.

## Limitations

- A daily run detects drift after it appears in current published content; it
  does not prove every structure Ghost can render.
- Scheduled runs may be delayed, dropped, or disabled by GitHub, which is why
  the manual path and notification owner are part of the contract.
- A normalized-signature addition can be harmless content-mix churn. Failure is
  a request for review, not proof of a Ghost regression.
- Absence and frequency of a signature are not compatibility promises.
- The smoke proves public Content API access and live rendered-HTML handling. It
  does not prove Algolia indexing, webhook delivery, Admin API access, private
  content, or the future page-indexing product contract.

## Sources

- [Plan a maintained HTML-to-Algolia extraction pipeline](https://github.com/TryGhost/algolia/issues/186)
- [Define the live Ghost Content API smoke contract](https://github.com/TryGhost/algolia/issues/191)
- [Live smoke schema contract fails on published posts with null html](https://github.com/TryGhost/algolia/issues/239)
- [Provision read-only `main.ghost.is` Content API access](https://github.com/TryGhost/algolia/issues/190#issuecomment-5289038849)
- [`CONTEXT.md`](../../CONTEXT.md)
- [`ghost-html-evidence-corpus.md`](ghost-html-evidence-corpus.md)
- [`public-html-extractor-interface.md`](public-html-extractor-interface.md)
- [`legacy-extraction-compatibility-contract.md`](legacy-extraction-compatibility-contract.md)
- [`packages/algolia/bin/cli.js`](../../packages/algolia/bin/cli.js)
- [`packages/algolia/lib/fetch-posts.js`](../../packages/algolia/lib/fetch-posts.js)
- [Ghost Content API overview](https://docs.ghost.org/content-api/)
- [Ghost Content API parameters](https://docs.ghost.org/content-api/parameters)
- [Ghost Content API pagination](https://docs.ghost.org/content-api/pagination)
- [`@tryghost/content-api@1.12.10` source](https://github.com/TryGhost/SDK/blob/f4d2106a0763d89e408b5009c4fed4403f9207c5/packages/content-api/lib/content-api.js)
- [GitHub Actions scheduled workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
- [GitHub Actions manual workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch)
- [GitHub Actions secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)
- [GitHub `pull_request_target` security](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target)
- [GitHub workflow commands and job summaries](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands)
- [GitHub workflow notifications](https://docs.github.com/en/actions/concepts/workflows-and-actions/notifications-for-workflow-runs)
