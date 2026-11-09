import {describe, expect, it} from 'vitest';

import {
    DifferentialSmokeError,
    formatDifferentialSummary,
    runDifferentialRecordSmoke,
    type DifferentialReport,
    type DifferentialSmokeOptions,
    type DifferentialTransport,
    type DifferentialTransportRequest,
    type ExpectedDriftDeclaration,
    type GhostContentItem,
    type RecordBuilder
} from '../smoke/differential-record-smoke.mts';

const TARGET = 'https://main.ghost.is';
const API_VERSION = 'v6.0';
const PUBLISHED_VERSION = '0.4.2';

type PostItem = Readonly<Record<string, unknown>>;

const makeItem = (ordinal: number): PostItem => ({
    id: `content-${ordinal}`,
    slug: `fixture-slug-${ordinal}`,
    url: `https://main.ghost.is/fixture-slug-${ordinal}/`,
    title: `Fixture title ${ordinal}`,
    html: `<p>Fixture prose ${ordinal}</p>`
});

const makePage = (
    items: readonly PostItem[],
    pagination: Readonly<Record<string, unknown>>
): Record<string, unknown> => ({
    posts: items,
    meta: {pagination}
});

const singlePagePagination = (total: number): Readonly<Record<string, unknown>> => ({
    page: 1,
    limit: 100,
    pages: 1,
    total,
    next: null,
    prev: null
});

const makeTransport = (bodies: readonly unknown[]): DifferentialTransport => {
    let call = 0;
    return async () => {
        const body = bodies[call];
        call += 1;
        return {status: 200, redirected: false, body};
    };
};

const buildRecords: RecordBuilder = content => [
    {
        objectID: `${content.id}_0_0`,
        slug: content.slug,
        url: content.url,
        title: content.title,
        html: content.html,
        customRanking: {position: 0, heading: 100}
    }
];

const buildDifferingRecords: RecordBuilder = content => [
    ...buildRecords(content),
    {objectID: `${content.id}_0_1`, slug: content.slug}
];

class FakeFragmenterError extends Error {
    readonly code: string;
    readonly issues: readonly unknown[];

    constructor(code: string, issues: readonly unknown[]) {
        super(code);
        this.code = code;
        this.issues = issues;
    }
}

const createOptions = (
    overrides: Partial<DifferentialSmokeOptions> = {}
): DifferentialSmokeOptions & {readSummaries: () => readonly string[]} => {
    const summaries: string[] = [];
    return {
        target: TARGET,
        apiVersion: API_VERSION,
        contentApiKey: 'fixture-content-api-key',
        transport: makeTransport([makePage([makeItem(1), makeItem(2)], singlePagePagination(2))]),
        clock: () => new Date('2026-11-09T04:17:00.000Z'),
        summarySink: (summary: string) => {
            summaries.push(summary);
        },
        publishedVersion: PUBLISHED_VERSION,
        buildWorkspaceRecords: buildRecords,
        buildPublishedRecords: buildRecords,
        readSummaries: () => summaries,
        ...overrides
    };
};

const expectFailure = async (
    options: DifferentialSmokeOptions,
    category: string,
    code: string
): Promise<DifferentialSmokeError> => {
    const failure = await runDifferentialRecordSmoke(options).then(
        () => {
            throw new Error('Expected the differential smoke to fail.');
        },
        (error: unknown) => error
    );

    expect(failure).toBeInstanceOf(DifferentialSmokeError);
    const smokeError = failure as DifferentialSmokeError;
    expect(smokeError.category).toBe(category);
    expect(smokeError.code).toBe(code);
    expect(smokeError.report.category).toBe(category);
    return smokeError;
};

describe('differential record smoke', () => {
    it('reports ok when both builders produce identical record outcomes', async () => {
        const options = createOptions();

        const report = await runDifferentialRecordSmoke(options);

        expect(report).toEqual({
            category: 'ok',
            observedAt: '2026-11-09T04:17:00.000Z',
            target: TARGET,
            apiVersion: API_VERSION,
            publishedVersion: PUBLISHED_VERSION,
            totals: {pages: 1, items: 2, itemsWithoutHtml: 0},
            comparison: {
                compared: 2,
                equal: 2,
                differing: 0,
                workspaceErrorOutcomes: 0,
                publishedErrorOutcomes: 0
            },
            expectedDrift: 'none-declared'
        } satisfies DifferentialReport);
        expect(options.readSummaries()).toHaveLength(1);
    });

    it('keeps editorial values and credentials out of the summary', async () => {
        const options = createOptions();

        const report = await runDifferentialRecordSmoke(options);
        const summary = options.readSummaries().join('\n');

        expect(summary).toBe(formatDifferentialSummary(report));
        expect(summary).toContain('Result: ok');
        expect(summary).toContain('| 1 | 2 | 0 |');
        expect(summary).toContain('| 2 | 2 | 0 |');
        expect(summary).not.toMatch(
            /fixture-slug|Fixture title|Fixture prose|content-\d|fixture-content-api-key|sha256/iu
        );
    });

    it('follows pagination across pages and aggregates totals', async () => {
        const firstPage = makePage([makeItem(1)], {
            page: 1,
            limit: 100,
            pages: 2,
            total: 3,
            next: 2,
            prev: null
        });
        const secondPage = makePage([makeItem(2), {...makeItem(3), html: null}], {
            page: 2,
            limit: 100,
            pages: 2,
            total: 3,
            next: null,
            prev: 1
        });
        const options = createOptions({transport: makeTransport([firstPage, secondPage])});

        const report = await runDifferentialRecordSmoke(options);

        expect(report.totals).toEqual({pages: 2, items: 3, itemsWithoutHtml: 1});
        expect(report.comparison.compared).toBe(2);
    });

    it('fails with record drift when outcomes differ without a declaration', async () => {
        const options = createOptions({buildWorkspaceRecords: buildDifferingRecords});

        const report = await runDifferentialRecordSmoke(options);

        expect(report.category).toBe('record-drift');
        expect(report.comparison).toEqual({
            compared: 2,
            equal: 0,
            differing: 2,
            workspaceErrorOutcomes: 0,
            publishedErrorOutcomes: 0
        });
        expect(report.expectedDrift).toBe('none-declared');
    });

    it('detects drift from a changed record value alone', async () => {
        const buildLargerRecords: RecordBuilder = content =>
            buildRecords(content).map(record => ({...record, html: `${record.html as string} `}));
        const options = createOptions({buildWorkspaceRecords: buildLargerRecords});

        const report = await runDifferentialRecordSmoke(options);

        expect(report.category).toBe('record-drift');
    });

    it('detects drift from a changed value of equal serialized length', async () => {
        const buildShiftedRecords: RecordBuilder = content =>
            buildRecords(content).map(record => ({
                ...record,
                customRanking: {position: 0, heading: 200}
            }));
        const options = createOptions({buildWorkspaceRecords: buildShiftedRecords});

        const report = await runDifferentialRecordSmoke(options);

        expect(report.category).toBe('record-drift');
    });

    it('ignores record key insertion order on both levels', async () => {
        const buildReorderedRecords: RecordBuilder = content =>
            buildRecords(content).map(record => {
                const {objectID, customRanking, ...rest} = record;
                const ranking = customRanking as Readonly<Record<string, unknown>>;
                return {
                    ...rest,
                    customRanking: {heading: ranking.heading, position: ranking.position},
                    objectID
                };
            });
        const options = createOptions({buildWorkspaceRecords: buildReorderedRecords});

        const report = await runDifferentialRecordSmoke(options);

        expect(report.category).toBe('ok');
    });

    it('treats an undefined record value as a stable null', async () => {
        const buildUndefinedValue: RecordBuilder = content =>
            buildRecords(content).map(record => ({...record, excerpt: undefined}));
        const buildNullValue: RecordBuilder = content =>
            buildRecords(content).map(record => ({...record, excerpt: null}));
        const options = createOptions({
            buildWorkspaceRecords: buildUndefinedValue,
            buildPublishedRecords: buildNullValue
        });

        const report = await runDifferentialRecordSmoke(options);

        expect(report.category).toBe('ok');
    });

    it('accepts declared drift while the named published version is live', async () => {
        const expectedDrift: ExpectedDriftDeclaration = {
            publishedVersion: PUBLISHED_VERSION,
            reason: 'Identity fields ship in the next release.'
        };
        const options = createOptions({
            buildWorkspaceRecords: buildDifferingRecords,
            expectedDrift
        });

        const report = await runDifferentialRecordSmoke(options);

        expect(report.category).toBe('expected-drift');
        expect(report.expectedDrift).toBe('applied');
    });

    it('treats a declaration for another published version as inert', async () => {
        const expectedDrift: ExpectedDriftDeclaration = {
            publishedVersion: '0.4.1',
            reason: 'Stale declaration from the previous release.'
        };
        const options = createOptions({
            buildWorkspaceRecords: buildDifferingRecords,
            expectedDrift
        });

        const report = await runDifferentialRecordSmoke(options);

        expect(report.category).toBe('record-drift');
        expect(report.expectedDrift).toBe('inert');
    });

    it('treats a matching declaration without drift as inert and ok', async () => {
        const expectedDrift: ExpectedDriftDeclaration = {
            publishedVersion: PUBLISHED_VERSION,
            reason: 'Drift resolved by the latest release.'
        };
        const options = createOptions({expectedDrift});

        const report = await runDifferentialRecordSmoke(options);

        expect(report.category).toBe('ok');
        expect(report.expectedDrift).toBe('inert');
    });

    it.each([
        [{publishedVersion: ' ', reason: 'x'}],
        [{publishedVersion: PUBLISHED_VERSION, reason: ''}],
        [{publishedVersion: 7, reason: 'x'}],
        ['declaration']
    ])('rejects a malformed expected-drift declaration %#', async declaration => {
        const options = createOptions({
            expectedDrift: declaration as unknown as ExpectedDriftDeclaration
        });

        await expectFailure(options, 'schema-drift', 'invalid-expected-drift');
    });

    it('treats identical validation failures on both sides as parity', async () => {
        const throwFragmenterError: RecordBuilder = () => {
            throw new FakeFragmenterError('INVALID_GHOST_CONTENT', [{path: null}]);
        };
        const options = createOptions({
            buildWorkspaceRecords: throwFragmenterError,
            buildPublishedRecords: throwFragmenterError
        });

        const report = await runDifferentialRecordSmoke(options);

        expect(report.category).toBe('ok');
        expect(report.comparison).toEqual({
            compared: 2,
            equal: 2,
            differing: 0,
            workspaceErrorOutcomes: 2,
            publishedErrorOutcomes: 2
        });
    });

    it('flags drift when only one side rejects content', async () => {
        const throwFragmenterError: RecordBuilder = () => {
            throw new FakeFragmenterError('RECORD_TOO_LARGE', [{bytes: 10_022}]);
        };
        const options = createOptions({buildPublishedRecords: throwFragmenterError});

        const report = await runDifferentialRecordSmoke(options);

        expect(report.category).toBe('record-drift');
        expect(report.comparison.workspaceErrorOutcomes).toBe(0);
        expect(report.comparison.publishedErrorOutcomes).toBe(2);
    });

    it('flags drift when validation issue counts differ', async () => {
        const options = createOptions({
            buildWorkspaceRecords: () => {
                throw new FakeFragmenterError('INVALID_GHOST_CONTENT', [{}, {}]);
            },
            buildPublishedRecords: () => {
                throw new FakeFragmenterError('INVALID_GHOST_CONTENT', [{}]);
            }
        });

        const report = await runDifferentialRecordSmoke(options);

        expect(report.category).toBe('record-drift');
    });

    it.each([
        ['workspace', 'workspace-builder-failure'],
        ['published', 'published-builder-failure']
    ])('fails when the %s builder throws outside the fragmenter contract', async (side, code) => {
        const throwPlainError: RecordBuilder = () => {
            throw new TypeError('unexpected');
        };
        const options = createOptions(
            side === 'workspace'
                ? {buildWorkspaceRecords: throwPlainError}
                : {buildPublishedRecords: throwPlainError}
        );

        await expectFailure(options, 'builder-failure', code);
    });

    it('fails when a builder returns something other than an array', async () => {
        const options = createOptions({
            buildWorkspaceRecords: (() => null) as unknown as RecordBuilder
        });

        await expectFailure(options, 'builder-failure', 'workspace-builder-failure');
    });

    it('fails when a built record cannot be serialized', async () => {
        const options = createOptions({
            buildPublishedRecords: () => [{objectID: 'x', value: 1n}]
        });

        await expectFailure(options, 'builder-failure', 'published-builder-failure');
    });

    it('fails an empty census when no post carries html', async () => {
        const onlyNullHtml = makePage([{...makeItem(1), html: null}], singlePagePagination(1));
        const options = createOptions({transport: makeTransport([onlyNullHtml])});

        await expectFailure(options, 'schema-drift', 'empty-census');
    });

    it('fails an empty census when the site has no posts', async () => {
        const options = createOptions({
            transport: makeTransport([makePage([], singlePagePagination(0))])
        });

        await expectFailure(options, 'schema-drift', 'empty-census');
    });

    it.each([
        ['missing credentials', {contentApiKey: ' '}, 'invalid-credentials'],
        ['another target', {target: 'https://other.ghost.is'}, 'invalid-target'],
        ['another API version', {apiVersion: 'v5.0'}, 'invalid-api-version'],
        ['a blank published version', {publishedVersion: ''}, 'invalid-published-version']
    ])('fails fast on %s', async (_name, overrides, code) => {
        const requests: DifferentialTransportRequest[] = [];
        const options = createOptions({
            ...overrides,
            transport: async request => {
                requests.push(request);
                return {status: 200, redirected: false, body: {}};
            }
        });

        await expectFailure(options, 'operational-failure', code);
        expect(requests).toHaveLength(0);
    });

    it.each([
        [
            'throws',
            () => {
                throw new Error('no clock');
            }
        ],
        ['returns a non-date', (() => 'now') as unknown as () => Date],
        ['returns an invalid date', () => new Date(Number.NaN)]
    ])('fails when the clock %s', async (_name, clock) => {
        const options = createOptions({clock: clock as () => Date});

        await expectFailure(options, 'operational-failure', 'clock-failure');
    });

    it('wraps an unexpected internal failure as an operational failure', async () => {
        const options = createOptions();
        Object.defineProperty(options, 'expectedDrift', {
            get(): never {
                throw new Error('unexpected internal failure');
            }
        });

        await expectFailure(options, 'operational-failure', 'transport-failure');
    });

    it('fails when the transport throws', async () => {
        const options = createOptions({
            transport: async () => {
                throw new Error('offline');
            }
        });

        await expectFailure(options, 'operational-failure', 'transport-failure');
    });

    it('fails when the transport answer has no redirect flag', async () => {
        const options = createOptions({
            transport: (async () => null) as unknown as DifferentialTransport
        });

        await expectFailure(options, 'operational-failure', 'transport-failure');
    });

    it('rejects a redirected answer before reading it', async () => {
        const options = createOptions({
            transport: async () => ({status: 200, redirected: true, body: {}})
        });

        await expectFailure(options, 'operational-failure', 'redirect-rejected');
    });

    it.each([[401], [500], [199], [1.5]])('rejects HTTP status %s', async status => {
        const options = createOptions({
            transport: async () => ({status, redirected: false, body: {}})
        });

        await expectFailure(options, 'operational-failure', 'http-failure');
    });

    it('rejects a non-object body as schema drift', async () => {
        const options = createOptions({
            transport: makeTransport(['not json'])
        });

        await expectFailure(options, 'schema-drift', 'invalid-schema');
    });

    it('rejects a body without a posts array', async () => {
        const options = createOptions({
            transport: makeTransport([{posts: 'none', meta: {}}])
        });

        await expectFailure(options, 'schema-drift', 'invalid-schema');
    });

    it('rejects an overfull posts page', async () => {
        const items = Array.from({length: 101}, (_, index) => makeItem(index));
        const options = createOptions({
            transport: makeTransport([makePage(items, singlePagePagination(101))])
        });

        await expectFailure(options, 'schema-drift', 'invalid-schema');
    });

    it.each([
        ['a missing pagination object', {posts: [], meta: {}}],
        ['a non-object meta', {posts: [], meta: null}]
    ])('rejects %s', async (_name, body) => {
        const options = createOptions({transport: makeTransport([body])});

        await expectFailure(options, 'schema-drift', 'invalid-schema');
    });

    it.each([
        ['a mismatched page', {page: 2, limit: 100, pages: 2, total: 1, next: null, prev: 1}],
        ['a foreign limit', {page: 1, limit: 15, pages: 1, total: 1, next: null, prev: null}],
        ['invalid pages', {page: 1, limit: 100, pages: 0, total: 1, next: null, prev: null}],
        ['a negative total', {page: 1, limit: 100, pages: 1, total: -1, next: null, prev: null}],
        ['a wrong next value', {page: 1, limit: 100, pages: 2, total: 2, next: 3, prev: null}],
        ['a wrong prev value', {page: 1, limit: 100, pages: 1, total: 1, next: null, prev: 0}]
    ])('rejects %s as pagination drift', async (_name, pagination) => {
        const options = createOptions({
            transport: makeTransport([makePage([makeItem(1)], pagination)])
        });

        await expectFailure(options, 'schema-drift', 'invalid-pagination');
    });

    it('rejects pagination whose declared shape changes between pages', async () => {
        const firstPage = makePage([makeItem(1)], {
            page: 1,
            limit: 100,
            pages: 2,
            total: 2,
            next: 2,
            prev: null
        });
        const secondPage = makePage([makeItem(2)], {
            page: 2,
            limit: 100,
            pages: 3,
            total: 2,
            next: 3,
            prev: 1
        });
        const options = createOptions({transport: makeTransport([firstPage, secondPage])});

        await expectFailure(options, 'schema-drift', 'invalid-pagination');
    });

    it('rejects totals that do not reconcile with the read items', async () => {
        const options = createOptions({
            transport: makeTransport([makePage([makeItem(1)], singlePagePagination(5))])
        });

        await expectFailure(options, 'schema-drift', 'invalid-pagination');
    });

    it('rejects a non-object post item', async () => {
        const options = createOptions({
            transport: makeTransport([
                makePage(['item' as unknown as PostItem], singlePagePagination(1))
            ])
        });

        await expectFailure(options, 'schema-drift', 'invalid-schema');
    });

    it.each([
        ['a numeric html value', {...makeItem(1), html: 7}],
        ['a missing id', {...makeItem(1), id: undefined}],
        ['a missing slug', {...makeItem(1), slug: 4}],
        ['a missing url', {...makeItem(1), url: null}],
        ['a missing title', {...makeItem(1), title: ['x']}]
    ])('rejects a post with %s', async (_name, item) => {
        const options = createOptions({
            transport: makeTransport([makePage([item as PostItem], singlePagePagination(1))])
        });

        await expectFailure(options, 'schema-drift', 'invalid-schema');
    });

    it('reports the original failure when the summary also fails', async () => {
        const options = createOptions({
            transport: async () => {
                throw new Error('offline');
            },
            summarySink: () => {
                throw new Error('no summary');
            }
        });

        const failure = await expectFailure(options, 'operational-failure', 'transport-failure');
        expect(failure.reportingCode).toBe('summary-failure');
    });

    it('fails a successful comparison whose summary cannot be written', async () => {
        const options = createOptions({
            summarySink: () => {
                throw new Error('no summary');
            }
        });

        const failure = await expectFailure(options, 'operational-failure', 'summary-failure');
        expect(failure.reportingCode).toBeUndefined();
        expect(failure.report.comparison.compared).toBe(2);
    });

    it('passes the full content item to both builders', async () => {
        const seen: GhostContentItem[] = [];
        const observingBuilder: RecordBuilder = content => {
            seen.push(content);
            return buildRecords(content);
        };
        const options = createOptions({
            transport: makeTransport([makePage([makeItem(7)], singlePagePagination(1))]),
            buildWorkspaceRecords: observingBuilder,
            buildPublishedRecords: observingBuilder
        });

        await runDifferentialRecordSmoke(options);

        expect(seen).toEqual([
            {
                id: 'content-7',
                slug: 'fixture-slug-7',
                url: 'https://main.ghost.is/fixture-slug-7/',
                title: 'Fixture title 7',
                html: '<p>Fixture prose 7</p>'
            },
            {
                id: 'content-7',
                slug: 'fixture-slug-7',
                url: 'https://main.ghost.is/fixture-slug-7/',
                title: 'Fixture title 7',
                html: '<p>Fixture prose 7</p>'
            }
        ]);
    });
});
