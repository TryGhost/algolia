# Configurable index-settings defect

Date: 2026-08-13
Decision ticket: [Narrow the configurable index-settings defect](https://github.com/TryGhost/algolia/issues/195)
Original report: [Searchable attributes in the config file are not added to algolia](https://github.com/TryGhost/algolia/issues/23)

## Decision

Close the original report as stale and superseded rather than implementing its proposed coupling between configuration and record construction.

The CLI already passes `algolia.indexSettings` from its JSON configuration to `IndexFactory`, and `IndexFactory` sends that object to Algolia. The remaining reproducible defect is narrower and belongs to the Netlify publish path: every `post-published` webhook constructs an indexer without custom settings and calls `setSettingsForIndex()`, so each publish reapplies the package defaults before it writes records. This is the behavior reported in the 2023 follow-up on the original issue, but it is not the issue title's claimed CLI defect.

The fix should make settings writes explicit and single-owner:

- The CLI owns initial index configuration during a batch index. It applies the configured settings patch when `algolia.indexSettings` is present, or the package defaults when it is absent, before adding records.
- The Netlify webhooks own incremental record synchronization only. `post-published` should initialize the index and save records without reading or writing settings, matching `post-unpublished`, which already initializes the index directly before deleting records.
- `@tryghost/algolia-indexer` remains the reusable mechanism for both operations: `initIndex()` establishes the client/index connection, `setSettingsForIndex()` is an explicit configuration operation, and `save()`/`delete()` never alter settings themselves.
- Search relevance policy remains user-owned. `searchableAttributes`, its ordering, extra facets, and any additional ranking policy can be managed through the CLI config, Algolia dashboard, or Algolia API. Record projection remains a separate fragmenter concern: configuring an attribute cannot make it searchable unless the records actually contain it.

## Current behavior

### CLI: the original report is no longer reproducible

The CLI loads the JSON object into `context`, constructs `IndexFactory(context.algolia)`, calls `setSettingsForIndex()`, and only then saves fragments ([CLI source](../../packages/algolia/bin/cli.js)). The constructor keeps a supplied `algolia.indexSettings` object and falls back to its defaults only when no object was supplied; `setSettingsForIndex()` sends that selected object to Algolia ([indexer source](../../packages/algolia-indexer/lib/IndexFactory.js)).

The public-seam tests corroborate the contract:

- the indexer test sends `{searchableAttributes: ['title', 'html']}` and asserts that exact object is the settings request ([indexer contract test](../../packages/algolia-indexer/test/IndexFactory.test.js));
- the CLI acceptance test asserts that the settings body from its config fixture is sent before the record batch ([CLI acceptance test](../../packages/algolia/test/cli-ghost-v6.acceptance.test.js)).

Algolia's `setSettings` contract is a partial update: specified settings are overridden and unspecified settings remain unchanged. It requires the `editSettings` ACL and returns an asynchronous task identifier. Therefore the existing custom object is a settings patch, not necessarily a complete desired-state document. [Algolia: update index settings](https://www.algolia.com/doc/libraries/sdk/methods/search/set-settings)

### Netlify: a publish event still rewrites settings

The Netlify environment adapter provides only application ID, API key, and index name ([webhook utility](../../packages/algolia-netlify/functions/utils/webhook.ts)). With no `indexSettings`, the indexer chooses its package defaults. `post-published` then calls `setSettingsForIndex()` before every `save()` ([publish handler](../../packages/algolia-netlify/functions/post-published.mts)). Its acceptance test freezes the current request sequence as settings `PUT`, settings `GET`, then records batch ([Netlify acceptance test](../../packages/algolia-netlify/test/handlers.acceptance.test.ts)).

This means an operator can configure custom searchable attributes or facets through the dashboard/API and later have the package-owned keys reset by an unrelated post webhook. Algolia explicitly supports managing searchable attributes through either the dashboard or API, and their order affects ranking. [Algolia: searchable attributes](https://www.algolia.com/doc/guides/managing-results/must-do/searchable-attributes)

`post-unpublished` already demonstrates the desired ownership boundary: it calls `initIndex()` and then deletes records without a settings call ([unpublish handler](../../packages/algolia-netlify/functions/post-unpublished.mts)).

## Required settings versus user policy

The constant currently named `REQUIRED_SETTINGS` mixes one operational prerequisite with search-experience defaults:

| Setting | Contract classification | Reason |
| --- | --- | --- |
| `attributesForFaceting: ['filterOnly(slug)']` | Operational prerequisite while deletion uses `deleteBy({filters: 'slug:...'})` | Algolia requires a `deleteBy` filter attribute to be declared in `attributesForFaceting`; `filterOnly` is the appropriate modifier when facet counts are not needed. [Algolia: delete by](https://www.algolia.com/doc/libraries/sdk/v1/methods/delete-by) and [declare attributes for faceting](https://www.algolia.com/doc/guides/managing-results/refine-results/faceting/how-to/declaring-attributes-for-faceting) |
| `distinct: true` plus `attributeForDistinct: 'slug'` | Package search default | This groups a post's multiple fragment records and returns the most relevant fragment. Algolia ignores `distinct` without `attributeForDistinct`; the setting is search behavior rather than an indexing prerequisite. [Algolia: distinct](https://www.algolia.com/doc/api-reference/api-parameters/distinct) |
| `customRanking` on heading and position | Package search default | It orders otherwise tied fragments using fields produced by the fragmenter. Algolia applies custom ranking as part of relevance; it is not required to save or delete records. [Algolia: custom ranking](https://www.algolia.com/doc/guides/managing-results/must-do/custom-ranking/how-to/configure-custom-ranking) |
| `searchableAttributes` | User-overridable relevance default | The selected fields and their order define what is searched and influence ranking. Algolia supports configuring them through either the dashboard or API. [Algolia: searchable attributes](https://www.algolia.com/doc/guides/managing-results/must-do/searchable-attributes) |

The package should document the full default profile, but it should guarantee only the prerequisite that its own mutation algorithm needs. Under the current slug-filter deletion design, operators using the Netlify unpublish webhook must provision `filterOnly(slug)` once. The CLI's default profile does this. If a custom patch changes `attributesForFaceting`, it must retain `filterOnly(slug)`; validation should reject an incompatible explicit value rather than silently rewriting user-owned settings.

The distinct and ranking defaults should remain defaults, not invariants silently forced on every publish. A consumer may intentionally display multiple fragments per post or choose different relevance, and neither choice prevents indexing.

## Implementation consequence

The compatible fix is small and independent of the HTML extractor implementation:

1. Change `post-published` to call `initIndex()` instead of `setSettingsForIndex()` before `save()`.
2. Update its acceptance tests to require only the records batch for publish events and to prove no settings endpoint is called.
3. Remove `settings` and `editSettings` from the Netlify key requirements and documentation; the publish/unpublish runtime still needs record-add and slug-filter deletion permissions. Algolia documents `addObject`, `deleteIndex`, `settings`, and `editSettings` as separate ACL capabilities. [Algolia: API keys](https://www.algolia.com/doc/guides/security/api-keys)
4. Document that index setup is a prerequisite to webhooks, with `filterOnly(slug)` required while unpublishing uses `deleteBy`. Keep the CLI as the supported initial-setup path.
5. Add focused CLI/indexer coverage for a minimal custom settings patch if stronger end-to-end evidence than the existing indexer test is wanted. This is coverage hardening, not the original defect.

Do not make the fragmenter consume `searchableAttributes`. The fragmenter determines record shape; Algolia settings determine which existing record fields are searchable. Additional Ghost-field projection belongs with the separate projection/excerpt decision, not this fix.

## Disposition of the original report

Close [Searchable attributes in the config file are not added to algolia](https://github.com/TryGhost/algolia/issues/23) with a comment that:

- the CLI/config path now sends custom `indexSettings` and has contract coverage;
- the fragmenter's field projection is deliberately separate from Algolia search settings;
- the remaining webhook reset is superseded by the explicit configuration-ownership decision above and should be implemented under a narrowly named task.

Retitling the old issue would preserve a misleading history and mix two contracts. A fresh implementation task should be named for the actual behavior, for example **Stop publish webhooks from rewriting Algolia index settings**.

## Verification performed

- Inspected the current checkout and `origin/main`; both retain the same CLI-versus-Netlify settings ownership behavior.
- Traced the original configuration file, CLI, indexer, fragmenter, publish handler, unpublish handler, and their public-seam tests.
- Traced the introduction of `setSettingsForIndex({updateSettings: false})` in commit `7679651`; neither the historical nor current Netlify publish handler uses it.
- Checked the relevant Algolia settings, searchable-attribute, distinct, custom-ranking, filtering, deletion, and ACL documentation cited above.
