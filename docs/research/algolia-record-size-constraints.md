# Algolia record-size constraints

Status: researched against live official Algolia documentation on 2026-08-13.

## Decision summary

Ghost's deterministic size policy should target the strictest current generally available limit: every complete record, after compact JSON serialization, must be **less than 10,000 UTF-8 bytes**. This keeps the public packages usable on Algolia's free Build plan and is conservative across Algolia's undocumented `KB` boundary convention.

This is a compatibility target chosen by Ghost, not a claim that all Algolia plans have a 10 KB per-record limit. Paid online plans currently allow larger individual records but add an average-size constraint. The configured Algolia plan must therefore remain irrelevant to extraction correctness; a paid plan should not be required to accept Ghost output.

## Current official limits

Algolia's current service-limit summary gives a plan-dependent range of 10 KB to 100 KB and identifies 10 KB as the free-plan maximum. Its more detailed support article distinguishes the online and legacy plans:

| Plan | Individual-record maximum | Additional constraint |
| --- | ---: | --- |
| Free (the current pricing page calls this Build) | 10 KB | None documented |
| Paid online plans | 100 KB | 10 KB average across all records |
| Legacy Pro, Starter, or Free plans from before 2020-07-01 | 10 KB | None documented |
| Legacy Essential or Plus plans from before 2020-07-01 | 20 KB | None documented |

Committed subscriptions or service orders may differ, so these are public-plan defaults rather than a universal account contract. Algolia does not document in these sources whether `KB` means 1,000 or 1,024 bytes, nor how it enforces the paid-plan 10 KB average. Those facts must not be invented by the package.

Sources: [Algolia service limits](https://www.algolia.com/doc/guides/scaling/algolia-service-limits), [Algolia record and index size limits](https://support.algolia.com/hc/en-us/articles/4406981897617-Is-there-a-size-limit-for-my-index-records), and [Algolia pricing](https://www.algolia.com/pricing).

## What counts toward record size

Algolia describes its calculation as stringifying the JSON input, removing whitespace outside key and value strings that is not syntactically necessary, parsing it again, and applying the limit to that final JSON. Consequently:

- Measure the **whole record**, not only `html` or another large value. Attribute names, values, `objectID`, nested objects and arrays, JSON punctuation, escaping, and spaces inside strings all remain in the compact representation.
- Formatting whitespace outside strings is irrelevant. `JSON.stringify(record)` produces the appropriate compact representation for this repository's plain JSON records.
- JavaScript's `JSON.stringify(record).length` counts UTF-16 code units, not bytes. It can undercount non-ASCII Ghost content. The repository-compatible measurement is `Buffer.byteLength(JSON.stringify(record), 'utf8')`.
- Algolia does not name the character encoding used by its size check. UTF-8 is the wire encoding for JSON sent by this Node client and is the conservative, reproducible local definition to adopt.

The strict `< 10_000` target intentionally leaves the exact 10 KB boundary unused. A larger engineering safety margin may be chosen by the follow-on policy ticket, but it should be expressed separately from Algolia's documented limit.

Source: [Algolia record and index size limits](https://support.algolia.com/hc/en-us/articles/4406981897617-Is-there-a-size-limit-for-my-index-records).

## Searchable and stored attributes

Algolia advises sending only attributes needed for search, display, sorting, filtering, or relevance. `searchableAttributes` controls which submitted attributes are searched; it does not remove other attributes from the submitted record. Similarly, `attributesToRetrieve` and `unretrievableAttributes` control search responses, not the JSON record accepted at indexing time. They therefore must not be treated as record-size exemptions.

For Ghost, fields duplicated into every extraction fragment—currently `slug`, `url`, `image`, `title`, projected `tags` and `authors`, `headings`, `anchor`, `customRanking`, and `objectID`—consume part of every record's budget before `html` is added. Any future projected field consumes budget whether or not it is searchable.

Sources: [Prepare records for indexing](https://www.algolia.com/doc/guides/sending-and-managing-data/prepare-your-data), [Reduce record size](https://www.algolia.com/doc/guides/sending-and-managing-data/prepare-your-data/how-to/reducing-object-size), and [`unretrievableAttributes`](https://www.algolia.com/doc/api-reference/api-parameters/unretrievableAttributes).

## Failure and batching behaviour

When an individual record exceeds its plan's maximum, Algolia documents the API error as `Record is too big`; framework documentation also shows the more diagnostic form `Record at the position XX objectID=XX is too big`. Algolia recommends removing unnecessary attributes or splitting long documents into smaller records and using `distinct` to present the best matching part.

This is separate from request-body size. Algolia currently permits an indexing request body up to 1 GB but recommends batches around 10 MB. A legal batch can therefore still contain an illegal record, and reducing the number of records in a batch does not make that record valid.

The repository's `@tryghost/algolia-indexer` uses `algoliasearch@4.20.0` and calls `saveObjects(fragments)` once. That installed client sends sequential batches of 1,000 records. The indexer wraps any rejection as one `AlgoliaError`; it does not preflight sizes or identify a record itself. Because earlier batches can already have received task IDs before a later batch rejects, callers must not assume a failed multi-batch `saveObjects` call left the index untouched. The official material reviewed here does not establish batch-level atomicity when one record is oversized, so no stronger guarantee should enter the design.

Sources: [Reduce record size](https://www.algolia.com/doc/guides/sending-and-managing-data/prepare-your-data/how-to/reducing-object-size), [Save records](https://www.algolia.com/doc/libraries/sdk/methods/search/save-objects), [Batch indexing operations](https://www.algolia.com/doc/rest-api/search/batch), and [Sending records in batches](https://www.algolia.com/doc/guides/sending-and-managing-data/send-and-update-your-data/how-to/sending-records-in-batches).

## Repository findings

- `packages/algolia-fragmenter/test/fragmenter.test.js` currently asserts `JSON.stringify(record).length < 10000`. Its threshold is directionally correct for the free plan, but its character count is not the required UTF-8 byte count.
- `packages/algolia-fragmenter/lib/transformer.js` groups extracted elements by heading anchor. It does not enforce a byte budget, so a long headingless post or a long section can still exceed the limit.
- The CLI documentation acknowledges this and currently tells operators to exclude oversized posts. That is operational fallback, not deterministic record-size handling.
- `packages/algolia-indexer/lib/IndexFactory.js` makes `html` searchable and uses `slug` for distinctness and filtering. Splitting is compatible with the current search model provided every split retains the fields needed by distinctness, ranking, display, filtering, and stable updates.
- The reviewed Ghost 6 golden fixture contains 101 records ranging from 410 to 717 compact UTF-8 bytes, averaging about 475 bytes. The existing `massive-example.html` fixture produces seven records with a maximum of 2,511 bytes. Neither fixture exercises the actual boundary or a non-ASCII character/byte mismatch.

## Constraints for the follow-on design

The record-size policy should therefore:

1. validate the final projected Algolia record, not an extraction fragment or its HTML alone;
2. use compact UTF-8 byte size and a strict free-plan-compatible ceiling;
3. reserve space for metadata before allocating content bytes;
4. split deterministically rather than silently truncate or require operators to skip a post;
5. preserve the fields and ordering needed by `distinct`, ranking, deep links, display, deletion, and stable `objectID` generation;
6. cover multi-byte text, JSON escaping, metadata-heavy records, headingless documents, and an exact near-boundary case in offline tests; and
7. report an actionable local error only when an indivisible value or required metadata cannot fit, before calling Algolia.

The exact safety margin, splitting unit, and stable ID scheme remain decisions for [Define deterministic Algolia record-size behaviour](https://github.com/TryGhost/algolia/issues/198). This research establishes their external constraints; it does not choose those behaviours.
