# Ghost Algolia

Ghost Algolia turns published Ghost content into structured records for an Algolia search index.

## Language

**Ghost content**:
A published post or page returned by the Ghost Content API, including its metadata and rendered HTML.
_Avoid_: Page, document, article when the resource type is not important

**Ghost content projection**:
The protected record fields and configured optional projection fields that are carried into every Algolia record derived from Ghost content.
_Avoid_: Post projection, base record, Algolia post

**Protected record field**:
An Algolia record attribute whose name and meaning are owned by the package to preserve identity, navigation, fragment structure, ranking, or deletion behaviour. Projection configuration cannot omit or override it.
_Avoid_: Custom field, pass-through field

**Optional projection field**:
An allowlisted public Ghost source field or package-owned compatibility projection that projection configuration may include, omit, or expose under a validated alias. Enabled optional fields are repeated in every Algolia record derived from that Ghost content.
_Avoid_: Custom field, arbitrary field

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
Author-controlled meaning in rendered Ghost content intended for readers, including an eligible image alternative even though its text is not itself rendered visibly. It excludes generated controls and states, provider chrome, URLs, decorative content, and meaning inside content explicitly marked as non-semantic.
_Avoid_: Visible text, all rendered text
