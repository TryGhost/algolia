# Ghost Algolia

Ghost Algolia turns published Ghost content into structured records for an Algolia search index.

## Language

**Ghost content**:
A published post or page returned by the Ghost Content API, including its metadata and rendered HTML.
_Avoid_: Page, document, article when the resource type is not important

**Post projection**:
The selected Ghost content fields that are carried into every Algolia record derived from that content.
_Avoid_: Base record, Algolia post

**Extraction fragment**:
An ordered unit of rendered HTML associated with its current heading path, anchor, and position.
_Avoid_: Chunk, paragraph record

**HTML extractor**:
The component that converts rendered HTML into ordered extraction fragments.
_Avoid_: Fragmenter, transformer

**Fragmenter**:
The component that groups extraction fragments and combines them with a post projection to produce Algolia records.
_Avoid_: HTML extractor

**Algolia record**:
The final indexed object containing projected Ghost fields, grouped extracted content, and ranking metadata.
_Avoid_: Extraction fragment, Algolia post

**Ghost-rendered fixture**:
An immutable Content API response produced by Ghost from controlled source content and retained as deterministic test evidence.
_Avoid_: Mock response, live fixture

**Live content smoke test**:
A non-blocking check against a changing Ghost site that detects contract or structural drift without asserting exact editorial content.
_Avoid_: Acceptance test, fixture test

**Searchable rendered meaning**:
Author-controlled meaning in rendered Ghost content intended for readers, including a meaningful image alternative even when it is not visually displayed. It excludes generated controls and states, provider chrome, URLs, decorative content, and content explicitly marked as non-semantic.
_Avoid_: Visible text, all rendered text
