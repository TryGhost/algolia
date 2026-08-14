# Ghost HTML evidence corpus

## Decision

Maintain a small, immutable **Ghost-rendered fixture** corpus that proves how
controlled source content is rendered by Ghost. It complements, but does not
replace, the exhaustive handwritten differential cases required by the legacy
compatibility contract.

The corpus is selected from a privacy-minimized structural census of
`main.ghost.is`. A live item contributes only a normalized structural signature;
its title, slug, identifier, URL, text, HTML, link targets, media URLs, captions,
and alternative text are never retained. Each selected signature is then
recreated with synthetic source content in a disposable, version-pinned Ghost
instance. Only that controlled instance's Content API output becomes test data.

This keeps three evidence roles separate:

1. handwritten parser cases exhaustively prove legacy edge behaviour;
2. the compact corpus proves that representative inputs are genuinely rendered
   by Ghost rather than invented around the extractor;
3. the live content smoke test detects changing structure without making mutable
   editorial content a pull-request dependency.

## Compact corpus

Keep three fixture families. A family may contain more than one Content API item
only when Ghost cannot faithfully produce its structures from one controlled
source item.

### 1. Legacy-selected flow

One controlled item should combine the Ghost-rendered structures that cross the
compatibility-first extractor seam:

- generated heading identifiers and at least two heading levels;
- paragraphs with inline formatting, entities, Unicode, and a link;
- ordered, unordered, and nested list items;
- a code block rendered as `pre`/`code`;
- a table with body cells; and
- content before, between, and after those blocks so document order, heading
  state, anchors, and positions remain observable.

The repository's existing representative Ghost 6 renderer proof already covers
the heading, paragraph/link, list, code-block, and image parts of this family. It
is a useful seed, but the new compact corpus should not depend on or duplicate
the surrounding 101-post pagination dataset.

### 2. Intentional semantic gaps

One controlled item should combine structures known to occur in representative
Ghost output but intentionally ignored or only partly observed by the legacy
selector:

- an image figure with an image alternative-text attribute and a caption;
- a blockquote;
- a table header alongside body cells; and
- a raw HTML or embed boundary if that boundary appears in the minimized live
  census.

This family freezes the fact that the compatibility release sees `td` but not
`th`, and does not independently extract captions, image alternative text, or
blockquote content. It must not silently turn those omissions into new
extraction behaviour. The later richer-semantics decision can reuse the same
Ghost-rendered evidence when deciding which omissions to correct.

### 3. Observed Ghost card boundaries

One or more controlled items should cover each **structurally distinct card
family actually observed** by the minimized `main.ghost.is` census. Deduplicate
cards by normalized wrapper/tag shape and Ghost-owned `kg-*` class tokens rather
than by card name or editorial occurrence. Prefer one representative for a
family unless a variant changes selected descendants (`h1`-`h6`, `p`, `pre`,
`td`, or `li`), heading/anchor state, or intentional semantic-gap evidence.

Ghost's official theme documentation currently identifies audio, blockquote,
bookmark, button, callout, file, gallery, header, NFT, product, toggle, video,
and signup card classes. That list is a discovery checklist, not a requirement
to freeze every supported card. The evidence corpus is compact because it
retains only structures observed on `main.ghost.is` or explicitly required by a
settled extraction decision.

## Structural census and selection

The first authenticated census belongs to [Define the live Ghost Content API
smoke contract](https://github.com/TryGhost/algolia/issues/191). Its census step
should parse Content API `html` in memory and emit only:

- tag names and their order within a structural signature;
- Ghost-owned `kg-*` class tokens, dropping all other class values;
- presence, never values, of `id`, `name`, `href`, `src`, `alt`, and relevant
  `data-*` attributes;
- parent/ancestor relationships for selected elements;
- heading-level sequences and whether headings carry direct or descendant
  anchors;
- selected-element counts and presence of captions, table headers,
  blockquotes, figures, and card wrappers; and
- aggregate occurrence counts for each normalized signature.

Do not retain hashes of raw text or raw HTML: they add no structural evidence
and can still disclose or fingerprint editorial content. Do not write the live
response to the repository or CI artifacts. Logs should contain aggregate
signature identifiers and counts only.

Select the smallest set of signatures that covers:

1. every legacy-selected tag in a Ghost-rendered context;
2. every heading/anchor or nesting shape that changes compatibility behaviour;
3. the intentional semantic gaps above; and
4. each observed Ghost card family whose descendants or wrapper boundary is
   relevant to current or planned extraction semantics.

Frequency does not determine correctness. A structure seen once is included if
it adds coverage; a common structure is deduplicated when another selected item
has the same normalized signature. Record the aggregate census in the research
or smoke report, not in the immutable fixture payload.

## Controlled reproduction

For every selected structural signature:

1. author deterministic synthetic source content using reserved `.invalid`
   URLs and obviously synthetic text;
2. use native Lexical source for editor cards that HTML import cannot reproduce
   faithfully, and record that source alongside the fixture;
3. render it in a disposable Ghost instance pinned by Ghost version, container
   digest, and platform;
4. capture a raw, narrowly projected Content API response containing only the
   stable identity needed to map the source plus `html` (for example `uuid`,
   `slug`, and `html`);
5. retain a renderer proof that maps the controlled source to the returned
   `html`, without retaining credentials or unrelated Admin API fields; and
6. freeze source, response, proof, validation scripts, and reviewed expected
   fragments with byte counts and SHA-256 digests.

Expected extraction fragments must be reviewed literals. Tests must not
regenerate expected output from the implementation under test. The legacy
compatibility suite should also compare complete final Algolia records for these
fixtures, because exact final-record parity remains the release gate.

The existing `packages/algolia/test/fixtures/ghost-v6/PROVENANCE.md` process is
the model: deterministic source, pinned Ghost image, raw Content API capture,
renderer proof, independent validation, byte-level integrity, redacted
credentials, and offline acceptance checks. The compact corpus should live in a
separate extractor-focused fixture directory so routine tests need not load the
large pagination capture.

## Provenance record

Each corpus version must document:

- the safe live-observation date, explicit URL `https://main.ghost.is`, Content
  API version, and the normalized signature identifiers that motivated each
  controlled specimen;
- that the effective local profile guard reported `main` and exactly
  `https://main.ghost.is` before any local live access;
- the live projection and minimization algorithm, including confirmation that
  no live response or editorial field was retained;
- controlled source format and files;
- exact Ghost version, image tag and digest, platform, Node version, local site
  URL, and capture time;
- redacted Content API request shape and any renderer-proof request shape;
- a mapping from signature identifier to synthetic source and captured response;
- validation assertions, file byte counts, and SHA-256 digests; and
- the issue or review that accepted a new structural family or removed an old
  one.

Provenance may name `main.ghost.is` and aggregate structural facts. Fixture
payloads must contain no `main.ghost.is` editorial values and no credentials,
tokens, cookies, private/support data, or real personal information.

## Refresh and review policy

Fixtures are immutable evidence, not a cache of staging. Do not overwrite them
on a schedule or because editorial content changed.

Create a new versioned capture when one of these occurs:

- the supported Ghost renderer version changes;
- the live smoke census reports a previously unseen normalized signature that
  adds coverage;
- a settled extraction-semantics decision makes an existing structure newly
  observable; or
- provenance or reproduction checks reveal that the current evidence is not
  trustworthy.

A smoke drift report starts an investigation; it does not automatically rewrite
fixtures. First distinguish harmless content-mix churn from a Ghost renderer
change. If the live structure cannot be recreated from controlled Ghost source,
do not copy the live HTML. Record the reproduction gap and resolve it before
adding evidence.

Every refresh should be reviewed independently by a repository maintainer who
did not perform the capture. Review must verify:

- structural coverage changed for an explicit reason;
- source text and URLs are synthetic and minimized;
- rendered output came from the documented pinned Ghost runtime;
- no secret or live editorial value entered source, response, proof, logs, or
  expected output;
- integrity and validation scripts pass offline;
- expected extraction fragments and complete final records were inspected as
  literals; and
- old evidence remains available unless a separate compatibility decision
  explicitly retires it.

## Downstream implications

- [Define the live Ghost Content API smoke
  contract](https://github.com/TryGhost/algolia/issues/191) can now specify the
  normalized census, safe logging, drift comparison, cadence, fork behaviour,
  and ownership without asserting exact editorial content.
- [Decide richer rendered-HTML extraction
  semantics](https://github.com/TryGhost/algolia/issues/197) should decide which
  frozen intentional gaps become searchable; it should not recollect live prose
  or invent a second evidence corpus.
- [Define the compatible implementation and release
  sequence](https://github.com/TryGhost/algolia/issues/201) should include the
  dedicated fixture directory, provenance/validation scripts, differential
  fragment tests, and exact final-record tests in the extractor-replacement
  slice.
- A newly observed structure that cannot be represented by the three families
  above is a new extraction-policy question only if it changes supported
  semantics. Otherwise it extends the appropriate family without creating a new
  public contract.

## Evidence and limitations

On 2026-08-14, the local `ghst` safety checks reported active profile `main` and
site URL exactly `https://main.ghost.is`. The subsequent Content API attempt
stopped before a request because secure credential storage was unavailable. No
live payload was read or retained. This research deliberately did not consume or
work around the repository Actions secret: the settled provisioning decision
assigns the first authenticated read to the live-smoke-contract ticket.

The corpus recommendation therefore rests on primary evidence already available
in this repository, settled compatibility and API decisions, controlled Ghost 6
renderer output, and Ghost's official Content API and editor-output
documentation. The exact current aggregate signature counts remain an input to
the first smoke-contract run, not a claim made here.

## Sources

- [Plan a maintained HTML-to-Algolia extraction
  pipeline](https://github.com/TryGhost/algolia/issues/186)
- [Freeze the legacy extraction compatibility
  contract](https://github.com/TryGhost/algolia/issues/194) and
  [`legacy-extraction-compatibility-contract.md`](legacy-extraction-compatibility-contract.md)
- [Design the public HTML extractor
  API](https://github.com/TryGhost/algolia/issues/193)
- [Provision read-only `main.ghost.is` Content API
  access](https://github.com/TryGhost/algolia/issues/190)
- [Ghost Content API overview](https://docs.ghost.org/content-api/)
- [Ghost Content API posts](https://docs.ghost.org/content-api/posts)
- [Ghost theme content and editor-card output](https://docs.ghost.org/themes/content)
- [`CONTEXT.md`](../../CONTEXT.md)
- [`packages/algolia-fragmenter/lib/transformer.js`](../../packages/algolia-fragmenter/lib/transformer.js)
- [`packages/algolia-fragmenter/test/fragmenter.test.js`](../../packages/algolia-fragmenter/test/fragmenter.test.js)
- [`packages/algolia/test/fixtures/ghost-v6/PROVENANCE.md`](../../packages/algolia/test/fixtures/ghost-v6/PROVENANCE.md)
- [`packages/algolia/test/fixtures/ghost-v6/generate-import.mjs`](../../packages/algolia/test/fixtures/ghost-v6/generate-import.mjs)
- [`packages/algolia/test/fixtures/ghost-v6/ghost-renderer-proof.json`](../../packages/algolia/test/fixtures/ghost-v6/ghost-renderer-proof.json)
