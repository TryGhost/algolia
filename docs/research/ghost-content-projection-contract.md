# Ghost content projection contract

Status: approved through human review on 2026-08-14.

This contract resolves the record-projection decisions behind
[HTML tags in search results](https://github.com/TryGhost/algolia/issues/148)
and
[Extend algoliaPost with additional Ghost post fields](https://github.com/TryGhost/algolia/issues/43).
The primary-source constraints are recorded separately in
[Ghost field projection: primary-source constraints](ghost-field-projection-primary-source-constraints.md).

## Module interface

`@tryghost/algolia-fragmenter` exposes one new deep synchronous interface that
turns Ghost content into complete final Algolia records:

```ts
export type OptionalProjectionSource =
    | 'image'
    | 'tags'
    | 'authors'
    | 'excerpt'
    | 'custom_excerpt'
    | 'feature_image_alt'
    | 'feature_image_caption'
    | 'canonical_url'
    | 'featured'
    | 'visibility'
    | 'created_at'
    | 'updated_at'
    | 'published_at'
    | 'reading_time';

export type ProjectionField =
    | OptionalProjectionSource
    | Readonly<{
          source: OptionalProjectionSource;
          as: string;
      }>;

export type RankingSource = 'featured' | 'reading_time';

export type RankingField = Readonly<{
    source: RankingSource;
    as: string;
}>;

export type ContentProjection = Readonly<{
    fields: readonly ProjectionField[];
    customRanking?: readonly RankingField[];
}>;

export type CreateAlgoliaRecordsOptions = Readonly<{
    ignoreSlugs?: readonly string[];
    contentProjection?: ContentProjection;
}>;

export function createAlgoliaRecords(
    ghostContent: readonly GhostContent[],
    options?: CreateAlgoliaRecordsOptions
): readonly AlgoliaRecord[];
```

The interface owns post/page projection, HTML extraction, legacy-compatible
grouping, fallback-record creation, deep links, identifiers, ranking metadata,
deterministic size handling, and validation. Callers do not coordinate those
stages.

The existing `transformToAlgoliaObject(posts, ignoreSlugs?)` and
`fragmentTransformer` exports remain deprecated compatibility wrappers. They
retain their current behaviour and do not receive the new projection policy.
CLI and Netlify adapters migrate to `createAlgoliaRecords` when the new
behaviour is released.

All new source and tests are strict TypeScript. ESM, CommonJS, declarations,
and source maps are generated package artifacts rather than hand-authored
variants.

## Protected record fields

These final-record fields are package-owned and cannot be omitted, aliased, or
overridden:

- `objectID`
- `slug`
- `url`
- `title`
- `html`
- `headings`
- `anchor`
- `customRanking.heading`
- `customRanking.position`

`objectID`, deep-link `url`, fragment `html`, `headings`, `anchor`, and the two
protected ranking values are derived by the fragmenter. The required Ghost
input fields are `id`, `slug`, `url`, `title`, and `html`.

## Default and configured projection

When `contentProjection` is absent, the optional field set is:

- `image`
- `tags`
- `authors`
- `excerpt`

`excerpt` is the Ghost-computed presentation excerpt: the custom excerpt when
present, otherwise Ghost's generated plaintext excerpt. It is projected in
addition to fragment `html`, not instead of it. `custom_excerpt` is not a
default because it can duplicate `excerpt`.

When `contentProjection` is present, `fields` is required and is the complete
desired optional field set. An empty array is valid. There are no additive or
subtractive patch lists and no schema-version property; package semver governs
the public configuration contract.

The initial optional allowlist is exactly:

- compatibility/display fields: `image`, `tags`, `authors`, `excerpt`;
- excerpt and image metadata: `custom_excerpt`, `feature_image_alt`,
  `feature_image_caption`;
- navigation and state: `canonical_url`, `featured`, `visibility`;
- time and reading metadata: `created_at`, `updated_at`, `published_at`,
  `reading_time`.

`image` retains the compatibility mapping from Ghost's `feature_image`.
`tags` and `authors` retain arrays of `{name, slug}`. Making either relation
optional means including, omitting, or aliasing that complete compatibility
shape; it does not expose arbitrary relation fields.

Raw source formats, plaintext, code injection, frontmatter, SEO/social
duplicates, internal identifiers, richer relation objects, and arbitrary
future Ghost properties are not selectable. Expanding the allowlist later is
compatible; arbitrary pass-through is not.

## Aliases and collisions

An optional projection field may use an alias matching
`^[A-Za-z][A-Za-z0-9_]*$`. Aliases are single record-attribute names, not object
paths.

Reject a policy before processing content when it contains:

- an unknown or repeated source;
- a repeated output name;
- an alias colliding with a protected field;
- an alias equal to the package-owned `customRanking` container, whether used
  by a projection field or ranking field;
- an alias impersonating any canonical allowlist name, even when that field is
  omitted;
- `heading` or `position` inside `customRanking`;
- an Algolia-reserved name, including `_highlightResult`, `_snippetResult`,
  `_rankingInfo`, `_distinctSeqID`, `distinctSeqId`, `_tags`, or `_geoloc`;
- a dot, leading underscore, wildcard, expression, arbitrary source path, or
  executable mapper.

Aliases change only the output key. They do not change or coerce the value's
type.

## Additional custom-ranking values

The fragmenter always emits package-owned `customRanking.heading` and
`customRanking.position`. A policy may add sibling values sourced from the
allowlisted numeric or boolean fields `featured` and `reading_time`.

Each configured sibling requires a validated output alias. Missing values
become `null`. The fragmenter does not initially convert timestamps, evaluate
expressions, or accept ranking callbacks. Index owners remain free to choose
which emitted ranking fields Algolia uses.

## Projection and fallback behaviour

Enabled optional fields are repeated in every Algolia record derived from the
same Ghost content. This keeps every candidate fragment returned by Algolia's
distinct handling self-contained. Every repeated key and value counts toward
that record's size.

For an enabled field:

- a missing scalar becomes `null`;
- missing `tags` or `authors` becomes `[]`;
- meaningful `false`, `0`, and empty-string values are preserved;
- a present value with the wrong documented type fails validation;
- correctly typed values are copied without coercion or sanitization.

Consumers escape `excerpt` and every other projected text value before
rendering it as text. The projection layer does not sanitize fragment `html`
or Algolia highlight output; consumers sanitize both before rendering them as
HTML.

Ghost content that produces no extraction fragments emits one projection-only
fallback record. This example shows its fixed fields; policy-dependent optional
fields and custom-ranking siblings are omitted:

```json
{
  "objectID": "<content id>_0",
  "slug": "<content slug>",
  "url": "<base content URL>",
  "html": "",
  "title": "<content title>",
  "headings": [],
  "anchor": null,
  "customRanking": {
    "heading": 100,
    "position": 0
  }
}
```

The normative fallback contains every enabled optional field and configured
custom-ranking sibling in addition to the fixed fields shown above. It uses the
existing headingless rank and does not copy plaintext into `html`.

## Size, ordering, and failures

Output order is Ghost-content input order, then first-seen legacy anchor-group
order, then continuation order. The fragmenter applies the already-approved
deterministic size policy after legacy grouping:

- every complete compact record is at most 9,999 UTF-8 bytes;
- whole extraction fragments are greedily packed without truncation;
- the first record keeps `<content id>_<group index>`;
- continuations add `_<continuation index>`;
- configured metadata is never silently dropped to make a record fit.

`createAlgoliaRecords` validates the whole batch and returns no records when
any deterministic policy, content, or size problem exists. One public
`FragmenterError` exposes a discriminated code:

- `INVALID_POLICY`
- `INVALID_GHOST_CONTENT`
- `RECORD_TOO_LARGE`

Its structured details contain all deterministic issues in input order. Size
issues include content identity, anchor and source position when available,
measured bytes, the 9,999-byte ceiling, and excess. Unexpected implementation
defects remain native errors.

Ignored slugs are identified and removed before full protected-field and
record validation, while still requiring a valid slug to make the exclusion
decision.

## Shared adapters

The same JSON-serializable `contentProjection` shape is used by every caller:

- direct package callers pass `options.contentProjection`;
- CLI configuration uses a top-level `contentProjection` property;
- canonical Netlify handlers parse `ALGOLIA_CONTENT_PROJECTION` as JSON.

Invalid configuration is reported before Ghost fetching or Algolia writes.
The CLI continues to request public scalar fields without a `fields`
parameter. It adds `include=tags` and/or `include=authors` only when those
optional relations are enabled. Netlify applies the same projection to the
webhook's current Ghost content object.

The contract applies identically to Ghost posts and pages. Endpoint selection
and page enumeration belong to the separate page-indexing decision, not to
projection.

## Algolia settings ownership

Projection controls record data only. It never implicitly makes a field
searchable, retrievable, facetable, or rankable and never mutates index
settings during a webhook request.

The package's current default `searchableAttributes` remain unchanged;
`excerpt` is display-only under those defaults. Sites that customize
projection own the corresponding explicit Algolia settings. Naming a missing
attribute in settings is tolerated by Algolia but does not synthesize it.

## Compatibility and source-request disposition

The extractor-replacement slice still preserves existing final records
exactly. Default `excerpt`, configurable projection, fallback records, the new
deep fragmenter interface, and deterministic size behaviour are separately
released follow-on changes. The implementation-and-release-sequence decision
owns their package and migration order.

The two source requests receive a link to this approved contract but remain
open until the implementation ships. Delivery—not planning—closes them.

Rejected alternatives include replacing fragment HTML with excerpt; defaulting
`custom_excerpt`; arbitrary pass-through or executable mappers; allowing
callers to overwrite protected fragment ranking; patch-style include/exclude
configuration; automatically rewriting Algolia settings; returning partial
batches; silently truncating or dropping fields; and closing the source
requests before delivery.
