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
const postsPage = JSON.parse(await readFile(path.join(ghostFixtureDirectory, 'posts-page-1.json'), 'utf8')) as {
    posts: Array<Record<string, unknown>>;
};
const expectedRecords = JSON.parse(await readFile(path.join(ghostFixtureDirectory, 'expected-algolia-records.json'), 'utf8')) as Array<Record<string, unknown>>;
const expectedSettings = JSON.parse(await readFile(path.join(ghostFixtureDirectory, 'expected-index-settings.json'), 'utf8')) as Record<string, unknown>;
const richPost = postsPage.posts.find(post => post.slug === 'ghost-6-rendered-content-contract');
const ghostUserAgent = 'Ghost/6.57.1 (https://github.com/TryGhost/Ghost)';
const legacyGhostUserAgent = 'Ghost(https://github.com/TryGhost/Ghost)';
const environmentKeys = ['ALGOLIA_ACTIVE', 'ALGOLIA_APP_ID', 'ALGOLIA_API_KEY', 'ALGOLIA_INDEX', 'NETLIFY_KEY'] as const;
const savedEnvironment = Object.fromEntries(environmentKeys.map(key => [key, process.env[key]]));

const invoke = async (name: 'post-published' | 'post-unpublished', options: {
    body?: unknown;
    rawBody?: string;
    query?: string;
    userAgent?: string;
    active?: string;
    failureAt?: number;
} = {}): Promise<{response: Invocation; requests: AlgoliaRequest[]}> => {
    const headers: Record<string, string> = {'content-type': 'application/json'};
    if (options.userAgent !== '') {
        headers['user-agent'] = options.userAgent ?? ghostUserAgent;
    }
    const body = options.rawBody ?? JSON.stringify(options.body ?? {post: {current: richPost, previous: {}}});
    process.env.ALGOLIA_ACTIVE = options.active ?? 'TRUE';
    process.env.ALGOLIA_APP_ID = 'acceptance-app';
    process.env.ALGOLIA_API_KEY = 'acceptance-admin-key';
    process.env.ALGOLIA_INDEX = 'ghost-content';
    process.env.NETLIFY_KEY = 'acceptance-webhook-key';
    requesterMock.reset(options.failureAt);

    const handler = name === 'post-published' ? postPublished : postUnpublished;
    let response: Invocation;
    try {
        const result = await handler(new Request(
            `https://algolia.example.invalid/.netlify/functions/${name}${options.query ?? '?key=acceptance-webhook-key'}`,
            {method: 'POST', headers, body}
        ));
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
        const response = await handler(new Request(`https://example.invalid/.netlify/functions/${name}`));
        expect(response).toBeInstanceOf(Response);
        expect(response.status).toBe(200);
        await expect(response.text()).resolves.toBe('Algolia is not activated');
    });

    it.each([
        ['post-published', {post: {current: richPost, previous: {title: 'Old title'}}}],
        ['post-published', {post: {current: richPost, previous: richPost}}]
    ] as const)('indexes the current Ghost 6 resource for %s', async (name, body) => {
        const {response, requests} = await invoke(name, {body});
        expectTextResponse(response, 200, 'Post "Ghost 6 rendered content contract" has been added to the index.');
        expect(requests.map(request => [request.method, new URL(request.url).pathname])).toEqual([
            ['PUT', '/1/indexes/ghost-content/settings'],
            ['GET', '/1/indexes/ghost-content/settings'],
            ['POST', '/1/indexes/ghost-content/batch']
        ]);
        expect(JSON.parse(requests[0].data ?? '')).toEqual(expectedSettings);
        const batch = JSON.parse(requests[2].data ?? '') as {requests: Array<{action: string; body: Record<string, unknown>}>};
        expect(batch.requests).toEqual(expectedRecords.slice(0, 2).map(record => ({action: 'updateObject', body: record})));
    });

    it.each([
        ['current', {post: {current: richPost, previous: {slug: 'previous-slug'}}}],
        ['previous', {post: {current: {}, previous: richPost}}]
    ] as const)('deletes the %s Ghost resource', async (_selection, body) => {
        const {response, requests} = await invoke('post-unpublished', {body});
        expectTextResponse(response, 200, 'Post "ghost-6-rendered-content-contract" has been removed from the index.');
        expect(requests).toHaveLength(1);
        expect(requests[0].method).toBe('POST');
        expect(new URL(requests[0].url).pathname).toBe('/1/indexes/ghost-content/deleteByQuery');
        expect(JSON.parse(requests[0].data ?? '')).toEqual({filters: 'slug:ghost-6-rendered-content-contract'});
    });

    it.each([
        ['missing', ''],
        ['empty', '?key='],
        ['correct', '?key=acceptance-webhook-key']
    ])('accepts a %s key under the existing optional-key contract', async (_case, query) => {
        const {response, requests} = await invoke('post-unpublished', {query});
        expect(response.status).toBe(200);
        expect(requests).toHaveLength(1);
    });

    it.each([
        ['wrong', '?key=wrong'],
        ['duplicate', '?key=acceptance-webhook-key&key=acceptance-webhook-key'],
        ['duplicate empty', '?key=&key=']
    ])('rejects a %s key before activation and body parsing', async (_case, query) => {
        const {response, requests} = await invoke('post-published', {query, active: 'FALSE', rawBody: '{'});
        expectTextResponse(response, 401, 'Unauthorized');
        expect(requests).toEqual([]);
    });

    it('returns before user-agent and body validation when disabled', async () => {
        const {response, requests} = await invoke('post-published', {active: 'FALSE', userAgent: '', rawBody: '{'});
        expectTextResponse(response, 200, 'Algolia is not activated');
        expect(requests).toEqual([]);
    });

    it.each([
        ghostUserAgent,
        legacyGhostUserAgent,
        'Ghost/6.57.1-beta.2+build.4 (https://github.com/TryGhost/Ghost)'
    ])('accepts the complete Ghost user-agent: %s', async (userAgent) => {
        const {response} = await invoke('post-unpublished', {userAgent});
        expect(response.status).toBe(200);
    });

    describe.each(['post-published', 'post-unpublished'] as const)('%s user-agent validation', (name) => {
        it.each([
            '',
            'curl/8.0',
            `prefix ${ghostUserAgent}`,
            `${ghostUserAgent} suffix`,
            'Ghostish(https://github.com/TryGhost/Ghost)',
            'Ghost/6.57.1(https://github.com/TryGhost/Ghost)',
            'Ghost/latest (https://github.com/TryGhost/Ghost)',
            'https://github.com/TryGhost/Ghost'
        ])('rejects an incomplete or non-Ghost user-agent %j', async (userAgent) => {
            const {response, requests} = await invoke(name, {userAgent});
            expectTextResponse(response, 401, 'Unauthorized');
            expect(requests).toEqual([]);
        });
    });

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
            body: JSON.stringify({msg: 'post.tags.forEach is not a function'})
        });
        expect(requests).toEqual([]);
    });

    it.each([
        ['post-published', 1],
        ['post-published', 2],
        ['post-published', 3],
        ['post-unpublished', 1]
    ] as const)('returns JSON when Algolia request fails for %s at request %i', async (name, failureAt) => {
        const {response} = await invoke(name, {failureAt});
        expect(response.status).toBe(500);
        expect(response.headers).toEqual({'content-type': 'application/json'});
        expect(JSON.parse(response.body ?? '')).toEqual({msg: 'Algolia transport failed'});
    });
});
