import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {fragmentTransformer, transformToAlgoliaObject} from '@tryghost/algolia-fragmenter';

type FixtureEvidence = {
    slug: string;
    html: string;
};

type ControlledCapture = {
    families: Array<{
        id: string;
        purpose: string;
        html: string;
    }>;
};

type ControlledExpectation = {
    id: string;
    finalRecords: readonly object[];
};

type GhostContent = {
    id: string;
    slug: string;
    url: string;
    html: string;
    feature_image: null;
    title: string;
    tags: readonly [];
    authors: readonly [];
};

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixtureDirectory = path.resolve(
    testDirectory,
    '../../algolia-html-extractor/test/fixtures/ghost-rendered-v1'
);

const readJson = async <Value,>(fileName: string): Promise<Value> => {
    return JSON.parse(await readFile(path.join(fixtureDirectory, fileName), 'utf8')) as Value;
};

const createGhostContent = ({
    id,
    slug,
    url,
    html,
    title
}: Pick<GhostContent, 'id' | 'slug' | 'url' | 'html' | 'title'>): GhostContent => ({
    id,
    slug,
    url,
    html,
    feature_image: null,
    title,
    tags: [],
    authors: []
});

const createRecords = (ghostContent: GhostContent): readonly object[] => {
    return transformToAlgoliaObject([ghostContent]).reduce(fragmentTransformer, []);
};

describe('fragmenter compatibility through its public wrappers', () => {
    it('preserves null, descendant, repeated, and carried-forward anchor groups', () => {
        const ghostContent = createGhostContent({
            id: 'anchor-groups',
            slug: 'anchor-groups',
            url: 'https://fixture.invalid/anchor-groups/',
            html: [
                '<p>Lead.</p><p>Lead again.</p>',
                '<h2><span id="descendant">Descendant</span></h2><p>One.</p>',
                '<h2 id="other">Other</h2><p>Other.</p>',
                '<h2 id="descendant">Descendant again</h2><pre><code>two</code></pre>',
                '<h2>No anchor</h2><p>Still descendant.</p>'
            ].join(''),
            title: 'Anchor groups'
        });

        expect(createRecords(ghostContent)).toEqual([
            {
                objectID: 'anchor-groups_0',
                slug: 'anchor-groups',
                url: 'https://fixture.invalid/anchor-groups/',
                html: '<p>Lead.</p><p>Lead again.</p>',
                image: null,
                title: 'Anchor groups',
                tags: [],
                authors: [],
                headings: [],
                anchor: null,
                customRanking: {position: 0, heading: 100}
            },
            {
                objectID: 'anchor-groups_1',
                slug: 'anchor-groups',
                url: 'https://fixture.invalid/anchor-groups/#descendant',
                html: '<p>One.</p> two<p>Still descendant.</p>',
                image: null,
                title: 'Anchor groups',
                tags: [],
                authors: [],
                headings: ['Descendant'],
                anchor: 'descendant',
                customRanking: {position: 2, heading: 80}
            },
            {
                objectID: 'anchor-groups_2',
                slug: 'anchor-groups',
                url: 'https://fixture.invalid/anchor-groups/#other',
                html: '<p>Other.</p>',
                image: null,
                title: 'Anchor groups',
                tags: [],
                authors: [],
                headings: ['Other'],
                anchor: 'other',
                customRanking: {position: 3, heading: 80}
            }
        ]);
    });

    it('matches the reviewed Ghost-rendered final records', async () => {
        const evidence = await readJson<FixtureEvidence>('evidence.json');
        const expectedRecords = await readJson<readonly object[]>('expected-final-records.json');

        expect(
            createRecords(
                createGhostContent({
                    id: 'controlled-ghost-content',
                    slug: evidence.slug,
                    url: `https://fixture.invalid/${evidence.slug}/`,
                    html: evidence.html,
                    title: 'Synthetic Ghost renderer proof'
                })
            )
        ).toEqual(expectedRecords);
    });

    it('matches all controlled compatibility fixture families', async () => {
        const capture = await readJson<ControlledCapture>('controlled-capture.json');
        const expectations = await readJson<readonly ControlledExpectation[]>(
            'controlled-expectations.json'
        );

        for (const family of capture.families) {
            const expectation = expectations.find(candidate => candidate.id === family.id);
            expect(expectation, `Missing expectations for ${family.id}`).toBeDefined();

            expect(
                createRecords(
                    createGhostContent({
                        id: `controlled-${family.id}`,
                        slug: family.id,
                        url: `https://fixture.invalid/${family.id}/`,
                        html: family.html,
                        title: family.purpose
                    })
                )
            ).toEqual(expectation?.finalRecords);
        }
    });
});
