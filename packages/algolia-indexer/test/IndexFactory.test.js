import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';
import {createRequire} from 'node:module';
import http from 'node:http';
import https from 'node:https';
import Module from 'node:module';
import net from 'node:net';
import tls from 'node:tls';

const require = createRequire(import.meta.url);
const requester = require('./helpers/algolia-requester-register.js');
const packageEntryPath = require.resolve('../index.js');
const indexFactoryPath = require.resolve('../lib/IndexFactory.js');
const algoliaSearchPath = require.resolve('algoliasearch');
const dependencyMarker = `${require.resolve('@algolia/requester-node-http').split('/@algolia/')[0]}/@algolia/`;
const algoliaSearchMarker = `${algoliaSearchPath.slice(0, algoliaSearchPath.lastIndexOf('/'))}/`;

const isSubjectCacheEntry = filename => {
    return (
        filename === packageEntryPath ||
        filename === indexFactoryPath ||
        filename.startsWith(dependencyMarker) ||
        filename.startsWith(algoliaSearchMarker)
    );
};

const originalCacheEntries = new Map(
    Object.entries(require.cache).filter(([filename]) => isSubjectCacheEntry(filename))
);

const restoreSubjectCache = () => {
    for (const filename of Object.keys(require.cache).filter(isSubjectCacheEntry)) {
        delete require.cache[filename];
    }
    for (const [filename, cacheEntry] of originalCacheEntries) {
        require.cache[filename] = cacheEntry;
    }
};

const clearSubjectCache = () => {
    for (const filename of Object.keys(require.cache).filter(isSubjectCacheEntry)) {
        delete require.cache[filename];
    }
};

let IndexFactory;

const loadSubject = (load = () => require('../index.js')) => {
    requester.install();
    clearSubjectCache();
    try {
        IndexFactory = load();
    } catch (error) {
        restoreSubjectCache();
        requester.restore();
        throw error;
    }
};

const expectOriginalCacheIdentities = () => {
    const restoredEntries = new Map(
        Object.entries(require.cache).filter(([filename]) => isSubjectCacheEntry(filename))
    );
    expect([...restoredEntries.keys()]).toEqual([...originalCacheEntries.keys()]);
    for (const [filename, cacheEntry] of originalCacheEntries) {
        expect(restoredEntries.get(filename)).toBe(cacheEntry);
    }
};

const REQUIRED_SETTINGS = {
    distinct: true,
    attributeForDistinct: 'slug',
    customRanking: ['desc(customRanking.heading)', 'asc(customRanking.position)'],
    searchableAttributes: [
        'title',
        'headings',
        'html',
        'url',
        'tags.name',
        'tags',
        'authors.name',
        'authors'
    ],
    attributesForFaceting: ['filterOnly(slug)']
};

const ALGOLIA_OPTIONS = {
    appId: 'app-id',
    apiKey: 'admin-api-key',
    index: 'help-center'
};

const createIndexer = (overrides = {}) => {
    return new IndexFactory({...ALGOLIA_OPTIONS, ...overrides});
};

const normalizeRequest = request => {
    const url = new URL(request.url);
    // algoliasearch 5.57+ stamps every request with a randomly generated request-id header,
    // so it cannot be part of a deterministic request contract.
    const headers = {...request.headers};
    delete headers['request-id'];
    return {
        method: request.method,
        origin: url.origin,
        pathname: url.pathname,
        headers,
        body: request.data ? JSON.parse(request.data) : undefined
    };
};

const exactMappedError = error => ({
    name: error.name,
    message: error.message,
    errorType: error.errorType,
    code: error.code,
    status: error.status,
    originalError: {
        name: error.originalError.name,
        message: error.originalError.message,
        attempts: error.originalError.stackTrace.map(({request, response}) => ({
            method: request.method,
            pathname: new URL(request.url).pathname,
            body: request.data ? JSON.parse(request.data) : undefined,
            response: {
                status: response.status,
                content: response.content,
                isTimedOut: response.isTimedOut
            }
        }))
    },
    enumerableFields: Object.keys(error).sort()
});

const assertMappedOperationError = async (invoke, expectedAttempt) => {
    const indexer = createIndexer();
    await indexer.initIndex();
    requester.reset({status: 503, message: 'Algolia is unavailable'});

    let error;
    try {
        await invoke(indexer);
    } catch (operationError) {
        error = operationError;
    }

    const mappedError = exactMappedError(error);
    expect(mappedError.message).toBe(mappedError.originalError.message);
    expect(mappedError.message).toMatch(
        /^Unreachable hosts - your application id may be incorrect\./
    );
    expect(mappedError).toEqual({
        name: 'Error',
        message: mappedError.originalError.message,
        errorType: 'AlgoliaError',
        code: undefined,
        status: undefined,
        originalError: {
            name: 'RetryError',
            message: mappedError.originalError.message,
            attempts: Array(4).fill({
                ...expectedAttempt,
                response: {
                    status: 503,
                    content: '{"message":"Algolia is unavailable"}',
                    isTimedOut: false
                }
            })
        },
        enumerableFields: ['code', 'errorType', 'originalError']
    });
};

describe('IndexFactory public contracts', function () {
    beforeAll(function () {
        loadSubject();
    });

    afterAll(function () {
        restoreSubjectCache();
        requester.restore();
    });

    beforeEach(function () {
        requester.reset();
    });

    it('requires an application ID, API key, and index name', function () {
        expect(() => new IndexFactory()).toThrow('Algolia appId, apiKey, and index is required!');
    });

    it('denies bypass network access and restores every hook and cache identity', function () {
        const originals = requester.originals();
        expect(() => http.request('http://example.com')).toThrow(
            'denied an unexpected network request'
        );
        expect(() => https.get('https://example.com')).toThrow(
            'denied an unexpected network request'
        );
        expect(() => net.connect(443, 'example.com')).toThrow(
            'denied an unexpected network request'
        );
        expect(() => tls.connect(443, 'example.com')).toThrow(
            'denied an unexpected network request'
        );
        expect(() => global.fetch('https://example.com')).toThrow(
            'denied an unexpected network request'
        );

        try {
            restoreSubjectCache();
            requester.restore();

            expect(Module._load).toBe(originals.load);
            expect(http.request).toBe(originals.httpRequest);
            expect(http.get).toBe(originals.httpGet);
            expect(https.request).toBe(originals.httpsRequest);
            expect(https.get).toBe(originals.httpsGet);
            expect(net.connect).toBe(originals.netConnect);
            expect(net.createConnection).toBe(originals.netCreateConnection);
            expect(net.Socket.prototype.connect).toBe(originals.socketConnect);
            expect(tls.connect).toBe(originals.tlsConnect);
            expect(global.fetch).toBe(originals.fetch);
            expectOriginalCacheIdentities();
        } finally {
            loadSubject();
        }
    });

    it('restores hooks and cache identities when subject loading fails', function () {
        const originals = requester.originals();

        try {
            expect(() =>
                loadSubject(() => {
                    throw new Error('synthetic subject import failure');
                })
            ).toThrow('synthetic subject import failure');

            expect(Module._load).toBe(originals.load);
            expect(http.request).toBe(originals.httpRequest);
            expect(https.request).toBe(originals.httpsRequest);
            expect(net.connect).toBe(originals.netConnect);
            expect(tls.connect).toBe(originals.tlsConnect);
            expect(global.fetch).toBe(originals.fetch);
            expectOriginalCacheIdentities();
        } finally {
            loadSubject();
        }
    });

    it('initializes the exact external application and index', async function () {
        const indexer = createIndexer();

        indexer.initClient();
        await indexer.initIndex();
        await indexer.index.getSettings();

        expect(requester.requests().map(normalizeRequest)).toEqual([
            {
                method: 'GET',
                origin: 'https://app-id-dsn.algolia.net',
                pathname: '/1/indexes/help-center/settings',
                headers: {
                    accept: 'application/json',
                    'content-type': 'text/plain',
                    'x-algolia-api-key': 'admin-api-key',
                    'x-algolia-application-id': 'app-id'
                },
                body: undefined
            }
        ]);
    });

    it('applies the required settings by default and returns the external settings', async function () {
        const settings = await createIndexer().setSettingsForIndex();

        expect({requests: requester.requests().map(normalizeRequest), settings}).toEqual({
            requests: [
                {
                    method: 'PUT',
                    origin: 'https://app-id.algolia.net',
                    pathname: '/1/indexes/help-center/settings',
                    headers: {
                        accept: 'application/json',
                        'content-type': 'text/plain',
                        'x-algolia-api-key': 'admin-api-key',
                        'x-algolia-application-id': 'app-id'
                    },
                    body: REQUIRED_SETTINGS
                },
                {
                    method: 'GET',
                    origin: 'https://app-id-dsn.algolia.net',
                    pathname: '/1/indexes/help-center/settings',
                    headers: {
                        accept: 'application/json',
                        'content-type': 'text/plain',
                        'x-algolia-api-key': 'admin-api-key',
                        'x-algolia-application-id': 'app-id'
                    },
                    body: undefined
                }
            ],
            settings: {distinct: true}
        });
    });

    it('applies custom settings when updates are explicitly enabled', async function () {
        const customSettings = {searchableAttributes: ['title', 'html']};

        await createIndexer({indexSettings: customSettings}).setSettingsForIndex({
            updateSettings: true
        });

        expect(
            requester
                .requests()
                .map(normalizeRequest)
                .map(({method, pathname, body}) => ({method, pathname, body}))
        ).toEqual([
            {method: 'PUT', pathname: '/1/indexes/help-center/settings', body: customSettings},
            {method: 'GET', pathname: '/1/indexes/help-center/settings', body: undefined}
        ]);
    });

    it('reads settings without applying them when updates are explicitly disabled', async function () {
        const settings = await createIndexer().setSettingsForIndex({updateSettings: false});

        expect({requests: requester.requests().map(normalizeRequest), settings}).toEqual({
            requests: [
                {
                    method: 'GET',
                    origin: 'https://app-id-dsn.algolia.net',
                    pathname: '/1/indexes/help-center/settings',
                    headers: {
                        accept: 'application/json',
                        'content-type': 'text/plain',
                        'x-algolia-api-key': 'admin-api-key',
                        'x-algolia-application-id': 'app-id'
                    },
                    body: undefined
                }
            ],
            settings: {distinct: true}
        });
    });

    it('prepares an existing index without replacing its settings', async function () {
        expect(await createIndexer().prepareIndex()).toEqual({distinct: true});
        expect(
            requester
                .requests()
                .map(normalizeRequest)
                .map(({method}) => method)
        ).toEqual(['GET']);
    });

    it('initializes defaults only for a missing index and honors explicit settings', async function () {
        requester.reset(request =>
            new URL(request.url).pathname.endsWith('/settings') && request.method === 'GET'
                ? {status: 404, content: {message: 'Missing index'}}
                : undefined
        );
        await createIndexer().prepareIndex();
        expect(
            requester
                .requests()
                .map(normalizeRequest)
                .map(({method, body}) => ({method, body}))
        ).toEqual([
            {method: 'GET', body: undefined},
            {method: 'PUT', body: REQUIRED_SETTINGS},
            {method: 'GET', body: undefined}
        ]);
        requester.reset();
        await createIndexer({indexSettings: {distinct: false}}).prepareIndex();
        expect(requester.requests().map(normalizeRequest)[0]).toMatchObject({
            method: 'PUT',
            body: {distinct: false}
        });
        requester.reset({status: 403, message: 'Forbidden'});
        await expect(createIndexer().prepareIndex()).rejects.toMatchObject({status: 403});
        expect(
            requester
                .requests()
                .map(normalizeRequest)
                .map(({method}) => method)
        ).toEqual(['GET']);
    });

    it('confirms replacement saves before deleting only stale fragments across browse pages', async function () {
        requester.reset(request => {
            if (!new URL(request.url).pathname.endsWith('/browse')) {
                return;
            }
            const body = JSON.parse(request.data);
            return {
                status: 200,
                content: body.cursor
                    ? {
                          hits: [
                              {objectID: 'post-1_1_1', slug: 'first'},
                              {objectID: 'post-1_2', slug: 'other'},
                              {objectID: 'post-1_custom', slug: 'first'},
                              {objectID: 'post-1_0_0', slug: 'first'},
                              {objectID: 'post-1_01', slug: 'first'},
                              {objectID: 'post-1_0_01', slug: 'first'},
                              {objectID: 'post-10_0', slug: 'first'}
                          ]
                      }
                    : {
                          hits: [
                              {objectID: 'post-1_0', slug: 'first'},
                              {objectID: 'post-1_1', slug: 'first'}
                          ],
                          cursor: 'next'
                      }
            };
        });
        const indexer = createIndexer();
        await indexer.initIndex();
        expect(
            await indexer.replace(
                [{objectID: 'post-1_0', slug: 'first'}],
                [{id: 'post-1', slug: 'first'}]
            )
        ).toEqual({cleanupSkipped: false});
        const requests = requester.requests().map(normalizeRequest);
        expect(requests.map(({pathname}) => pathname)).toEqual([
            '/1/indexes/help-center/browse',
            '/1/indexes/help-center/browse',
            '/1/indexes/help-center/batch',
            '/1/indexes/help-center/task/3',
            '/1/indexes/help-center/batch',
            '/1/indexes/help-center/task/5'
        ]);
        expect(requests[0].body).toMatchObject({attributesToRetrieve: ['objectID', 'slug']});
        expect(requests[4].body.requests).toEqual([
            {action: 'deleteObject', body: {objectID: 'post-1_1'}},
            {action: 'deleteObject', body: {objectID: 'post-1_1_1'}}
        ]);
    });

    it.each([403, 404])('safely upserts when browse returns %s', async function (status) {
        requester.reset(request =>
            new URL(request.url).pathname.endsWith('/browse')
                ? {status, content: {message: 'Cannot browse'}}
                : undefined
        );
        const indexer = createIndexer();
        await indexer.initIndex();
        expect(
            await indexer.replace(
                [{objectID: 'post-1_0', slug: 'first'}],
                [{id: 'post-1', slug: 'first'}]
            )
        ).toEqual({cleanupSkipped: status === 403});
        expect(
            requester
                .requests()
                .map(normalizeRequest)
                .filter(({pathname}) => pathname.endsWith('/batch'))
        ).toHaveLength(1);
    });

    it.each(['browse', 'save', 'confirmation'])(
        'does not delete when %s fails',
        async function (stage) {
            requester.reset(request => {
                const path = new URL(request.url).pathname;
                if (
                    (stage === 'browse' && path.endsWith('/browse')) ||
                    (stage === 'save' && path.endsWith('/batch')) ||
                    (stage === 'confirmation' && path.includes('/task/'))
                ) {
                    return {status: 400, content: {message: 'Rejected'}};
                }
                if (path.endsWith('/browse')) {
                    return {status: 200, content: {hits: [{objectID: 'post-1_1', slug: 'first'}]}};
                }
            });
            const indexer = createIndexer();
            await indexer.initIndex();
            await expect(
                indexer.replace(
                    [{objectID: 'post-1_0', slug: 'first'}],
                    [{id: 'post-1', slug: 'first'}]
                )
            ).rejects.toMatchObject({errorType: 'AlgoliaError', status: 400});
            const writes = requester
                .requests()
                .map(normalizeRequest)
                .filter(({pathname}) => pathname.endsWith('/batch'));
            expect(
                writes
                    .flatMap(({body}) => body.requests)
                    .every(({action}) => action === 'addObject')
            ).toBe(true);
            if (stage === 'browse') {
                expect(writes).toHaveLength(0);
            }
        }
    );

    it('does not mutate an empty replacement or accept records outside its content scope', async function () {
        const indexer = createIndexer();
        await indexer.initIndex();
        expect(await indexer.replace([], [{id: 'post-1', slug: 'first'}])).toEqual({
            cleanupSkipped: false
        });
        expect(requester.requests()).toHaveLength(0);
        for (const [records, contents] of [
            [[{objectID: 'other_0', slug: 'first'}], [{id: 'post-1', slug: 'first'}]],
            [[{objectID: 'post-1_0', slug: 'wrong'}], [{id: 'post-1', slug: 'first'}]],
            [[{objectID: 'post-1_0', slug: 'first'}], []],
            [[{objectID: 'post-1_0', slug: 'first'}], [{id: '', slug: 'first'}]],
            [
                [{objectID: 'post-1_0', slug: 'first'}],
                [
                    {id: 'post-1', slug: 'first'},
                    {id: 'post-2', slug: 'second'}
                ]
            ],
            [null, []]
        ]) {
            await expect(indexer.replace(records, contents)).rejects.toThrow('Replacement');
        }
        expect(requester.requests()).toHaveLength(0);
    });

    it('maps settings initialization failure instead of continuing', async function () {
        requester.reset(request => ({
            status: request.method === 'GET' ? 404 : 403,
            content: {message: 'Settings rejected'}
        }));
        await expect(createIndexer().prepareIndex()).rejects.toMatchObject({
            errorType: 'AlgoliaError',
            status: 403
        });
    });

    it('confirms every save batch before cleanup and safely retries failed cleanup', async function () {
        const records = Array.from({length: 1001}, (_, index) => ({
            objectID: `post-1_${index}`,
            slug: 'first'
        }));
        let rejectCleanup = true;
        requester.reset(request => {
            const path = new URL(request.url).pathname;
            if (path.endsWith('/browse')) {
                return {status: 200, content: {hits: [{objectID: 'post-1_1001', slug: 'first'}]}};
            }
            if (
                path.endsWith('/batch') &&
                JSON.parse(request.data).requests[0].action === 'deleteObject' &&
                rejectCleanup
            ) {
                return {status: 400, content: {message: 'Cleanup rejected'}};
            }
        });
        const indexer = createIndexer();
        await indexer.initIndex();
        await expect(
            indexer.replace(records, [{id: 'post-1', slug: 'first'}])
        ).rejects.toMatchObject({errorType: 'AlgoliaError', status: 400});
        const firstRun = requester.requests().map(normalizeRequest);
        expect(firstRun.filter(({pathname}) => pathname.includes('/task/'))).toHaveLength(2);
        expect(firstRun.at(-1).body.requests).toEqual([
            {action: 'deleteObject', body: {objectID: 'post-1_1001'}}
        ]);
        expect(
            firstRun
                .filter(({pathname}) => pathname.endsWith('/batch'))
                .slice(0, 2)
                .map(({body}) => body.requests.length)
        ).toEqual([1000, 1]);
        rejectCleanup = false;
        await expect(indexer.replace(records, [{id: 'post-1', slug: 'first'}])).resolves.toEqual({
            cleanupSkipped: false
        });
        expect(requester.requests().map(normalizeRequest).at(-1).pathname).toContain('/task/');
    });

    it('retains stale records when a later save batch fails', async function () {
        let batches = 0;
        requester.reset(request => {
            const path = new URL(request.url).pathname;
            if (path.endsWith('/browse')) {
                return {status: 200, content: {hits: [{objectID: 'post-1_1001', slug: 'first'}]}};
            }
            if (path.endsWith('/batch')) {
                batches += 1;
            }
            if (path.endsWith('/batch') && batches === 2) {
                return {status: 400, content: {message: 'Second batch rejected'}};
            }
        });
        const indexer = createIndexer();
        await indexer.initIndex();
        const records = Array.from({length: 1001}, (_, index) => ({
            objectID: `post-1_${index}`,
            slug: 'first'
        }));
        await expect(
            indexer.replace(records, [{id: 'post-1', slug: 'first'}])
        ).rejects.toMatchObject({status: 400});
        expect(
            requester
                .requests()
                .map(normalizeRequest)
                .filter(({pathname}) => pathname.endsWith('/batch'))
                .flatMap(({body}) => body.requests)
                .every(({action}) => action === 'addObject')
        ).toBe(true);
    });

    it('waits for a pending save task to publish before cleanup', async function () {
        let pending = true;
        requester.reset(request => {
            const path = new URL(request.url).pathname;
            if (path.endsWith('/browse')) {
                return {status: 200, content: {hits: [{objectID: 'post-1_1', slug: 'first'}]}};
            }
            if (path.includes('/task/') && pending) {
                pending = false;
                return {status: 200, content: {status: 'notPublished'}};
            }
        });
        const indexer = createIndexer();
        await indexer.initIndex();
        await indexer.replace(
            [{objectID: 'post-1_0', slug: 'first'}],
            [{id: 'post-1', slug: 'first'}]
        );
        expect(
            requester
                .requests()
                .map(normalizeRequest)
                .map(({pathname}) => pathname)
        ).toEqual([
            '/1/indexes/help-center/browse',
            '/1/indexes/help-center/batch',
            '/1/indexes/help-center/task/2',
            '/1/indexes/help-center/task/2',
            '/1/indexes/help-center/batch',
            '/1/indexes/help-center/task/5'
        ]);
    });

    it('preserves existing settings when callers reuse their connection options', async function () {
        const options = {...ALGOLIA_OPTIONS};
        await new IndexFactory(options).prepareIndex();
        await new IndexFactory(options).prepareIndex();
        expect(
            requester
                .requests()
                .map(normalizeRequest)
                .map(({method}) => method)
        ).toEqual(['GET', 'GET']);
    });

    it('accepts repeated content scopes from overlapping source pages', async function () {
        const indexer = createIndexer();
        await indexer.initIndex();
        await expect(
            indexer.replace(
                [{objectID: 'post-1_0', slug: 'first'}],
                [
                    {id: 'post-1', slug: 'first'},
                    {id: 'post-1', slug: 'first'}
                ]
            )
        ).resolves.toEqual({cleanupSkipped: false});
    });

    it('serializes the exact records for saving', async function () {
        const indexer = createIndexer();
        const records = [{objectID: 'post-1_0'}, {objectID: 'post-1_1'}];
        await indexer.initIndex();

        await indexer.save(records);

        expect(requester.requests().map(normalizeRequest)).toEqual([
            {
                method: 'POST',
                origin: 'https://app-id.algolia.net',
                pathname: '/1/indexes/help-center/batch',
                headers: {
                    accept: 'application/json',
                    'content-type': 'text/plain',
                    'x-algolia-api-key': 'admin-api-key',
                    'x-algolia-application-id': 'app-id'
                },
                body: {
                    requests: [
                        {action: 'addObject', body: {objectID: 'post-1_0'}},
                        {action: 'addObject', body: {objectID: 'post-1_1'}}
                    ]
                }
            }
        ]);
    });

    it('serializes the exact slug filter for deletion', async function () {
        const indexer = createIndexer();
        await indexer.initIndex();

        await indexer.delete('getting-started');

        expect(requester.requests().map(normalizeRequest)).toEqual([
            {
                method: 'POST',
                origin: 'https://app-id.algolia.net',
                pathname: '/1/indexes/help-center/deleteByQuery',
                headers: {
                    accept: 'application/json',
                    'content-type': 'text/plain',
                    'x-algolia-api-key': 'admin-api-key',
                    'x-algolia-application-id': 'app-id'
                },
                body: {filters: 'slug:getting-started'}
            }
        ]);
    });

    it('serializes the exact object IDs for deletion', async function () {
        const indexer = createIndexer();
        await indexer.initIndex();

        await indexer.deleteObjects(['post-1_0', 'post-1_1']);

        expect(requester.requests().map(normalizeRequest)).toEqual([
            {
                method: 'POST',
                origin: 'https://app-id.algolia.net',
                pathname: '/1/indexes/help-center/batch',
                headers: {
                    accept: 'application/json',
                    'content-type': 'text/plain',
                    'x-algolia-api-key': 'admin-api-key',
                    'x-algolia-application-id': 'app-id'
                },
                body: {
                    requests: [
                        {action: 'deleteObject', body: {objectID: 'post-1_0'}},
                        {action: 'deleteObject', body: {objectID: 'post-1_1'}}
                    ]
                }
            }
        ]);
    });

    it('maps setSettingsForIndex failures to the exact AlgoliaError fields', async function () {
        await assertMappedOperationError(indexer => indexer.setSettingsForIndex(), {
            method: 'PUT',
            pathname: '/1/indexes/help-center/settings',
            body: REQUIRED_SETTINGS
        });
    });

    it('maps save failures to the exact AlgoliaError fields', async function () {
        await assertMappedOperationError(indexer => indexer.save([{objectID: 'post-1_0'}]), {
            method: 'POST',
            pathname: '/1/indexes/help-center/batch',
            body: {requests: [{action: 'addObject', body: {objectID: 'post-1_0'}}]}
        });
    });

    it('maps non-retryable API failures without losing their status', async function () {
        const indexer = createIndexer();
        await indexer.initIndex();
        requester.reset({status: 400, message: 'Invalid settings'});

        await expect(indexer.setSettingsForIndex()).rejects.toMatchObject({
            errorType: 'AlgoliaError',
            message: 'Invalid settings',
            status: 400,
            originalError: {
                name: 'ApiError',
                message: 'Invalid settings',
                status: 400
            }
        });
        expect(requester.requests()).toHaveLength(1);
    });

    it('maps delete failures to the exact AlgoliaError fields', async function () {
        await assertMappedOperationError(indexer => indexer.delete('getting-started'), {
            method: 'POST',
            pathname: '/1/indexes/help-center/deleteByQuery',
            body: {filters: 'slug:getting-started'}
        });
    });

    it('maps deleteObjects failures to the exact AlgoliaError fields', async function () {
        await assertMappedOperationError(indexer => indexer.deleteObjects(['post-1_0']), {
            method: 'POST',
            pathname: '/1/indexes/help-center/batch',
            body: {requests: [{action: 'deleteObject', body: {objectID: 'post-1_0'}}]}
        });
    });
});
