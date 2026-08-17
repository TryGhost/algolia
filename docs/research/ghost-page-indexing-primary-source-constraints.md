# Ghost page indexing: primary-source constraints

Status: researched against current official Ghost documentation and Ghost
`origin/main` at
[`4fd94121967df3165b3c01d6065edbe6f895a2c3`](https://github.com/TryGhost/Ghost/commit/4fd94121967df3165b3c01d6065edbe6f895a2c3)
on 2026-08-14.

This note records external facts that constrain
[Define the page indexing contract](https://github.com/TryGhost/algolia/issues/199).
It does not choose which content types to index, defaults, configuration, or
webhook implementation.

## Observed

### Content API source selection

The Content API is read-only and exposes published content. Posts and pages
have separate stable browse and read endpoints: `/content/posts/` and
`/content/pages/`. Pages are structured like posts, but responses use the
`pages` resource key. The pages endpoint returns only page resources created in
Ghost; it does not enumerate custom or dynamic routes.
([Content API overview](https://docs.ghost.org/content-api/),
[posts](https://docs.ghost.org/content-api/posts),
[pages](https://docs.ghost.org/content-api/pages))

The current public controllers preserve that separation. Post browsing goes
through the posts service, while page browsing calls `Post.findPage`; both
accept `filter`, `fields`, `formats`, `page`, `limit`, and `order`.
([posts controller](https://github.com/TryGhost/Ghost/blob/4fd94121967df3165b3c01d6065edbe6f895a2c3/ghost/core/core/server/api/endpoints/posts-public.js#L17-L74),
[pages controller](https://github.com/TryGhost/Ghost/blob/4fd94121967df3165b3c01d6065edbe6f895a2c3/ghost/core/core/server/api/endpoints/pages-public.js#L14-L50))

`fields` limits scalar fields returned; it does not select a resource type.
`include` adds relations and is documented not to interact reliably with
`fields`. `filter` applies NQL predicates within a browse endpoint. Ghost
removed the former `page:true|false` filter from both `/posts` and `/pages`, so
it is not a supported way to combine or switch the two resources.
([Content API parameters](https://docs.ghost.org/content-api/parameters),
[filtering](https://docs.ghost.org/content-api/filtering),
[breaking changes](https://docs.ghost.org/changes))

All browse endpoints return 15 records by default. `limit=100` is the documented
maximum. Responses expose `meta.pagination` with `page`, `limit`, `pages`,
`total`, `next`, and `prev`; enumeration is complete when `next` is `null`.
Posts default to `published_at DESC`, while pages default to `title ASC`.
([parameters](https://docs.ghost.org/content-api/parameters),
[pagination](https://docs.ghost.org/content-api/pagination))

### Webhook events and identity

Ghost documents distinct post and page event families. For each type it
provides `published`, `published.edited`, and `unpublished`; the generic
`edited` event also exists and means any edit, whereas `published.edited`
specifically means an edit to published content.
([webhook event list](https://docs.ghost.org/webhooks))

The public webhook documentation promises a JSON request body but does not
document its field-level schema. Current Ghost source constructs:

```json
{
  "event": "page.published.edited",
  "page": {
    "current": {"id": "..."},
    "previous": {}
  }
}
```

The resource key is singular `post` or `page`. `current` is the current
API-serialized resource, including `id`; `previous` contains only serialized
fields that changed. Post/page webhook serialization requests HTML, plaintext,
tags, and authors and uses the Admin serializer context, so the payload is not
the same contract as a Content API response. The top-level `event` is added
separately when Ghost sends the request.
([serializer](https://github.com/TryGhost/Ghost/blob/4fd94121967df3165b3c01d6065edbe6f895a2c3/ghost/core/core/server/services/webhooks/serialize.js#L25-L103),
[trigger](https://github.com/TryGhost/Ghost/blob/4fd94121967df3165b3c01d6065edbe6f895a2c3/ghost/core/core/server/services/webhooks/webhook-trigger.js#L105-L139))

Current end-to-end tests cover the six publish/update/unpublish events for
posts and pages. Their snapshots show a full `current.id` for publish,
published-edit, and unpublish. On unpublish, `current.status` is `draft` and
`previous.status` is `published`; `previous` is not a complete prior resource.
([post publish and published-edit snapshots](https://github.com/TryGhost/Ghost/blob/4fd94121967df3165b3c01d6065edbe6f895a2c3/ghost/core/test/e2e-webhooks/__snapshots__/posts.test.js.snap#L517-L1001),
[post unpublish snapshot](https://github.com/TryGhost/Ghost/blob/4fd94121967df3165b3c01d6065edbe6f895a2c3/ghost/core/test/e2e-webhooks/__snapshots__/posts.test.js.snap#L2049-L2254),
[page publish and published-edit snapshots](https://github.com/TryGhost/Ghost/blob/4fd94121967df3165b3c01d6065edbe6f895a2c3/ghost/core/test/e2e-webhooks/__snapshots__/pages.test.js.snap#L516-L975),
[page unpublish snapshot](https://github.com/TryGhost/Ghost/blob/4fd94121967df3165b3c01d6065edbe6f895a2c3/ghost/core/test/e2e-webhooks/__snapshots__/pages.test.js.snap#L1976-L2158))

### Slug and URL collisions

Posts and pages are rows in the same `posts` table, distinguished by a `type`
whose allowed values are `post` and `page`. The database uniqueness constraint
is the pair `(slug, type)`, while `id` is the table primary key. Ghost therefore
permits one post and one page to have the same slug, but their IDs remain
distinct.
([current schema](https://github.com/TryGhost/Ghost/blob/4fd94121967df3165b3c01d6065edbe6f895a2c3/ghost/core/core/server/data/schema/schema.js#L62-L105))

A page URL is always `/:slug/`. The default post collection also uses
`/{slug}/`, although post permalinks can be customized. Ghost's routing docs
warn that slug conflicts are possible and must be managed manually.
([page routes](https://docs.ghost.org/themes/contexts/page),
[default and custom post routing](https://docs.ghost.org/themes/routing/))

## Inferred constraints for the decision

- Supporting both posts and pages requires two independently paginated initial
  reads, then a merge. Neither `fields` nor the removed page filter replaces
  endpoint selection.
- Endpoint provenance is the reliable source-type discriminator during an
  initial read; a reduced `fields` projection need not contain `type`.
- A bare `slug` is not unique across posts and pages. Under default routing,
  equal post/page slugs also imply the same generated path, so `url` is not a
  safe cross-type identity either. Ghost's sources do not promise which
  resource wins such a route collision.
- The shared table primary key and webhook `current.id` provide a stable
  cross-type identity for indexing and removal. An unpublish handler cannot
  recover the resource from the published-only Content API, and should not
  depend on `previous` containing a full prior object.
- A contract that keeps both types current needs mirrored post/page event
  coverage. The published-content update event is `*.published.edited`; using
  generic `*.edited` would also observe non-published edits and needs an
  explicit deduplication/status policy.
- Processing webhook `current` directly versus re-reading the Content API is a
  real contract choice because the webhook uses an Admin serialization shape,
  not the public Content API shape.
