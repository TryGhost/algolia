# Ghost field projection: primary-source constraints

Status: researched against current official Ghost and Algolia documentation, and
Ghost `origin/main` at
[`c92ae410594d164c95254d7aaba498c4e963c332`](https://github.com/TryGhost/Ghost/commit/c92ae410594d164c95254d7aaba498c4e963c332),
on 2026-08-14.

This note records facts that constrain **Decide the Ghost field projection and
excerpt contract**. It does not choose the projected fields, configuration
shape, aliases, or index settings.

## Ghost Content API surface

The Content API is a read-only API for published content. Ghost describes its
keys as safe for browser use because they provide access to public data, while
warning that private sites should control where they share keys. That makes the
Content API response the appropriate public-data boundary; it does not make
every returned value useful or safe to copy into a frontend search index.
([Content API overview](https://docs.ghost.org/content-api/))

All endpoints accept `fields` to limit scalar fields in the response and
`include` to add relations. For posts and pages, `include=authors,tags` adds the
relation arrays and their `primary_author` / `primary_tag` values. Ghost warns
that `fields` "does not play well" with `include`, so relation projection cannot
be assumed to behave like scalar field selection. Posts return only `html` by
default; `formats=html,plaintext` requests the additional plaintext form.
([Content API parameters](https://docs.ghost.org/content-api/parameters))

The documented post response and current output source together expose these
field families:

- identity and navigation: `id`, `uuid`, `title`, `slug`, `url`,
  `canonical_url`, and `comment_id`;
- searchable or display content: `html`, `custom_excerpt`, computed `excerpt`,
  `feature_image`, `feature_image_alt`, and `feature_image_caption`;
- state and time: `featured`, `visibility`, `created_at`, `updated_at`,
  `published_at`, computed `reading_time`, and computed `access`;
- metadata: `custom_template`, `meta_*`, `og_*`, `twitter_*`, `email_subject`,
  `frontmatter`, and the two `codeinjection_*` values; and
- optional relation objects from `include=authors,tags`.

The official page contract says pages are structured identically to posts;
only the resource key and default browse order differ. The response example is
the public contract to program against; Ghost does not publish a separate,
exhaustive `fields` allowlist.
([posts response](https://docs.ghost.org/content-api/posts),
[pages response](https://docs.ghost.org/content-api/pages),
[metadata projection source](https://github.com/TryGhost/Ghost/blob/c92ae410594d164c95254d7aaba498c4e963c332/ghost/core/core/server/api/endpoints/utils/serializers/output/mappers/posts.js#L123-L136))

Current Ghost source corroborates the boundary and exposes two stability
constraints:

- Both public controllers accept `fields` and `formats`. Their public includes
  are explicitly allowlisted rather than arbitrary relations.
  ([posts controller](https://github.com/TryGhost/Ghost/blob/c92ae410594d164c95254d7aaba498c4e963c332/ghost/core/core/server/api/endpoints/posts-public.js#L11-L73),
  [pages controller](https://github.com/TryGhost/Ghost/blob/c92ae410594d164c95254d7aaba498c4e963c332/ghost/core/core/server/api/endpoints/pages-public.js#L8-L49))
- `mobiledoc` and `lexical` are deliberately removed from Content API format
  and column selection. They are source formats, not selectable public content
  formats. `html` and `plaintext` are the public content forms.
  ([post input serializer](https://github.com/TryGhost/Ghost/blob/c92ae410594d164c95254d7aaba498c4e963c332/ghost/core/core/server/api/endpoints/utils/serializers/input/posts.js#L20-L60),
  [page input serializer](https://github.com/TryGhost/Ghost/blob/c92ae410594d164c95254d7aaba498c4e963c332/ghost/core/core/server/api/endpoints/utils/serializers/input/pages.js#L25-L50))

### Excerpt semantics

`custom_excerpt` and `excerpt` are distinct public fields:

- `custom_excerpt` is the author-supplied value. Ghost's current schema
  validates it to at most 300 characters.
- `plaintext` is derived from rendered HTML when the post is saved.
- `excerpt` is computed at serialization time: a present custom excerpt wins;
  otherwise Ghost takes the first 500 JavaScript string characters of
  `plaintext`. Requesting `excerpt` causes Ghost to fetch `plaintext` and
  `custom_excerpt` internally, but it returns `custom_excerpt` only when that
  field was separately requested.

Therefore `excerpt` is a fallback presentation value, not a second stored copy
of `custom_excerpt`, and projecting both can intentionally duplicate the same
text for posts that have a custom excerpt.
([schema](https://github.com/TryGhost/Ghost/blob/c92ae410594d164c95254d7aaba498c4e963c332/ghost/core/core/server/data/schema/schema.js#L62-L99),
[plaintext generation](https://github.com/TryGhost/Ghost/blob/c92ae410594d164c95254d7aaba498c4e963c332/ghost/core/core/server/models/post.js#L745-L759),
[excerpt serializer](https://github.com/TryGhost/Ghost/blob/c92ae410594d164c95254d7aaba498c4e963c332/ghost/core/core/server/api/endpoints/utils/serializers/output/utils/extra-attrs.js#L10-L64),
[excerpt query dependencies](https://github.com/TryGhost/Ghost/blob/c92ae410594d164c95254d7aaba498c4e963c332/ghost/core/core/server/models/base/plugins/crud.js#L10-L18))

The public serializer also applies membership gating before returning content.
For a caller without access it truncates HTML at the legacy paywall marker or
empties `html`, `plaintext`, and computed `excerpt`; gated blocks are removed
and derived text is recalculated. A projection must consequently use the values
actually returned by the Content API, not assume that a published post's stored
HTML or generated excerpt is always present in full.
([content gating serializer](https://github.com/TryGhost/Ghost/blob/c92ae410594d164c95254d7aaba498c4e963c332/ghost/core/core/server/api/endpoints/utils/serializers/output/utils/post-gating.js#L72-L123))

### Public does not mean suitable for indexing

Ghost strips author email, status, notification, and other internal fields from
Content API author objects, and rejects Content API query paths containing
`email` or `password`. These are useful minimum boundaries, not a complete
search-index policy: public post responses still include values such as code
injection, frontmatter, canonical URLs, and social metadata that may add noise,
HTML, URLs, or unnecessary bytes when copied into Algolia.
([public output cleaning](https://github.com/TryGhost/Ghost/blob/c92ae410594d164c95254d7aaba498c4e963c332/ghost/core/core/server/api/endpoints/utils/serializers/output/utils/clean.js#L27-L78),
[restricted query fields](https://github.com/TryGhost/Ghost/blob/c92ae410594d164c95254d7aaba498c4e963c332/ghost/core/core/server/api/endpoints/utils/api-filter-utils.ts#L1-L18))

## Algolia record and settings constraints

Algolia records are schemaless JSON. Algolia recommends including only values
needed for searching, displaying, filtering, or relevance. Records should be
self-contained: duplicating parent metadata into flattened child records is
normal, but every duplicated key and value is stored and counted in each
record.
([prepare records](https://www.algolia.com/doc/guides/sending-and-managing-data/prepare-your-data),
[prepare an index](https://www.algolia.com/doc/guides/sending-and-managing-data/prepare-your-data/in-depth/prepare-data-in-depth))

### Attribute names and collisions

`objectID` uniquely identifies a record and is always returned, even if omitted
from `attributesToRetrieve` or listed in `unretrievableAttributes`. It must not
contain sensitive information. Algolia also reserves `_highlightResult`,
`_snippetResult`, `_rankingInfo`, and `_distinctSeqID` for search responses.
`distinctSeqId` is a record-side reserved name. Records should not use any of
those names. `_tags` and `_geoloc` are also record-side reserved attributes with
imposed schemas. A configurable projection needs to prevent user-selected or
future source names from colliding with these names or with package-owned
record attributes.
([Algolia record attributes](https://www.algolia.com/doc/guides/sending-and-managing-data/prepare-your-data/in-depth/what-is-in-a-record))

### Stored, searchable, returned, and displayed are separate roles

- If `searchableAttributes` is unset or empty, Algolia searches every
  string-based attribute. Once configured, it limits search to the named
  attributes and their order affects the Attribute ranking criterion. Names are
  case-sensitive and naming a parent makes all nested children searchable.
  ([`searchableAttributes`](https://www.algolia.com/doc/api-reference/api-parameters/searchableAttributes))
- `attributesToRetrieve` controls search responses and defaults to all
  attributes; `unretrievableAttributes` prevents normal search keys from
  retrieving selected values, but is ignored for an Admin API key. Neither
  setting removes the values from stored records.
  ([`attributesToRetrieve`](https://www.algolia.com/doc/api-reference/api-parameters/attributesToRetrieve),
  [`unretrievableAttributes`](https://www.algolia.com/doc/api-reference/api-parameters/unretrievableAttributes/))
- Filtering or faceting requires the attribute in `attributesForFaceting`.
  `filterOnly(attribute)` enables filtering without facet values and reduces
  index overhead. Array filters match when any element matches.
  ([`attributesForFaceting`](https://www.algolia.com/doc/api-reference/api-parameters/attributesForFaceting),
  [`filters`](https://www.algolia.com/doc/api-reference/api-parameters/filters))
- `customRanking` is a tie-breaker over named record attributes. The order of
  settings matters; missing or `null` values sort after populated records. The
  data-preparation guide requires custom-ranking values to be numeric or
  boolean.
  ([`customRanking`](https://www.algolia.com/doc/api-reference/api-parameters/customRanking),
  [record preparation](https://www.algolia.com/doc/guides/sending-and-managing-data/prepare-your-data))

Configuring any of these roles does not synthesize a missing record attribute.
Conversely, projecting an attribute without explicitly setting
`searchableAttributes` can make an otherwise display-only string searchable by
default.

### HTML, highlighting, and snippets

Algolia accepts and returns submitted HTML unchanged and does not sanitize it.
It ignores HTML tags while matching. By default it highlights all searchable
attributes and adds match tags to `_highlightResult`; its UI guidance requires
sanitizing highlighted HTML because unsanitized content can enable XSS.
Algolia's snippeting path strips HTML tags. Consequently, raw HTML, plaintext,
and a precomputed excerpt are not interchangeable display/search contracts.
([data cleaning](https://www.algolia.com/doc/guides/sending-and-managing-data/prepare-your-data/in-depth/data-sanitization),
[`attributesToHighlight`](https://www.algolia.com/doc/api-reference/api-parameters/attributesToHighlight),
[highlighting and snippeting](https://www.algolia.com/doc/guides/building-search-ui/ui-and-ux-patterns/highlighting-snippeting/js))

### Multiple fragment records

Algolia recommends splitting long pages at logical boundaries. `distinct`
groups records that share `attributeForDistinct`; `distinct=true` returns only
the most relevant record from each group. Fields needed to render that winning
fragment must therefore exist on every candidate record. When facet values are
shared by all records in a distinct group, `afterDistinct` is the documented
way to calculate facet counts after deduplication.
([index long pages](https://www.algolia.com/doc/guides/sending-and-managing-data/prepare-your-data/how-to/indexing-long-documents/),
[`distinct`](https://www.algolia.com/doc/api-reference/api-parameters/distinct),
[`attributesForFaceting`](https://www.algolia.com/doc/api-reference/api-parameters/attributesForFaceting))

### Full-record size accounting

Current online plans limit each free-plan record to 10 KB; paid plans allow a
100 KB individual record but impose a 10 KB average. Algolia measures the final
JSON after removing syntactically unnecessary whitespace. Attribute names,
values, arrays, nested objects, generated IDs, and all metadata repeated across
fragments therefore consume the budget. Retrieval and search settings provide
no size exemption.
([record-size limits and accounting](https://support.algolia.com/hc/en-us/articles/4406981897617-Is-there-a-size-limit-for-my-index-records),
[reduce record size](https://www.algolia.com/doc/guides/sending-and-managing-data/prepare-your-data/how-to/reducing-object-size),
[repository size research](algolia-record-size-constraints.md))

## Questions these facts leave to the decision

The sources do not decide:

- the stable allowlist and any explicit denylist for configurable Ghost fields;
- whether fields keep Ghost names, are mapped to package-owned names, or may be
  aliased;
- whether `excerpt`, `custom_excerpt`, neither, or both are projected, and which
  are searchable versus display-only;
- the scalar representation of authors and tags;
- whether all projected metadata is repeated on every fragment or only a
  documented subset; or
- which index settings the package owns as defaults, prerequisites, or user
  policy.

Those choices must be made together: projection changes affect default search
scope, response exposure, highlighting safety, distinct-result rendering, and
the byte budget of every generated fragment record.
