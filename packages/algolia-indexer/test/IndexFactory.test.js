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

const isSubjectCacheEntry = (filename) => {
    return filename === packageEntryPath
        || filename === indexFactoryPath
        || filename.startsWith(dependencyMarker)
        || filename.startsWith(algoliaSearchMarker);
};

const originalCacheEntries = new Map(Object.entries(require.cache).filter(([filename]) => isSubjectCacheEntry(filename)));

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
    const restoredEntries = new Map(Object.entries(require.cache).filter(([filename]) => isSubjectCacheEntry(filename)));
    expect([...restoredEntries.keys()]).toEqual([...originalCacheEntries.keys()]);
    for (const [filename, cacheEntry] of originalCacheEntries) {
        expect(restoredEntries.get(filename)).toBe(cacheEntry);
    }
};

const REQUIRED_SETTINGS = {
    distinct: true,
    attributeForDistinct: 'slug',
    customRanking: ['desc(customRanking.heading)', 'asc(customRanking.position)'],
    searchableAttributes: ['title', 'headings', 'html', 'url', 'tags.name', 'tags', 'authors.name', 'authors'],
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

const normalizeRequest = (request) => {
    const url = new URL(request.url);
    return {
        method: request.method,
        origin: url.origin,
        pathname: url.pathname,
        headers: request.headers,
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
        attempts: error.originalError.transporterStackTrace.map(({request, response}) => ({
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

    expect(exactMappedError(error)).toEqual({
        name: 'Error',
        message: 'Unreachable hosts - your application id may be incorrect. If the error persists, contact support@algolia.com.',
        errorType: 'AlgoliaError',
        code: undefined,
        status: undefined,
        originalError: {
            name: 'RetryError',
            message: 'Unreachable hosts - your application id may be incorrect. If the error persists, contact support@algolia.com.',
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
        expect(() => http.request('http://example.com')).toThrow('denied an unexpected network request');
        expect(() => https.get('https://example.com')).toThrow('denied an unexpected network request');
        expect(() => net.connect(443, 'example.com')).toThrow('denied an unexpected network request');
        expect(() => tls.connect(443, 'example.com')).toThrow('denied an unexpected network request');
        expect(() => global.fetch('https://example.com')).toThrow('denied an unexpected network request');

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
            expect(() => loadSubject(() => {
                throw new Error('synthetic subject import failure');
            })).toThrow('synthetic subject import failure');

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

        expect(requester.requests().map(normalizeRequest)).toEqual([{
            method: 'GET',
            origin: 'https://app-id-dsn.algolia.net',
            pathname: '/1/indexes/help-center/settings',
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
                'x-algolia-api-key': 'admin-api-key',
                'x-algolia-application-id': 'app-id'
            },
            body: undefined
        }]);
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
                        'content-type': 'application/x-www-form-urlencoded',
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
                        'content-type': 'application/x-www-form-urlencoded',
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

        await createIndexer({indexSettings: customSettings}).setSettingsForIndex({updateSettings: true});

        expect(requester.requests().map(normalizeRequest).map(({method, pathname, body}) => ({method, pathname, body}))).toEqual([
            {method: 'PUT', pathname: '/1/indexes/help-center/settings', body: customSettings},
            {method: 'GET', pathname: '/1/indexes/help-center/settings', body: undefined}
        ]);
    });

    it('reads settings without applying them when updates are explicitly disabled', async function () {
        const settings = await createIndexer().setSettingsForIndex({updateSettings: false});

        expect({requests: requester.requests().map(normalizeRequest), settings}).toEqual({
            requests: [{
                method: 'GET',
                origin: 'https://app-id-dsn.algolia.net',
                pathname: '/1/indexes/help-center/settings',
                headers: {
                    'content-type': 'application/x-www-form-urlencoded',
                    'x-algolia-api-key': 'admin-api-key',
                    'x-algolia-application-id': 'app-id'
                },
                body: undefined
            }],
            settings: {distinct: true}
        });
    });

    it('serializes the exact records for saving', async function () {
        const indexer = createIndexer();
        const records = [{objectID: 'post-1_0'}, {objectID: 'post-1_1'}];
        await indexer.initIndex();

        await indexer.save(records);

        expect(requester.requests().map(normalizeRequest)).toEqual([{
            method: 'POST',
            origin: 'https://app-id.algolia.net',
            pathname: '/1/indexes/help-center/batch',
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
                'x-algolia-api-key': 'admin-api-key',
                'x-algolia-application-id': 'app-id'
            },
            body: {
                requests: [
                    {action: 'updateObject', body: {objectID: 'post-1_0'}},
                    {action: 'updateObject', body: {objectID: 'post-1_1'}}
                ]
            }
        }]);
    });

    it('serializes the exact slug filter for deletion', async function () {
        const indexer = createIndexer();
        await indexer.initIndex();

        await indexer.delete('getting-started');

        expect(requester.requests().map(normalizeRequest)).toEqual([{
            method: 'POST',
            origin: 'https://app-id.algolia.net',
            pathname: '/1/indexes/help-center/deleteByQuery',
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
                'x-algolia-api-key': 'admin-api-key',
                'x-algolia-application-id': 'app-id'
            },
            body: {filters: 'slug:getting-started'}
        }]);
    });

    it('serializes the exact object IDs for deletion', async function () {
        const indexer = createIndexer();
        await indexer.initIndex();

        await indexer.deleteObjects(['post-1_0', 'post-1_1']);

        expect(requester.requests().map(normalizeRequest)).toEqual([{
            method: 'POST',
            origin: 'https://app-id.algolia.net',
            pathname: '/1/indexes/help-center/batch',
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
                'x-algolia-api-key': 'admin-api-key',
                'x-algolia-application-id': 'app-id'
            },
            body: {
                requests: [
                    {action: 'deleteObject', body: {objectID: 'post-1_0'}},
                    {action: 'deleteObject', body: {objectID: 'post-1_1'}}
                ]
            }
        }]);
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
            body: {requests: [{action: 'updateObject', body: {objectID: 'post-1_0'}}]}
        });
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
