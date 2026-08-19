# Ghost Algolia

Ghost Algolia turns published Ghost content into structured records for an Algolia search index.

## Language

**Ghost content**:
A published post or page returned by the Ghost Content API, including its metadata and rendered HTML.
_Avoid_: Page, document, article when the resource type is not important

**Ghost content type**:
The resource kind of Ghost content: either `post` or `page`.
_Avoid_: Source, endpoint, page flag

**Ghost content identity**:
The stable Ghost content ID shared by every Algolia record derived from one post or page, independent of its mutable slug or content type.
_Avoid_: Slug, URL, fragment object ID

**Ghost content projection**:
The protected record fields and configured optional projection fields that are carried into every Algolia record derived from Ghost content.
_Avoid_: Post projection, base record, Algolia post

**Protected record field**:
An Algolia record attribute whose name and meaning are owned by the package to preserve identity, navigation, fragment structure, ranking, or deletion behaviour. Projection configuration cannot omit or override it.
_Avoid_: Custom field, pass-through field

**Optional projection field**:
An allowlisted public Ghost source field or package-owned compatibility projection that projection configuration may include, omit, or expose under a validated alias. Enabled optional fields are repeated in every Algolia record derived from that Ghost content.
_Avoid_: Custom field, arbitrary field

**Ranking sibling**:
An additional custom-ranking value carried beside the package-owned heading and position values, sourced from an allowlisted numeric or boolean Ghost field under a validated alias.
_Avoid_: Custom ranking field, ranking attribute, sort field

**Extraction fragment**:
An ordered emitted unit of searchable rendered meaning with searchable fragment HTML, preserved source text, heading context, and a fragment source.
_Avoid_: Chunk, paragraph record

**Extraction candidate**:
Potential searchable rendered meaning considered before descendant precedence and local duplicate suppression. A candidate becomes an extraction fragment only when the HTML extractor emits it.
_Avoid_: Extraction fragment, parser node

**Searchable fragment HTML**:
The safe HTML representation carried by every extraction fragment so downstream grouping and indexing never need to reinterpret its source.
_Avoid_: Outer HTML, raw attribute value

**Fragment source**:
A stable description of whether an extraction fragment came from element content or an attribute, including whether an element was selected as ordinary content or as a card-heading fallback.
_Avoid_: Parser node, candidate ID, card adapter

**Anchor group**:
The ordered extraction fragments of one Ghost content item that share the same anchor, kept in first-seen anchor order. It is the unit that fixes an Algolia record's deep link, heading context, and identifier.
_Avoid_: Heading group, section, chunk

**HTML extractor**:
The component that converts rendered HTML into ordered extraction fragments.
_Avoid_: Fragmenter, transformer

**Fragmenter**:
The component that groups extraction fragments and combines them with a post projection to produce Algolia records.
_Avoid_: HTML extractor

**Algolia record**:
The final indexed object containing projected Ghost fields, grouped extracted content, and ranking metadata.
_Avoid_: Extraction fragment, Algolia post

**Fallback record**:
The single Algolia record emitted for Ghost content that produces no extraction fragments. It carries the Ghost content projection with empty fragment content and the headingless rank.
_Avoid_: Empty record, placeholder record, stub

**Continuation record**:
An Algolia record carrying the later whole extraction fragments of one anchor group that did not fit within the record byte ceiling. It repeats the same projection and deep link under a stable suffixed object ID.
_Avoid_: Split record, overflow record, record page

**Record byte ceiling**:
The largest compact UTF-8 byte size allowed for one complete Algolia record, chosen so output stays valid on Algolia's smallest plan.
_Avoid_: Size limit, 10 KB limit, character count

**Preflight**:
The offline check that validates caller policy, Ghost content, and every complete Algolia record before any Algolia request. Failing preflight produces no records at all.
_Avoid_: Dry run (for this record check; the term still belongs to release tooling), validation pass, sanity check

**Ghost-rendered fixture**:
An immutable Content API response produced by Ghost from controlled source content and retained as deterministic test evidence.
_Avoid_: Mock response, live fixture

**Live content smoke test**:
A non-blocking check against a changing Ghost site that detects contract or structural drift without asserting exact editorial content.
_Avoid_: Acceptance test, fixture test

**Searchable rendered meaning**:
Author-controlled meaning in rendered Ghost content intended for readers, including an eligible image alternative even though its text is not itself rendered visibly. It excludes generated controls and states, provider chrome, URLs, decorative content, and meaning inside content explicitly marked as non-semantic.
_Avoid_: Visible text, all rendered text
