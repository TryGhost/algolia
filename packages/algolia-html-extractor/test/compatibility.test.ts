import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {
    extract,
    type ExtractionFragment,
    type ExtractedTagName,
    type HeadingRank
} from '../index.mts';
import {controlledFamilies} from './fixtures/ghost-rendered-v1/controlled-source.mts';

type LegacyGroup = {
    html: string;
    text: string;
    headings: readonly string[];
    anchor: string | null;
    sourceTag: ExtractedTagName;
    customRanking: {
        position: number;
        heading: HeadingRank;
    };
};

type GhostContentProjection = {
    objectID: string;
    slug: string;
    url: string;
    html: string;
    image: string | null;
    title: string;
    tags: readonly unknown[];
    authors: readonly unknown[];
};

type FixtureEvidence = {
    ghostVersion: string;
    sourceFormat: string;
    slug: string;
    uuid: string;
    sourceProof: {path: string; sha256: string};
    html: string;
};

type IntegrityManifest = Record<string, {bytes: number; sha256: string}>;

type ControlledCapture = {
    runtime: {
        ghostVersion: string;
        imageTag: string;
        image: string;
        imageId: string;
        platform: string;
        nodeVersion: string;
    };
    request: {
        method: string;
        sourceFormat: string;
        target: string;
        siteUrl: string;
        networkAccess: boolean;
    };
    families: Array<{
        id: string;
        sourceId: string;
        purpose: string;
        sourceHtml: string;
        lexical: {root: {children: Array<{type: string}>}};
        html: string;
        versions: Record<string, string>;
    }>;
};

type ControlledExpectation = {
    id: string;
    fragments: readonly ExtractionFragment[];
    finalRecords: readonly object[];
};

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceDirectory = path.resolve(packageDirectory, '../..');
const fixtureDirectory = path.join(packageDirectory, 'test/fixtures/ghost-rendered-v1');

const readJson = async <Value>(filePath: string): Promise<Value> => {
    return JSON.parse(await readFile(filePath, 'utf8')) as Value;
};

const sha256 = (content: Buffer): string => createHash('sha256').update(content).digest('hex');

const mapToLegacyRecords = (
    post: GhostContentProjection,
    fragments: readonly ExtractionFragment[]
): readonly object[] => {
    const groups: LegacyGroup[] = [];

    for (const fragment of fragments) {
        const existing = groups.find(group => group.anchor === fragment.anchor);

        if (existing === undefined) {
            groups.push({
                html: fragment.html,
                text: fragment.text,
                headings: fragment.headingPath,
                anchor: fragment.anchor,
                sourceTag: fragment.sourceTag,
                customRanking: {
                    position: fragment.position,
                    heading: fragment.headingRank
                }
            });
            continue;
        }

        existing.html += fragment.sourceTag === 'pre' ? ` ${fragment.text}` : fragment.html;
        existing.text += ` ${fragment.text}`;
    }

    return groups.map((group, index) => {
        const {text: _text, sourceTag: _sourceTag, ...recordFields} = group;
        const url = group.anchor === null ? post.url : `${post.url}#${group.anchor}`;

        return {...post, ...recordFields, url, objectID: `${post.objectID}_${index}`};
    });
};

describe('legacy compatibility through the public extract seam', () => {
    it('preserves grouping, pre merging, deep links, ranking, and final IDs', () => {
        const post = {
            objectID: 'compatibility',
            slug: 'compatibility',
            url: 'https://example.invalid/compatibility/',
            html: '',
            image: null,
            title: 'Compatibility',
            tags: [],
            authors: []
        };
        post.html = [
            '<p>Lead.</p>',
            '<h2 id="a">A</h2><p>One.</p>',
            '<h2 id="b">B</h2><p>Bee.</p>',
            '<h2 id="a">A again</h2><pre><code>two</code></pre>',
            '<h2>No anchor</h2><p>Still A.</p>',
            '<h2 id="b">B again</h2><table><td>Cell.</td></table><p> </p>'
        ].join('');

        expect(mapToLegacyRecords(post, extract(post.html))).toEqual([
            {
                objectID: 'compatibility_0',
                slug: 'compatibility',
                url: 'https://example.invalid/compatibility/',
                html: '<p>Lead.</p>',
                image: null,
                title: 'Compatibility',
                tags: [],
                authors: [],
                headings: [],
                anchor: null,
                customRanking: {position: 0, heading: 100}
            },
            {
                objectID: 'compatibility_1',
                slug: 'compatibility',
                url: 'https://example.invalid/compatibility/#a',
                html: '<p>One.</p> two<p>Still A.</p>',
                image: null,
                title: 'Compatibility',
                tags: [],
                authors: [],
                headings: ['A'],
                anchor: 'a',
                customRanking: {position: 1, heading: 80}
            },
            {
                objectID: 'compatibility_2',
                slug: 'compatibility',
                url: 'https://example.invalid/compatibility/#b',
                html: '<p>Bee.</p><td>Cell.</td><p> </p>',
                image: null,
                title: 'Compatibility',
                tags: [],
                authors: [],
                headings: ['B'],
                anchor: 'b',
                customRanking: {position: 2, heading: 80}
            }
        ]);
    });

    it('matches the reviewed Ghost-rendered fragments and validates their provenance', async () => {
        const integrity = await readJson<IntegrityManifest>(
            path.join(fixtureDirectory, 'integrity.json')
        );

        for (const [fileName, expected] of Object.entries(integrity)) {
            const content = await readFile(path.join(fixtureDirectory, fileName));
            expect({bytes: content.byteLength, sha256: sha256(content)}).toEqual(expected);
        }

        const evidence = await readJson<FixtureEvidence>(
            path.join(fixtureDirectory, 'evidence.json')
        );
        const sourceProofPath = path.join(workspaceDirectory, evidence.sourceProof.path);
        const sourceProofContent = await readFile(sourceProofPath);
        const sourceProof = JSON.parse(sourceProofContent.toString('utf8')) as {
            ghost_version: string;
            source_format: string;
            slug: string;
            uuid: string;
            html: string;
        };
        expect(sha256(sourceProofContent)).toBe(evidence.sourceProof.sha256);
        expect({
            ghostVersion: sourceProof.ghost_version,
            sourceFormat: sourceProof.source_format,
            slug: sourceProof.slug,
            uuid: sourceProof.uuid,
            html: sourceProof.html
        }).toEqual({
            ghostVersion: evidence.ghostVersion,
            sourceFormat: evidence.sourceFormat,
            slug: evidence.slug,
            uuid: evidence.uuid,
            html: evidence.html
        });

        const expectedFragments = await readJson<readonly ExtractionFragment[]>(
            path.join(fixtureDirectory, 'expected-fragments.json')
        );
        expect(extract(evidence.html)).toEqual(expectedFragments);

        const expectedFinalRecords = await readJson<readonly object[]>(
            path.join(fixtureDirectory, 'expected-final-records.json')
        );
        const ghostContentProjection = {
            objectID: 'controlled-ghost-content',
            slug: evidence.slug,
            url: `https://fixture.invalid/${evidence.slug}/`,
            html: evidence.html,
            image: null,
            title: 'Synthetic Ghost renderer proof',
            tags: [],
            authors: []
        };
        expect(mapToLegacyRecords(ghostContentProjection, extract(evidence.html))).toEqual(
            expectedFinalRecords
        );
    });

    it('matches all three controlled Ghost-rendered fixture families', async () => {
        const capture = await readJson<ControlledCapture>(
            path.join(fixtureDirectory, 'controlled-capture.json')
        );
        const expectations = await readJson<readonly ControlledExpectation[]>(
            path.join(fixtureDirectory, 'controlled-expectations.json')
        );

        expect(capture.runtime).toEqual({
            ghostVersion: '6.57.1',
            imageTag: 'ghost:6.57.1-alpine',
            image: 'ghost@sha256:6e37900accfb12e16fbc15bf94500e09829cb17e6448b3051e9c76446b4fbf53',
            imageId: 'sha256:1984dc765a374721616ed6bd43819fec66f70b97c365b0aee57a217a4e2b28c6',
            platform: 'linux/arm64',
            nodeVersion: '22.23.2'
        });
        expect(capture.request).toEqual({
            method: 'in-process Ghost renderer invocation',
            sourceFormat: 'synthetic HTML converted to Lexical',
            target: 'html',
            siteUrl: 'https://fixture.invalid/',
            networkAccess: false
        });
        expect(
            capture.families.map(({id, sourceId, purpose, sourceHtml}) => ({
                id,
                sourceId,
                purpose,
                sourceHtml
            }))
        ).toEqual(controlledFamilies);
        expect(JSON.stringify(capture)).not.toContain('main.ghost.is');

        const legacyFlow = capture.families.find(family => family.id === 'legacy-selected-flow');
        expect(legacyFlow?.html).toContain('<ol><li>First ordered</li>');
        expect(legacyFlow?.html).toContain('<ul><li>Nested unordered</li></ul>');
        expect(legacyFlow?.html).toContain('<!--kg-card-begin: html-->');
        expect(legacyFlow?.html).toContain('<th>Ignored header</th>');
        expect(legacyFlow?.html).toContain('<td>Selected body cell</td>');

        const semanticGaps = capture.families.find(
            family => family.id === 'intentional-semantic-gaps'
        );
        expect(semanticGaps?.html).toContain('kg-image-card kg-card-hascaption');
        expect(semanticGaps?.html).toContain('<figcaption>Ignored synthetic caption</figcaption>');
        expect(semanticGaps?.html).toContain('<blockquote>Synthetic blockquote text.</blockquote>');
        expect(semanticGaps?.html).toContain('<th>Ignored semantic header</th>');
        expect(semanticGaps?.html).toContain('<td>Selected semantic cell</td>');
        expect(semanticGaps?.html).toContain('kg-card kg-embed-card');

        for (const family of capture.families) {
            expect(family.versions).toEqual({
                htmlToLexical: '1.3.3',
                lexicalHtmlRenderer: '1.4.3',
                defaultNodes: '2.1.5'
            });
            const expected = expectations.find(candidate => candidate.id === family.id);
            expect(expected).toBeDefined();

            const fragments = extract(family.html);
            expect(fragments).toEqual(expected?.fragments);
            expect(
                mapToLegacyRecords(
                    {
                        objectID: `controlled-${family.id}`,
                        slug: family.id,
                        url: `https://fixture.invalid/${family.id}/`,
                        html: family.html,
                        image: null,
                        title: family.purpose,
                        tags: [],
                        authors: []
                    },
                    fragments
                )
            ).toEqual(expected?.finalRecords);
        }
    });
});
