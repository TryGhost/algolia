import {createRequire} from 'node:module';

import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

const require = createRequire(import.meta.url);
const requester = require('./helpers/algolia-requester-register.js');
const {ALGOLIA_OPTIONS, normalizeRequest} = require('./helpers/request-contract.js');

type NormalizedRequest = Readonly<{
    method: string;
    pathname: string;
    body: unknown;
}>;

type StubbedResponse = Readonly<{status: number; content: unknown}>;

type RawRequest = Readonly<{method: string; url: string; data?: string}>;

/** Projects the shared full-fidelity normalization onto the contract these tests assert. */
const normalizedRequests = (): readonly NormalizedRequest[] => {
    return (requester.requests() as RawRequest[]).map(request => {
        const {method, pathname, body} = normalizeRequest(request) as NormalizedRequest;
        return {method, pathname, body};
    });
};

const respondTo = (
    answer: (pathname: string, request: RawRequest) => StubbedResponse | undefined
): void => {
    requester.reset((request: RawRequest) => answer(new URL(request.url).pathname, request));
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let IndexFactory: any;

const createIndexer = async () => {
    const indexer = new IndexFactory(ALGOLIA_OPTIONS);
    await indexer.initIndex();
    return indexer;
};

beforeAll(() => {
    requester.install();
    IndexFactory = require('../index.js');
});

afterAll(() => {
    requester.restore();
});

beforeEach(() => {
    requester.reset();
});

describe('IndexFactory content identity operations', () => {
    it('deletes every record for one Ghost content ID with an escaped filter', async () => {
        const indexer = await createIndexer();

        await indexer.deleteContent('content-"quoted"\\slash');

        expect(normalizedRequests()).toEqual([
            {
                method: 'POST',
                pathname: '/1/indexes/help-center/deleteByQuery',
                body: {filters: 'contentId:"content-\\"quoted\\"\\\\slash"'}
            },
            {
                method: 'GET',
                pathname: '/1/indexes/help-center/task/1',
                body: undefined
            }
        ]);
    });

    it.each(['', 42, undefined, null])(
        'rejects content deletion for the content ID %j before any request',
        async contentId => {
            const indexer = await createIndexer();

            await expect(indexer.deleteContent(contentId)).rejects.toThrow(
                new TypeError('Content deletion requires a contentId.')
            );
            expect(normalizedRequests()).toEqual([]);
        }
    );

    it('confirms replacement saves before deleting only stale records by content ID', async () => {
        respondTo((pathname, request) => {
            if (!pathname.endsWith('/browse')) {
                return undefined;
            }
            const body = JSON.parse(request.data as string) as {cursor?: string};
            return {
                status: 200,
                content: body.cursor
                    ? {
                          hits: [
                              {objectID: 'post-1_1', contentId: 'ghost-post-1'},
                              {objectID: 'page-9_0', contentId: 'ghost-page-9'},
                              {objectID: 'legacy_0', slug: 'first'}
                          ]
                      }
                    : {
                          hits: [{objectID: 'post-1_0', contentId: 'ghost-post-1'}],
                          cursor: 'next'
                      }
            };
        });
        const indexer = await createIndexer();

        const outcome = await indexer.replaceContent(
            [{objectID: 'post-1_0', contentId: 'ghost-post-1', contentType: 'post'}],
            [{contentId: 'ghost-post-1', contentType: 'post'}]
        );

        expect(outcome).toEqual({cleanupSkipped: false});
        const requests = normalizedRequests();
        expect(requests.map(({pathname}) => pathname)).toEqual([
            '/1/indexes/help-center/browse',
            '/1/indexes/help-center/browse',
            '/1/indexes/help-center/batch',
            '/1/indexes/help-center/task/3',
            '/1/indexes/help-center/batch',
            '/1/indexes/help-center/task/5'
        ]);
        expect(requests[0]?.body).toMatchObject({
            attributesToRetrieve: ['objectID', 'contentId'],
            filters: 'contentId:"ghost-post-1"'
        });
        expect(requests[2]?.body).toEqual({
            requests: [
                {
                    action: 'addObject',
                    body: {objectID: 'post-1_0', contentId: 'ghost-post-1', contentType: 'post'}
                }
            ]
        });
        expect(requests[4]?.body).toEqual({
            requests: [{action: 'deleteObject', body: {objectID: 'post-1_1'}}]
        });
    });

    it.each([403, 404])('safely saves replacements when browse returns %d', async status => {
        respondTo(pathname =>
            pathname.endsWith('/browse') ? {status, content: {message: 'Cannot browse'}} : undefined
        );
        const indexer = await createIndexer();

        const outcome = await indexer.replaceContent(
            [{objectID: 'post-1_0', contentId: 'ghost-post-1', contentType: 'post'}],
            [{contentId: 'ghost-post-1', contentType: 'post'}]
        );

        expect(outcome).toEqual({cleanupSkipped: status === 403});
        const batches = normalizedRequests().filter(({pathname}) => pathname.endsWith('/batch'));
        expect(batches).toHaveLength(1);
        const actions = batches.flatMap(
            ({body}) => (body as {requests: {action: string}[]}).requests
        );
        expect(actions.every(({action}) => action === 'addObject')).toBe(true);
    });

    it.each(['save', 'confirmation'])('does not delete when the %s fails', async stage => {
        respondTo(pathname => {
            if (
                (stage === 'save' && pathname.endsWith('/batch')) ||
                (stage === 'confirmation' && pathname.includes('/task/'))
            ) {
                return {status: 400, content: {message: 'Rejected'}};
            }
            if (pathname.endsWith('/browse')) {
                return {
                    status: 200,
                    content: {hits: [{objectID: 'post-1_1', contentId: 'ghost-post-1'}]}
                };
            }
            return undefined;
        });
        const indexer = await createIndexer();

        await expect(
            indexer.replaceContent(
                [{objectID: 'post-1_0', contentId: 'ghost-post-1', contentType: 'post'}],
                [{contentId: 'ghost-post-1', contentType: 'post'}]
            )
        ).rejects.toMatchObject({errorType: 'AlgoliaError', status: 400});

        const writes = normalizedRequests()
            .filter(({pathname}) => pathname.endsWith('/batch'))
            .flatMap(({body}) => (body as {requests: {action: string}[]}).requests);
        expect(writes.every(({action}) => action === 'addObject')).toBe(true);
    });

    it('makes no requests for an empty replacement', async () => {
        const indexer = await createIndexer();

        expect(
            await indexer.replaceContent([], [{contentId: 'ghost-post-1', contentType: 'post'}])
        ).toEqual({cleanupSkipped: false});
        expect(normalizedRequests()).toEqual([]);
    });

    it.each([
        ['non-array fragments', 'records', [{contentId: 'c', contentType: 'post'}]],
        ['non-array contents', [{objectID: 'c_0', contentId: 'c', contentType: 'post'}], 'contents']
    ])('rejects %s before any request', async (_name, fragments, contents) => {
        const indexer = await createIndexer();

        await expect(indexer.replaceContent(fragments, contents)).rejects.toThrow(
            new TypeError('Replacement requires fragment and content arrays.')
        );
        expect(normalizedRequests()).toEqual([]);
    });

    it.each([
        [{contentId: '', contentType: 'post'}],
        [{contentId: 'ghost-post-1', contentType: 'posts'}],
        [{contentId: 'ghost-post-1'}],
        [null]
    ])('rejects the replacement content identity %j before any request', async content => {
        const indexer = await createIndexer();

        await expect(
            indexer.replaceContent(
                [{objectID: 'post-1_0', contentId: 'ghost-post-1', contentType: 'post'}],
                [content]
            )
        ).rejects.toThrow(
            new TypeError(
                'Replacement content requires a contentId and a contentType of "post" or "page".'
            )
        );
        expect(normalizedRequests()).toEqual([]);
    });

    it.each([
        ['a foreign content ID', [{objectID: 'x_0', contentId: 'other', contentType: 'post'}]],
        ['a mismatched type', [{objectID: 'x_0', contentId: 'ghost-post-1', contentType: 'page'}]],
        ['a missing objectID', [{contentId: 'ghost-post-1', contentType: 'post'}]],
        ['a missing content ID', [{objectID: 'x_0', contentType: 'post'}]],
        ['a missing record', [null]],
        [
            'an unrepresented content',
            [{objectID: 'x_0', contentId: 'ghost-post-1', contentType: 'post'}],
            [
                {contentId: 'ghost-post-1', contentType: 'post'},
                {contentId: 'ghost-page-2', contentType: 'page'}
            ]
        ]
    ])(
        'rejects replacement fragments with %s before any request',
        async (_name, fragments, contents = [{contentId: 'ghost-post-1', contentType: 'post'}]) => {
            const indexer = await createIndexer();

            await expect(indexer.replaceContent(fragments, contents)).rejects.toThrow(
                new TypeError('Replacement fragments must belong to the supplied content.')
            );
            expect(normalizedRequests()).toEqual([]);
        }
    );

    it('browses every record identity and normalizes missing attributes to null', async () => {
        respondTo(pathname =>
            pathname.endsWith('/browse')
                ? {
                      status: 200,
                      content: {
                          hits: [
                              {
                                  objectID: 'post-1_0',
                                  slug: 'first',
                                  contentId: 'ghost-post-1',
                                  contentType: 'post'
                              },
                              {objectID: 'legacy_0', slug: 'older'},
                              {objectID: 'odd_0', slug: 42, contentId: '', contentType: 7},
                              {slug: 'no-object-id'}
                          ]
                      }
                  }
                : undefined
        );
        const indexer = await createIndexer();

        expect(await indexer.browseContentIdentities()).toEqual([
            {objectID: 'post-1_0', slug: 'first', contentId: 'ghost-post-1', contentType: 'post'},
            {objectID: 'legacy_0', slug: 'older', contentId: null, contentType: null},
            {objectID: 'odd_0', slug: null, contentId: null, contentType: null}
        ]);
        const requests = normalizedRequests();
        expect(requests[0]?.body).toMatchObject({
            attributesToRetrieve: ['objectID', 'slug', 'contentId', 'contentType']
        });
    });

    it('reconciles a complete run by removing only stale managed records', async () => {
        respondTo(pathname =>
            pathname.endsWith('/browse')
                ? {
                      status: 200,
                      content: {
                          hits: [
                              {
                                  objectID: 'post-1_0',
                                  contentId: 'ghost-post-1',
                                  contentType: 'post'
                              },
                              {
                                  objectID: 'post-2_0',
                                  contentId: 'ghost-post-2',
                                  contentType: 'post'
                              },
                              {
                                  objectID: 'page-3_0',
                                  contentId: 'ghost-page-3',
                                  contentType: 'page'
                              },
                              {objectID: 'legacy_0', slug: 'older'},
                              {objectID: 'odd_0', contentId: 'x', contentType: 'draft'},
                              {objectID: 'no-id_0', contentType: 'post'},
                              {contentId: 'ghost-post-9', contentType: 'post'}
                          ]
                      }
                  }
                : undefined
        );
        const indexer = await createIndexer();

        const outcome = await indexer.reconcileContent([{objectID: 'post-1_0'}]);

        expect(outcome).toEqual({cleanupSkipped: false});
        const requests = normalizedRequests();
        expect(requests.map(({pathname}) => pathname)).toEqual([
            '/1/indexes/help-center/browse',
            '/1/indexes/help-center/batch',
            '/1/indexes/help-center/task/2'
        ]);
        expect(requests[0]?.body).toMatchObject({
            attributesToRetrieve: ['objectID', 'contentId', 'contentType']
        });
        expect(requests[1]?.body).toEqual({
            requests: [
                {action: 'deleteObject', body: {objectID: 'post-2_0'}},
                {action: 'deleteObject', body: {objectID: 'page-3_0'}}
            ]
        });
    });

    it.each([403, 404])('reconciles nothing when browse returns %d', async status => {
        respondTo(pathname =>
            pathname.endsWith('/browse') ? {status, content: {message: 'Cannot browse'}} : undefined
        );
        const indexer = await createIndexer();

        expect(await indexer.reconcileContent([{objectID: 'post-1_0'}])).toEqual({
            cleanupSkipped: status === 403
        });
        expect(normalizedRequests().filter(({pathname}) => pathname.endsWith('/batch'))).toEqual(
            []
        );
    });

    it('rejects reconciliation input that is not a complete record array', async () => {
        const indexer = await createIndexer();

        await expect(indexer.reconcileContent('records')).rejects.toThrow(
            new TypeError('Reconciliation requires the complete array of saved records.')
        );
        await expect(indexer.reconcileContent([{objectID: ''}])).rejects.toThrow(
            new TypeError('Reconciliation records require an objectID.')
        );
        await expect(indexer.reconcileContent([null])).rejects.toThrow(
            new TypeError('Reconciliation records require an objectID.')
        );
        expect(normalizedRequests()).toEqual([]);
    });

    it.each([
        ['browseContentIdentities', (indexer: any) => indexer.browseContentIdentities()],
        [
            'replaceContent',
            (indexer: any) =>
                indexer.replaceContent(
                    [{objectID: 'post-1_0', contentId: 'ghost-post-1', contentType: 'post'}],
                    [{contentId: 'ghost-post-1', contentType: 'post'}]
                )
        ],
        ['deleteContent', (indexer: any) => indexer.deleteContent('ghost-post-1')],
        ['reconcileContent', (indexer: any) => indexer.reconcileContent([{objectID: 'post-1_0'}])]
    ])('maps %s transport failures to the stable AlgoliaError shape', async (_name, invoke) => {
        requester.reset({status: 503, message: 'Algolia is unavailable'});
        const indexer = await createIndexer();

        await expect(invoke(indexer)).rejects.toMatchObject({
            errorType: 'AlgoliaError',
            originalError: expect.objectContaining({name: 'RetryError'})
        });
    });

    it('keeps the default mapped message when the transport error has none', async () => {
        respondTo(pathname =>
            pathname.endsWith('/deleteByQuery') ? {status: 400, content: {}} : undefined
        );
        const indexer = await createIndexer();

        await expect(indexer.deleteContent('ghost-post-1')).rejects.toMatchObject({
            errorType: 'AlgoliaError',
            status: 400,
            message: 'Error processing Algolia'
        });
    });
});
