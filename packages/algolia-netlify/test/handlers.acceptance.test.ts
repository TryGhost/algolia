import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it} from 'vitest';

type AlgoliaRequest = {
    method: string;
    url: string;
    headers: Record<string, string>;
    data?: string;
};

type Invocation = {
    status?: number;
    headers?: Record<string, string>;
    body?: string;
    rejected?: {name: string; message: string};
};

type RequesterMock = {
    install(): void;
    restore(): void;
    reset(_failureAt?: number): void;
    requests(): AlgoliaRequest[];
};

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageDirectory = path.resolve(testDirectory, '..');
const ghostFixtureDirectory = path.resolve(packageDirectory, '../algolia/test/fixtures/ghost-v6');
const require = createRequire(import.meta.url);
const requesterMock = require('./helpers/algolia-requester-register.cjs') as RequesterMock;
requesterMock.install();
const [publishedModule, unpublishedModule] = await Promise.all([
    import('../functions/post-published.mts'),
    import('../functions/post-unpublished.mts')
]).finally(() => requesterMock.restore());
const postPublished = publishedModule.default;
const postUnpublished = unpublishedModule.default;
const postsPage = JSON.parse(
    await readFile(path.join(ghostFixtureDirectory, 'posts-page-1.json'), 'utf8')
) as {
    posts: Array<Record<string, unknown>>;
};
const expectedRecords = JSON.parse(
    await readFile(path.join(ghostFixtureDirectory, 'expected-algolia-records.json'), 'utf8')
) as Array<Record<string, unknown>>;
const richPost = postsPage.posts.find(post => post.slug === 'ghost-6-rendered-content-contract');
const ghostUserAgent = 'Ghost/6.57.1 (https://github.com/TryGhost/Ghost)';
const legacyGhostUserAgent = 'Ghost(https://github.com/TryGhost/Ghost)';
const environmentKeys = [
    'ALGOLIA_ACTIVE',
    'ALGOLIA_APP_ID',
    'ALGOLIA_API_KEY',
    'ALGOLIA_INDEX',
    'ALGOLIA_CONTENT_PROJECTION',
    'NETLIFY_KEY'
] as const;
const savedEnvironment = Object.fromEntries(environmentKeys.map(key => [key, process.env[key]]));

const invoke = async (
    name: 'post-published' | 'post-unpublished',
    options: {
        body?: unknown;
        rawBody?: string;
        query?: string;
        userAgent?: string;
        active?: string;
        failureAt?: number;
        netlifyKey?: string | null;
    } = {}
): Promise<{response: Invocation; requests: AlgoliaRequest[]}> => {
    const headers: Record<string, string> = {'content-type': 'application/json'};
    if (options.userAgent !== '') {
        headers['user-agent'] = options.userAgent ?? ghostUserAgent;
    }
    const body =
        options.rawBody ??
        JSON.stringify(options.body ?? {post: {current: richPost, previous: {}}});
    process.env.ALGOLIA_ACTIVE = options.active ?? 'TRUE';
    process.env.ALGOLIA_APP_ID = 'acceptance-app';
    process.env.ALGOLIA_API_KEY = 'acceptance-admin-key';
    process.env.ALGOLIA_INDEX = 'ghost-content';
    if (options.netlifyKey === null) {
        delete process.env.NETLIFY_KEY;
    } else {
        process.env.NETLIFY_KEY = options.netlifyKey ?? 'acceptance-webhook-key';
    }
    requesterMock.reset(options.failureAt);

    const handler = name === 'post-published' ? postPublished : postUnpublished;
    let response: Invocation;
    try {
        const result = await handler(
            new Request(
                `https://algolia.example.invalid/.netlify/functions/${name}${options.query ?? '?key=acceptance-webhook-key'}`,
                {method: 'POST', headers, body}
            )
        );
        response = {
            status: result.status,
            headers: Object.fromEntries(result.headers),
            body: await result.text()
        };
    } catch (error) {
        response = {
            rejected: {
                name: error instanceof Error ? error.name : 'Error',
                message: error instanceof Error ? error.message : String(error)
            }
        };
    }

    return {
        response,
        requests: requesterMock.requests()
    };
};

const expectTextResponse = (response: Invocation, status: number, body: string) => {
    expect(response).toEqual({
        status,
        headers: {'content-type': 'text/plain; charset=utf-8'},
        body
    });
};

describe('modern Netlify webhook handlers', () => {
    beforeAll(() => {
        requesterMock.install();
    });

    afterAll(() => {
        requesterMock.restore();
    });

    beforeEach(() => {
        requesterMock.reset();
        delete process.env.ALGOLIA_CONTENT_PROJECTION;
    });

    afterEach(() => {
        for (const key of environmentKeys) {
            const value = savedEnvironment[key];
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    });

    it.each([
        ['post-published', postPublished],
        ['post-unpublished', postUnpublished]
    ] as const)('uses the native Request/Response seam for %s', async (name, handler) => {
        process.env.ALGOLIA_ACTIVE = 'FALSE';
        process.env.NETLIFY_KEY = 'acceptance-webhook-key';
        const response = await handler(
            new Request(
                `https://example.invalid/.netlify/functions/${name}?key=acceptance-webhook-key`
            )
        );
        expect(response).toBeInstanceOf(Response);
        expect(response.status).toBe(200);
        await expect(response.text()).resolves.toBe('Algolia is not activated');
    });

    it.each([
        ['post-published', {post: {current: richPost, previous: {title: 'Old title'}}}],
        ['post-published', {post: {current: richPost, previous: richPost}}]
    ] as const)('indexes the current Ghost 6 resource for %s', async (name, body) => {
        const {response, requests} = await invoke(name, {body});
        expectTextResponse(
            response,
            200,
            'Post "Ghost 6 rendered content contract" has been added to the index.'
        );
        expect(requests.map(request => [request.method, new URL(request.url).pathname])).toEqual([
            ['POST', '/1/indexes/ghost-content/batch']
        ]);
        const batch = JSON.parse(requests[0].data ?? '') as {
            requests: Array<{action: string; body: Record<string, unknown>}>;
        };
        expect(batch.requests).toEqual(
            expectedRecords.slice(0, 2).map(record => ({
                action: 'addObject',
                body: {...record, excerpt: richPost?.excerpt}
            }))
        );
    });

    it('saves default records without new permissions or settings', async () => {
        const {response, requests} = await invoke('post-published', {
            body: {post: {current: {...richPost, excerpt: 'A display summary'}, previous: {}}}
        });
        expect(response.status).toBe(200);
        expect(requests.map(request => [request.method, new URL(request.url).pathname])).toEqual([
            ['POST', '/1/indexes/ghost-content/batch']
        ]);
        expect(JSON.parse(requests[0].data ?? '')).toEqual({
            requests: expectedRecords.slice(0, 2).map(record => ({
                action: 'addObject',
                body: {...record, excerpt: 'A display summary'}
            }))
        });
    });

    it('attempts only upserts when saving fails with unchanged configuration', async () => {
        const {response, requests} = await invoke('post-published', {failureAt: 1});
        expect(response.status).toBe(500);
        expect(JSON.parse(response.body ?? '')).toEqual({msg: 'Algolia transport failed'});
        expect(requests.map(request => [request.method, new URL(request.url).pathname])).toEqual([
            ['POST', '/1/indexes/ghost-content/batch']
        ]);
        expect(JSON.parse(requests[0].data ?? '')).toEqual({
            requests: expectedRecords.slice(0, 2).map(record => ({
                action: 'addObject',
                body: {...record, excerpt: richPost?.excerpt}
            }))
        });
    });

    it('projects aliases and ranking siblings from the current resource', async () => {
        process.env.ALGOLIA_CONTENT_PROJECTION = JSON.stringify({
            fields: [{source: 'excerpt', as: 'summary'}, 'featured', 'reading_time'],
            customRanking: [{source: 'featured', as: 'promoted'}]
        });
        const {response, requests} = await invoke('post-published', {
            body: {post: {current: {...richPost, excerpt: '', featured: false, reading_time: 0}}}
        });
        expect(response.status).toBe(200);
        expect(JSON.parse(requests.at(-1)?.data ?? '')).toEqual({
            requests: expectedRecords
                .slice(0, 2)
                .map(({image: _image, tags: _tags, authors: _authors, ...record}) => ({
                    action: 'addObject',
                    body: {
                        ...record,
                        summary: '',
                        featured: false,
                        reading_time: 0,
                        customRanking: {
                            ...(record.customRanking as Record<string, unknown>),
                            promoted: false
                        }
                    }
                }))
        });
    });

    it.each(['post-published', 'post-unpublished'] as const)(
        'rejects invalid projection before mutation in %s',
        async name => {
            process.env.ALGOLIA_CONTENT_PROJECTION = JSON.stringify({fields: ['slug']});
            const {response, requests} = await invoke(name);
            expect(response.status).toBe(500);
            expect(response.headers).toEqual({'content-type': 'application/json'});
            expect(JSON.parse(response.body ?? '').msg).toMatch(/^INVALID_POLICY:/);
            expect(requests).toEqual([]);
        }
    );

    it.each(['post-published', 'post-unpublished'] as const)(
        'rejects malformed projection JSON without exposing it in %s',
        async name => {
            process.env.ALGOLIA_CONTENT_PROJECTION = 'private-configuration-value';
            const {response, requests} = await invoke(name);
            expect(response).toEqual({
                status: 500,
                headers: {'content-type': 'application/json'},
                body: JSON.stringify({msg: 'ALGOLIA_CONTENT_PROJECTION must contain valid JSON.'})
            });
            expect(requests).toEqual([]);
        }
    );

    it('saves a complete default fallback record when the current resource has no fragments', async () => {
        const {response, requests} = await invoke('post-published', {
            body: {
                post: {
                    current: {
                        id: 'empty',
                        slug: 'empty',
                        title: 'Empty',
                        url: 'https://example.com/empty/',
                        html: ''
                    }
                }
            }
        });
        expect(response.status).toBe(200);
        expect(JSON.parse(requests[0].data ?? '')).toEqual({
            requests: [
                {
                    action: 'addObject',
                    body: {
                        objectID: 'empty_0',
                        slug: 'empty',
                        title: 'Empty',
                        url: 'https://example.com/empty/',
                        html: '',
                        headings: [],
                        anchor: null,
                        image: null,
                        tags: [],
                        authors: [],
                        excerpt: null,
                        customRanking: {position: 0, heading: 100}
                    }
                }
            ]
        });
    });

    it.each([
        ['indivisible fragment', {html: `<p>${'é'.repeat(6000)}</p>`}],
        ['repeated metadata', {title: 'x'.repeat(10000)}],
        ['invalid required content', {html: null}]
    ])('preflights %s before writing any records', async (_case, overrides) => {
        const {response, requests} = await invoke('post-published', {
            body: {post: {current: {...richPost, ...overrides}}}
        });
        expect(response.status).toBe(500);
        expect(JSON.parse(response.body ?? '').msg).toMatch(
            /^(RECORD_TOO_LARGE|INVALID_GHOST_CONTENT):/
        );
        expect(requests).toEqual([]);
    });

    it('upserts shrinking content without deleting earlier continuations', async () => {
        const longParagraph = `<p>${'a'.repeat(6000)}</p>`;
        const large = {...richPost, html: `${longParagraph}${longParagraph}`, excerpt: 'Summary'};
        const first = await invoke('post-published', {body: {post: {current: large}}});
        expect(first.response.status).toBe(200);
        const initial = JSON.parse(first.requests[0].data ?? '').requests as Array<{
            body: Record<string, unknown>;
        }>;
        expect(initial.map(({body}) => ({id: body.objectID, html: body.html}))).toEqual([
            {id: '6a7d75c8b25e8a000197c521_0', html: longParagraph},
            {id: '6a7d75c8b25e8a000197c521_0_1', html: longParagraph}
        ]);
        for (const {body} of initial) {
            expect(Buffer.byteLength(JSON.stringify(body), 'utf8')).toBeLessThanOrEqual(9999);
        }
        const shrunk = await invoke('post-published', {
            body: {post: {current: {...large, html: '<p>Short</p>'}}}
        });
        expect(shrunk.response.status).toBe(200);
        expect(
            shrunk.requests.map(request => [
                new URL(request.url).pathname,
                JSON.parse(request.data ?? '')
            ])
        ).toEqual([
            [
                '/1/indexes/ghost-content/batch',
                {
                    requests: [
                        {
                            action: 'addObject',
                            body: {
                                ...initial[0].body,
                                html: '<p>Short</p>'
                            }
                        }
                    ]
                }
            ]
        ]);
    });

    it.each([
        ['current', {post: {current: richPost, previous: {slug: 'previous-slug'}}}],
        ['previous', {post: {current: {}, previous: richPost}}]
    ] as const)('deletes the %s Ghost resource', async (_selection, body) => {
        const {response, requests} = await invoke('post-unpublished', {body});
        expectTextResponse(
            response,
            200,
            'Post "ghost-6-rendered-content-contract" has been removed from the index.'
        );
        expect(requests).toHaveLength(1);
        expect(requests[0].method).toBe('POST');
        expect(new URL(requests[0].url).pathname).toBe('/1/indexes/ghost-content/deleteByQuery');
    });

    describe.each(['post-published', 'post-unpublished'] as const)('%s authorization', name => {
        it.each([
            ['wrong', '?key=wrong'],
            ['duplicate', '?key=acceptance-webhook-key&key=acceptance-webhook-key'],
            ['duplicate empty', '?key=&key=']
        ])('rejects a %s key before activation and body parsing', async (_case, query) => {
            const {response, requests} = await invoke(name, {
                query,
                active: 'FALSE',
                rawBody: '{'
            });
            expectTextResponse(response, 401, 'Unauthorized');
            expect(requests).toEqual([]);
        });

        it.each([
            ['missing query with configured secret', '', 'acceptance-webhook-key'],
            ['empty query with configured secret', '?key=', 'acceptance-webhook-key'],
            ['correct query', '?key=acceptance-webhook-key', 'acceptance-webhook-key'],
            ['missing query without configured secret', '', null],
            ['empty query without configured secret', '?key=', null],
            ['missing query with empty configured secret', '', '']
        ] as const)('preserves legacy indexing with %s', async (_case, query, netlifyKey) => {
            const {response, requests} = await invoke(name, {query, netlifyKey});
            expect(response.status).toBe(200);
            expect(
                requests.map(request => [request.method, new URL(request.url).pathname])
            ).toEqual([
                [
                    'POST',
                    name === 'post-published'
                        ? '/1/indexes/ghost-content/batch'
                        : '/1/indexes/ghost-content/deleteByQuery'
                ]
            ]);
        });
    });

    it('returns before user-agent and body validation when disabled', async () => {
        const {response, requests} = await invoke('post-published', {
            active: 'FALSE',
            userAgent: '',
            rawBody: '{'
        });
        expectTextResponse(response, 200, 'Algolia is not activated');
        expect(requests).toEqual([]);
    });

    it.each([
        ghostUserAgent,
        legacyGhostUserAgent,
        'Ghost/6.57.1-beta.2+build.4 (https://github.com/TryGhost/Ghost)'
    ])('accepts the complete Ghost user-agent: %s', async userAgent => {
        const {response} = await invoke('post-unpublished', {userAgent});
        expect(response.status).toBe(200);
    });

    describe.each(['post-published', 'post-unpublished'] as const)(
        '%s user-agent validation',
        name => {
            it.each([
                '',
                'curl/8.0',
                `prefix ${ghostUserAgent}`,
                `${ghostUserAgent} suffix`,
                'Ghostish(https://github.com/TryGhost/Ghost)',
                'Ghost/6.57.1(https://github.com/TryGhost/Ghost)',
                'Ghost/latest (https://github.com/TryGhost/Ghost)',
                'https://github.com/TryGhost/Ghost'
            ])('rejects an incomplete or non-Ghost user-agent %j', async userAgent => {
                const {response, requests} = await invoke(name, {userAgent});
                expectTextResponse(response, 401, 'Unauthorized');
                expect(requests).toEqual([]);
            });
        }
    );

    it.each([
        ['empty', ''],
        ['malformed', '{'],
        ['JSON null', 'null'],
        ['JSON array', '[]'],
        ['missing post', '{}'],
        ['non-object post', '{"post":null}']
    ])('returns a stable 400 for %s request bodies', async (_case, rawBody) => {
        const {response, requests} = await invoke('post-published', {rawBody});
        expectTextResponse(response, 400, 'Invalid request body');
        expect(requests).toEqual([]);
    });

    it.each([
        ['post-published', {post: {current: {}, previous: richPost}}],
        ['post-unpublished', {post: {current: {}, previous: {title: 'No slug'}}}]
    ] as const)('returns the stable no-resource response from %s', async (name, body) => {
        const {response, requests} = await invoke(name, {body});
        expectTextResponse(response, 200, 'No valid request body detected');
        expect(requests).toEqual([]);
    });

    it('returns controlled JSON when transformation fails', async () => {
        const invalidContent = {...richPost, tags: {length: 1}};
        const {response, requests} = await invoke('post-published', {
            body: {post: {current: invalidContent, previous: {}}}
        });
        expect(response).toEqual({
            status: 500,
            headers: {'content-type': 'application/json'},
            body: expect.stringContaining('INVALID_GHOST_CONTENT:')
        });
        expect(requests).toEqual([]);
    });

    it.each([
        ['post-published', 1],
        ['post-unpublished', 1]
    ] as const)(
        'returns JSON when Algolia request fails for %s at request %i',
        async (name, failureAt) => {
            const {response, requests} = await invoke(name, {failureAt});
            expect(requests.map(request => new URL(request.url).pathname)).toEqual(
                name === 'post-published'
                    ? ['/1/indexes/ghost-content/batch']
                    : ['/1/indexes/ghost-content/deleteByQuery']
            );
            expect(response.status).toBe(500);
            expect(response.headers).toEqual({'content-type': 'application/json'});
            expect(JSON.parse(response.body ?? '')).toEqual({msg: 'Algolia transport failed'});
        }
    );
});
