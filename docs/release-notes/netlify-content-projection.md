# Netlify content projection — unreleased

This minor release adopts the shared Ghost content projection and deterministic record policy in `@tryghost/algolia-netlify`. It implements [#222](https://github.com/TryGhost/algolia/issues/222), part of [#213](https://github.com/TryGhost/algolia/issues/213), and delivers the Netlify portion of source requests [#43](https://github.com/TryGhost/algolia/issues/43) and [#148](https://github.com/TryGhost/algolia/issues/148).

## Behavior and configuration

- Set `ALGOLIA_CONTENT_PROJECTION` to a JSON projection object containing `fields` and optional `customRanking`, using the same shape as the CLI's `contentProjection` value. For example: `{"fields":["image","tags","authors","excerpt"]}`.
- Omission selects `image`, `tags`, `authors`, and `excerpt`. Explicit fields replace the defaults, including `{"fields":[]}`. An empty environment value is invalid JSON.
- The compatibility floor is `@tryghost/algolia-fragmenter` 0.4.0 and `@tryghost/algolia` 0.3.6. Use the same projection in CLI and webhook configurations to keep their records consistent.
- Publish consumes the current webhook resource without a Content API re-fetch. It validates the complete record set, creates fallback records for empty searchable content, and enforces the fragmenter's 9,999 compact UTF-8 byte record limit before contacting Algolia.
- Both handlers validate projection policy before any Algolia request. Deterministic content or size failures also make no Algolia request. Errors retain the JSON `500` envelope with a `msg` property.
- Publish deletes all records matching the current post's legacy slug before saving the complete replacement set, removing stale continuations after shrinking content. Unpublish retains its current/previous resource selection.
- Neither webhook reads or writes index settings. The index must already have `filterOnly(slug)`. Setup remains a CLI/indexer operation; runtime keys need the existing add/delete permissions.
- Public basenames, package exports, activation, optional-key authentication, user-agent checks, request envelopes, and successful text responses remain compatible. This release does not repair the existing optional-key authentication limitation.

`excerpt` is display text. Consumers choose it in the result UI and own Algolia searchable, retrieval, snippet, and ranking settings; projection never changes those settings automatically.

## Rollout and rollback

Verify the published fragmenter and CLI compatibility floors before deploying this Netlify release. Back up or copy the target index and retain the previous package/configuration. Configure the projection and ensure `filterOnly(slug)` exists before enabling webhooks.

Delete-before-save is not atomic: failed deletion prevents saving, while a later save failure can leave records missing or partially updated. External errors are surfaced without automatic rollback. Disable webhooks with `ALGOLIA_ACTIVE=FALSE`, restore or switch to the retained index, and select the previous compatible package/configuration to roll back. Merely reverting code cannot recover deleted records. Never reuse or unpublish a version.

## Release verification still required

Publish only through the repository's Publish workflow after a scoped Netlify minor-release dry run and required repository checks. Record the exact released version after verifying registry metadata, provenance, dependencies, exports, tarball contents, and clean packed-handler behavior.

Do not close #43 or #148 until the fragmenter, CLI, and Netlify registry artifacts and public seams are verified. Closure notes must record all exact versions and explain the consumer-owned `excerpt` UI and settings behavior. This note is an implementation handoff, not evidence that publication or issue closure has occurred.
