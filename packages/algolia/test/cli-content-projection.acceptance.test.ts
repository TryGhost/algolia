import {afterEach, describe, expect, it} from 'vitest';

import {
    CliAcceptanceHarness,
    cliOutput,
    defaultContentApiKey,
    type AlgoliaRequest,
    type CliConfig,
    type CliRun,
    type JsonValue,
    type ReplayPlanEntry
} from './helpers/cli-acceptance-harness.ts';

type GhostContent = Readonly<{
    id: string;
    slug: string;
    url: string;
    title: string;
    html: string;
    feature_image?: string | null;
    tags?: readonly JsonValue[];
    authors?: readonly JsonValue[];
    excerpt?: string | null;
    custom_excerpt?: string | null;
    featured?: boolean;
    reading_time?: JsonValue;
}>;

type RecordedBatchEntry = Readonly<{
    action: string;
    body: Readonly<Record<string, JsonValue>>;
}>;

const harness = new CliAcceptanceHarness({temporaryDirectoryPrefix: 'algolia-projection-'});

const createGhostContent = (overrides: Partial<GhostContent> = {}): GhostContent => ({
    id: 'post-id',
    slug: 'projected-post',
    url: 'https://example.com/projected-post/',
    title: 'Projected post',
    html: '<p>Searchable body.</p>',
    feature_image: 'https://example.com/projected.jpg',
    tags: [{name: 'Projection', slug: 'projection'}],
    authors: [{name: 'Ghost Author', slug: 'ghost-author'}],
    excerpt: 'Default excerpt',
    custom_excerpt: '',
    featured: false,
    reading_time: 0,
    ...overrides
});

const createConfig = (
    replayOrigin: string,
    additions: Readonly<Record<string, JsonValue>> = {}
): CliConfig => ({
    ghost: {
        apiUrl: replayOrigin,
        apiKey: defaultContentApiKey
    },
    algolia: {
        appId: 'acceptance-app',
        apiKey: 'acceptance-admin-key',
        index: 'ghost-content'
    },
    ignore_slugs: [],
    ...additions
});

const createReplayPlan = (
    posts: readonly GhostContent[],
    include?: string
): readonly ReplayPlanEntry[] => {
    const query: Record<string, string> = {
        key: defaultContentApiKey,
        limit: '100',
        page: '1'
    };
    if (include !== undefined) {
        query.include = include;
    }

    return [
        {
            query,
            body: {
                posts,
                meta: {
                    pagination: {
                        page: 1,
                        limit: 100,
                        pages: 1,
                        total: posts.length,
                        next: null,
                        prev: null
                    }
                }
            }
        }
    ];
};

const requestPath = (request: AlgoliaRequest): string => {
    return `${request.method} ${new URL(request.url).pathname}`;
};

const requestBody = <Value>(request: AlgoliaRequest): Value => {
    if (request.data === undefined) {
        throw new Error(`Expected ${requestPath(request)} to have a request body.`);
    }
    return JSON.parse(request.data) as Value;
};

const requestAt = (requests: readonly AlgoliaRequest[], index: number): AlgoliaRequest => {
    const request = requests[index];
    if (request === undefined) {
        throw new Error(`Expected Algolia request at index ${index}.`);
    }
    return request;
};

const batchEntries = (requests: readonly AlgoliaRequest[]): readonly RecordedBatchEntry[] => {
    const batchRequest = requests.find(request => requestPath(request).endsWith('/batch'));
    if (batchRequest === undefined) {
        throw new Error('Expected an Algolia batch request.');
    }
    return requestBody<{requests: readonly RecordedBatchEntry[]}>(batchRequest).requests;
};

const expectCliSuccess = (run: CliRun): void => {
    if (run.result.status !== 0) {
        throw new Error(cliOutput(run.result));
    }
};

describe('CLI Ghost content projection', {timeout: 20000}, () => {
    afterEach(async () => {
        await harness.cleanup();
    });

    it('rejects invalid projection configuration before any network request', async () => {
        const run = await harness.run({
            replayPlan: createReplayPlan([createGhostContent()]),
            config: replayOrigin =>
                createConfig(replayOrigin, {
                    contentProjection: {fields: ['plaintext']}
                })
        });

        expect(run.result.status).not.toBe(0);
        expect(cliOutput(run.result)).toContain(
            'INVALID_POLICY: 1 issue. contentProjection.fields[0]: "plaintext" is not an allowed projection source.'
        );
        expect(run.ghostRequests).toEqual([]);
        expect(run.algoliaRequests).toEqual([]);
    });

    it('uses the default projection without sending a fields parameter', async () => {
        const run = await harness.run({
            replayPlan: createReplayPlan([createGhostContent()], 'tags,authors')
        });

        expectCliSuccess(run);
        expect(run.ghostRequests).toHaveLength(1);
        expect(run.ghostRequests[0]?.query).toEqual({
            key: defaultContentApiKey,
            include: 'tags,authors',
            limit: '100',
            page: '1'
        });
        expect(run.ghostRequests[0]?.query).not.toHaveProperty('fields');
        expect(run.algoliaRequests.map(requestPath)).toEqual([
            'PUT /1/indexes/ghost-content/settings',
            'GET /1/indexes/ghost-content/settings',
            'POST /1/indexes/ghost-content/deleteByQuery',
            'POST /1/indexes/ghost-content/batch'
        ]);

        const [record] = batchEntries(run.algoliaRequests).map(entry => entry.body);
        expect(record).toMatchObject({
            html: '<p>Searchable body.</p>',
            image: 'https://example.com/projected.jpg',
            tags: [{name: 'Projection', slug: 'projection'}],
            authors: [{name: 'Ghost Author', slug: 'ghost-author'}],
            excerpt: 'Default excerpt'
        });
    });

    it('requests exactly the relations enabled by explicit projections and aliases', async () => {
        const cases = [
            {fields: ['excerpt'], include: undefined},
            {fields: [{source: 'tags', as: 'topics'}], include: 'tags'},
            {fields: [{source: 'authors', as: 'writers'}], include: 'authors'},
            {
                fields: [
                    {source: 'tags', as: 'topics'},
                    {source: 'authors', as: 'writers'}
                ],
                include: 'tags,authors'
            }
        ] as const;

        for (const projectionCase of cases) {
            const run = await harness.run({
                replayPlan: createReplayPlan([createGhostContent()], projectionCase.include),
                config: replayOrigin =>
                    createConfig(replayOrigin, {
                        contentProjection: {fields: projectionCase.fields}
                    })
            });

            expectCliSuccess(run);
            expect(run.ghostRequests[0]?.query.include).toBe(projectionCase.include);
            expect(run.ghostRequests[0]?.query).not.toHaveProperty('fields');
        }
    });

    it('preserves aliases, false, zero, empty strings, and ranking siblings', async () => {
        const run = await harness.run({
            replayPlan: createReplayPlan([createGhostContent()], 'tags,authors'),
            config: replayOrigin =>
                createConfig(replayOrigin, {
                    contentProjection: {
                        fields: [
                            {source: 'tags', as: 'topics'},
                            {source: 'authors', as: 'writers'},
                            {source: 'custom_excerpt', as: 'summary'},
                            'featured',
                            'reading_time'
                        ],
                        customRanking: [
                            {source: 'featured', as: 'isFeatured'},
                            {source: 'reading_time', as: 'readingMinutes'}
                        ]
                    }
                })
        });

        expectCliSuccess(run);
        expect(batchEntries(run.algoliaRequests)[0]?.body).toMatchObject({
            topics: [{name: 'Projection', slug: 'projection'}],
            writers: [{name: 'Ghost Author', slug: 'ghost-author'}],
            summary: '',
            featured: false,
            reading_time: 0,
            customRanking: {
                heading: 100,
                position: 0,
                isFeatured: false,
                readingMinutes: 0
            }
        });
    });

    it('preflights the complete fetched batch before any Algolia mutation', async () => {
        const run = await harness.run({
            replayPlan: createReplayPlan([
                createGhostContent(),
                createGhostContent({
                    id: 'invalid-post-id',
                    slug: 'invalid-post',
                    reading_time: 'not-a-number'
                })
            ]),
            config: replayOrigin =>
                createConfig(replayOrigin, {
                    contentProjection: {fields: ['reading_time']}
                })
        });

        expect(run.result.status).not.toBe(0);
        expect(cliOutput(run.result)).toContain('INVALID_GHOST_CONTENT');
        expect(cliOutput(run.result)).toContain('ghostContent[1].reading_time');
        expect(run.ghostRequests).toHaveLength(1);
        expect(run.algoliaRequests).toEqual([]);
    });

    it('makes no Algolia request when an indivisible record exceeds the byte ceiling', async () => {
        const run = await harness.run({
            replayPlan: createReplayPlan([
                createGhostContent({html: `<p>${'x'.repeat(12_000)}</p>`})
            ]),
            config: replayOrigin =>
                createConfig(replayOrigin, {
                    contentProjection: {fields: []}
                })
        });

        expect(run.result.status).not.toBe(0);
        expect(cliOutput(run.result)).toContain('RECORD_TOO_LARGE');
        expect(run.ghostRequests).toHaveLength(1);
        expect(run.algoliaRequests).toEqual([]);
    });

    it('deletes every unique affected non-ignored slug before saving the validated records', async () => {
        const customSettings = {
            distinct: false,
            searchableAttributes: ['title', 'summary']
        };
        const run = await harness.run({
            replayPlan: createReplayPlan([
                createGhostContent(),
                createGhostContent({id: 'second-id'}),
                createGhostContent({id: 'third-id', slug: 'second-post'}),
                createGhostContent({id: 'ignored-id', slug: 'ignored-by-config'})
            ]),
            config: replayOrigin =>
                createConfig(replayOrigin, {
                    contentProjection: {
                        fields: [{source: 'excerpt', as: 'summary'}]
                    },
                    ignore_slugs: ['ignored-by-config'],
                    algolia: {
                        appId: 'acceptance-app',
                        apiKey: 'acceptance-admin-key',
                        index: 'ghost-content',
                        indexSettings: customSettings
                    }
                })
        });

        expectCliSuccess(run);
        const requestPaths = run.algoliaRequests.map(requestPath);
        expect(requestPaths).toEqual([
            'PUT /1/indexes/ghost-content/settings',
            'GET /1/indexes/ghost-content/settings',
            'POST /1/indexes/ghost-content/deleteByQuery',
            'POST /1/indexes/ghost-content/deleteByQuery',
            'POST /1/indexes/ghost-content/batch'
        ]);
        const saveIndex = requestPaths.indexOf('POST /1/indexes/ghost-content/batch');
        const deleteIndexes = requestPaths
            .map((request, index) => ({request, index}))
            .filter(({request}) => request.endsWith('/deleteByQuery'))
            .map(({index}) => index);
        expect(requestPaths.filter(request => request.endsWith('/batch'))).toHaveLength(1);
        expect(deleteIndexes.every(index => index < saveIndex)).toBe(true);
        expect(requestBody(requestAt(run.algoliaRequests, 0))).toEqual(customSettings);
        expect(run.algoliaRequests.slice(2, -1).map(request => requestBody(request))).toEqual([
            {filters: 'slug:projected-post'},
            {filters: 'slug:second-post'}
        ]);
        expect(batchEntries(run.algoliaRequests).map(entry => entry.body.slug)).toEqual([
            'projected-post',
            'projected-post',
            'second-post'
        ]);
        expect(batchEntries(run.algoliaRequests).every(entry => 'summary' in entry.body)).toBe(
            true
        );
    });

    it('replaces stale continuations with one stable record on repeated shrinking runs', async () => {
        const config = (replayOrigin: string): CliConfig =>
            createConfig(replayOrigin, {
                contentProjection: {fields: []}
            });
        const firstRun = await harness.run({
            replayPlan: createReplayPlan([
                createGhostContent({
                    slug: 'shrinking-post',
                    html: `<p>${'a'.repeat(6_000)}</p><p>${'b'.repeat(6_000)}</p>`
                })
            ]),
            config
        });
        const shrinkOptions = {
            replayPlan: createReplayPlan([createGhostContent({slug: 'shrinking-post'})]),
            algoliaStatePath: firstRun.algoliaStatePath,
            config
        } as const;
        const secondRun = await harness.run(shrinkOptions);
        const thirdRun = await harness.run({
            ...shrinkOptions,
            algoliaStatePath: secondRun.algoliaStatePath
        });

        expectCliSuccess(firstRun);
        expect(batchEntries(firstRun.algoliaRequests).map(entry => entry.body.objectID)).toEqual([
            'post-id_0',
            'post-id_0_1'
        ]);
        expect(firstRun.algoliaRecords.map(record => record.objectID)).toEqual([
            'post-id_0',
            'post-id_0_1'
        ]);

        for (const run of [secondRun, thirdRun]) {
            expectCliSuccess(run);
            const paths = run.algoliaRequests.map(requestPath);
            expect(paths.indexOf('POST /1/indexes/ghost-content/deleteByQuery')).toBeLessThan(
                paths.indexOf('POST /1/indexes/ghost-content/batch')
            );
            expect(requestBody(requestAt(run.algoliaRequests, 2))).toEqual({
                filters: 'slug:shrinking-post'
            });
            expect(batchEntries(run.algoliaRequests).map(entry => entry.body.objectID)).toEqual([
                'post-id_0'
            ]);
            expect(run.algoliaRecords.map(record => record.objectID)).toEqual(['post-id_0']);
            expect(run.algoliaRecords.some(record => record.objectID === 'post-id_0_1')).toBe(
                false
            );
        }

        expect(secondRun.algoliaRecords).toEqual(thirdRun.algoliaRecords);
    });
});
