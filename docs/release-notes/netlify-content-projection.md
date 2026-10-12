# Netlify content projection (unreleased)

The post webhooks adopt the shared fragmenter policy from #222 and #213. Existing installations need no new environment variables, publishing permissions, or index settings.

- Defaults retain `image`, `tags`, and `authors`, and add `excerpt`. Set optional `ALGOLIA_CONTENT_PROJECTION` JSON to choose fields, aliases, and ranking siblings. The same shape is supported by CLI 0.3.6 and fragmenter 0.4.0 or later.
- Publish validates the current resource and all records before contacting Algolia. Empty searchable content gets a fallback record. Records are limited to 9,999 compact UTF-8 bytes; whole fragments can split into continuations. Invalid content, policy, or size returns the existing JSON `500` response.
- Publishing only adds or updates records. A failed save causes no cleanup or deletion, but a multi-batch save can partially succeed. Old fragments may remain when content shrinks.
- Handler URLs, exports, activation, optional-key authentication, envelopes, and successful responses stay compatible. Unpublish retains filtered deletion by slug. Neither handler reads or writes settings.

## Scope change

The original #222 plan required deleting old records before saving. The revised requirement preserves existing configuration and prevents a failed save from removing search records. Automatic stale-fragment cleanup is deferred until old object IDs can be identified safely. This PR does not satisfy that original cleanup criterion and must not automatically close #222.

## Deployment and rollback

Netlify deployments from source receive this behavior when they deploy the changed Git revision; npm publication alone does not control those installations. Keep the previous working deploy available. Reverting the code does not revert record updates already accepted by Algolia; retain an index copy when an upgrade requires data recovery. Never reuse or unpublish an npm version.

Package publication must use the repository's Publish workflow with a scoped release and registry verification. Source-deployment validation is also required before claiming delivery to Netlify users. Keep #43 and #148 open until their relevant artifacts and behavior are verified. `excerpt` display and search settings remain the consumer's choice.
