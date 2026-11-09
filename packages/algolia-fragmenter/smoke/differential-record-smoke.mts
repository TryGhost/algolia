import {createHash} from 'node:crypto';

const EXPECTED_TARGET = 'https://main.ghost.is' as const;
const EXPECTED_API_VERSION = 'v6.0' as const;
const PAGE_LIMIT = 100 as const;
const CONTENT_FIELDS = 'id,slug,url,title,html' as const;

export type DifferentialCategory =
    | 'ok'
    | 'expected-drift'
    | 'record-drift'
    | 'operational-failure'
    | 'schema-drift'
    | 'builder-failure';

export type DifferentialTransportRequest = Readonly<{
    target: typeof EXPECTED_TARGET;
    apiVersion: typeof EXPECTED_API_VERSION;
    contentApiKey: string;
    contentType: 'posts';
    page: number;
    limit: typeof PAGE_LIMIT;
    fields: typeof CONTENT_FIELDS;
    formats: 'html';
    redirect: 'error';
}>;

export type DifferentialTransportResponse = Readonly<{
    status: number;
    redirected: boolean;
    body: unknown;
}>;

export type DifferentialTransport = (
    request: DifferentialTransportRequest
) => Promise<DifferentialTransportResponse>;

export type GhostContentItem = Readonly<{
    id: string;
    slug: string;
    url: string;
    title: string;
    html: string;
}>;

export type RecordBuilder = (
    content: GhostContentItem
) => readonly Readonly<Record<string, unknown>>[];

export type ExpectedDriftDeclaration = Readonly<{
    publishedVersion: string;
    reason: string;
}>;

export type ExpectedDriftStatus = 'none-declared' | 'applied' | 'inert';

export type ResourceTotals = Readonly<{
    pages: number;
    items: number;
    itemsWithoutHtml: number;
}>;

export type ComparisonTotals = Readonly<{
    compared: number;
    equal: number;
    differing: number;
    workspaceErrorOutcomes: number;
    publishedErrorOutcomes: number;
}>;

export type DifferentialReport = Readonly<{
    category: DifferentialCategory;
    observedAt: string;
    target: typeof EXPECTED_TARGET;
    apiVersion: typeof EXPECTED_API_VERSION;
    publishedVersion: string;
    totals: ResourceTotals;
    comparison: ComparisonTotals;
    expectedDrift: ExpectedDriftStatus;
}>;

export type DifferentialSmokeOptions = Readonly<{
    target: string;
    apiVersion: string;
    contentApiKey: string;
    transport: DifferentialTransport;
    clock: () => Date;
    summarySink: (summary: string) => void | Promise<void>;
    publishedVersion: string;
    buildWorkspaceRecords: RecordBuilder;
    buildPublishedRecords: RecordBuilder;
    expectedDrift?: ExpectedDriftDeclaration;
}>;

export type DifferentialSmokeErrorCode =
    | 'invalid-credentials'
    | 'invalid-target'
    | 'invalid-api-version'
    | 'invalid-published-version'
    | 'invalid-expected-drift'
    | 'clock-failure'
    | 'transport-failure'
    | 'summary-failure'
    | 'redirect-rejected'
    | 'http-failure'
    | 'invalid-schema'
    | 'invalid-pagination'
    | 'empty-census'
    | 'workspace-builder-failure'
    | 'published-builder-failure';

type FailureCategory = Exclude<DifferentialCategory, 'ok' | 'expected-drift' | 'record-drift'>;

type SmokeState = {
    totals: {pages: number; items: number; itemsWithoutHtml: number};
    comparison: {
        compared: number;
        equal: number;
        differing: number;
        workspaceErrorOutcomes: number;
        publishedErrorOutcomes: number;
    };
};

type Pagination = Readonly<{
    page: number;
    limit: number;
    pages: number;
    total: number;
    next: number | null;
    prev: number | null;
}>;

class SmokeAbort extends Error {
    readonly category: FailureCategory;
    readonly code: DifferentialSmokeErrorCode;

    constructor(category: FailureCategory, code: DifferentialSmokeErrorCode) {
        super(category);
        this.category = category;
        this.code = code;
    }
}

export class DifferentialSmokeError extends Error {
    readonly category: FailureCategory;
    readonly code: DifferentialSmokeErrorCode;
    readonly report: DifferentialReport;
    readonly reportingCode: 'summary-failure' | undefined;

    constructor(
        category: FailureCategory,
        code: DifferentialSmokeErrorCode,
        report: DifferentialReport,
        reportingCode?: 'summary-failure'
    ) {
        super(`Differential record smoke failed: ${category}`);
        this.name = 'DifferentialSmokeError';
        this.category = category;
        this.code = code;
        this.report = report;
        this.reportingCode = reportingCode;
    }
}

const createState = (): SmokeState => ({
    totals: {pages: 0, items: 0, itemsWithoutHtml: 0},
    comparison: {
        compared: 0,
        equal: 0,
        differing: 0,
        workspaceErrorOutcomes: 0,
        publishedErrorOutcomes: 0
    }
});

const resolveExpectedDriftStatus = (
    declaration: ExpectedDriftDeclaration | undefined,
    publishedVersion: string,
    differing: number
): ExpectedDriftStatus => {
    if (declaration === undefined) {
        return 'none-declared';
    }
    if (declaration.publishedVersion === publishedVersion && differing > 0) {
        return 'applied';
    }
    return 'inert';
};

const createReport = (
    category: DifferentialCategory,
    observedAt: string,
    publishedVersion: string,
    state: SmokeState,
    expectedDrift: ExpectedDriftStatus
): DifferentialReport => ({
    category,
    observedAt,
    target: EXPECTED_TARGET,
    apiVersion: EXPECTED_API_VERSION,
    publishedVersion,
    totals: {...state.totals},
    comparison: {...state.comparison},
    expectedDrift
});

export function formatDifferentialSummary(report: DifferentialReport): string {
    return [
        '# Differential record smoke',
        '',
        `Result: ${report.category}`,
        `Observed: ${report.observedAt}`,
        `Target: ${report.target}`,
        `API version: ${report.apiVersion}`,
        `Published fragmenter: ${report.publishedVersion}`,
        `Expected drift declaration: ${report.expectedDrift}`,
        '',
        '| Pages | Items | Without html |',
        '| ---: | ---: | ---: |',
        `| ${report.totals.pages} | ${report.totals.items} | ${report.totals.itemsWithoutHtml} |`,
        '',
        '| Compared | Equal | Differing |',
        '| ---: | ---: | ---: |',
        `| ${report.comparison.compared} | ${report.comparison.equal} | ${report.comparison.differing} |`,
        '',
        `Workspace error outcomes: ${report.comparison.workspaceErrorOutcomes}`,
        `Published error outcomes: ${report.comparison.publishedErrorOutcomes}`,
        ''
    ].join('\n');
}

const readObservedAt = (clock: () => Date): string => {
    let observedAt: Date;
    try {
        observedAt = clock();
    } catch {
        throw new SmokeAbort('operational-failure', 'clock-failure');
    }

    if (!(observedAt instanceof Date) || !Number.isFinite(observedAt.valueOf())) {
        throw new SmokeAbort('operational-failure', 'clock-failure');
    }

    return new Date(observedAt.valueOf()).toISOString();
};

const isNonEmptyString = (value: unknown): value is string => {
    return typeof value === 'string' && value.trim().length > 0;
};

const validateOptions = (options: DifferentialSmokeOptions): void => {
    if (!isNonEmptyString(options.contentApiKey)) {
        throw new SmokeAbort('operational-failure', 'invalid-credentials');
    }

    if (options.target !== EXPECTED_TARGET) {
        throw new SmokeAbort('operational-failure', 'invalid-target');
    }

    if (options.apiVersion !== EXPECTED_API_VERSION) {
        throw new SmokeAbort('operational-failure', 'invalid-api-version');
    }

    if (!isNonEmptyString(options.publishedVersion)) {
        throw new SmokeAbort('operational-failure', 'invalid-published-version');
    }
};

const validateExpectedDrift = (
    declaration: ExpectedDriftDeclaration | undefined
): ExpectedDriftDeclaration | undefined => {
    if (declaration === undefined) {
        return undefined;
    }

    if (
        !isObject(declaration) ||
        !isNonEmptyString(declaration.publishedVersion) ||
        !isNonEmptyString(declaration.reason)
    ) {
        throw new SmokeAbort('schema-drift', 'invalid-expected-drift');
    }

    return declaration;
};

const isObject = (value: unknown): value is Record<string, unknown> => {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const isNonNegativeInteger = (value: unknown): value is number => {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
};

const isPositiveInteger = (value: unknown): value is number => {
    return typeof value === 'number' && Number.isInteger(value) && value > 0;
};

const readPagination = (body: Record<string, unknown>, expectedPage: number): Pagination => {
    const meta = body.meta;
    if (!isObject(meta) || !isObject(meta.pagination)) {
        throw new SmokeAbort('schema-drift', 'invalid-schema');
    }

    const {page, limit, pages, total, next, prev} = meta.pagination;
    const hasValidScalars =
        page === expectedPage &&
        limit === PAGE_LIMIT &&
        isPositiveInteger(pages) &&
        pages >= page &&
        isNonNegativeInteger(total);
    if (!hasValidScalars) {
        throw new SmokeAbort('schema-drift', 'invalid-pagination');
    }

    const expectedNext = page < pages ? page + 1 : null;
    const expectedPrevious = page === 1 ? null : page - 1;
    const hasValidNext = next === null || isPositiveInteger(next);
    const hasValidPrevious = prev === null || isPositiveInteger(prev);
    if (!hasValidNext || !hasValidPrevious || next !== expectedNext || prev !== expectedPrevious) {
        throw new SmokeAbort('schema-drift', 'invalid-pagination');
    }

    return {page, limit, pages, total, next, prev};
};

const requestPage = async (
    options: DifferentialSmokeOptions,
    page: number
): Promise<Record<string, unknown>> => {
    let response: DifferentialTransportResponse;
    try {
        response = await options.transport({
            target: EXPECTED_TARGET,
            apiVersion: EXPECTED_API_VERSION,
            contentApiKey: options.contentApiKey,
            contentType: 'posts',
            page,
            limit: PAGE_LIMIT,
            fields: CONTENT_FIELDS,
            formats: 'html',
            redirect: 'error'
        });
    } catch {
        throw new SmokeAbort('operational-failure', 'transport-failure');
    }

    if (!isObject(response) || typeof response.redirected !== 'boolean') {
        throw new SmokeAbort('operational-failure', 'transport-failure');
    }

    if (response.redirected) {
        throw new SmokeAbort('operational-failure', 'redirect-rejected');
    }

    if (!isNonNegativeInteger(response.status) || response.status < 200 || response.status >= 300) {
        throw new SmokeAbort('operational-failure', 'http-failure');
    }

    if (!isObject(response.body)) {
        throw new SmokeAbort('schema-drift', 'invalid-schema');
    }

    return response.body;
};

// Serializes every record value with recursively sorted object keys, so an outcome hash
// compares complete record values while staying blind to key insertion order.
const stableStringify = (value: unknown): string => {
    if (Array.isArray(value)) {
        return `[${value.map(entry => stableStringify(entry)).join(',')}]`;
    }
    if (typeof value === 'object' && value !== null) {
        const record = value as Record<string, unknown>;
        const entries = Object.keys(record)
            .toSorted()
            .map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
        return `{${entries.join(',')}}`;
    }
    const serialized = JSON.stringify(value);
    return serialized === undefined ? 'null' : serialized;
};

type FragmenterErrorLike = Readonly<{code: string; issues: readonly unknown[]}>;

// The published copy constructs its own FragmenterError class, so cross-copy
// recognition must be structural rather than instanceof.
const isFragmenterErrorLike = (error: unknown): error is FragmenterErrorLike => {
    return (
        error instanceof Error &&
        typeof (error as Partial<FragmenterErrorLike>).code === 'string' &&
        Array.isArray((error as Partial<FragmenterErrorLike>).issues)
    );
};

const computeOutcome = (
    build: RecordBuilder,
    content: GhostContentItem,
    failureCode: 'workspace-builder-failure' | 'published-builder-failure'
): string => {
    let records: readonly Readonly<Record<string, unknown>>[];
    try {
        records = build(content);
    } catch (error) {
        if (isFragmenterErrorLike(error)) {
            return `error:${error.code}:${error.issues.length}`;
        }
        throw new SmokeAbort('builder-failure', failureCode);
    }

    if (!Array.isArray(records)) {
        throw new SmokeAbort('builder-failure', failureCode);
    }

    let canonical: string;
    try {
        canonical = stableStringify(records);
    } catch {
        throw new SmokeAbort('builder-failure', failureCode);
    }

    return `ok:sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
};

const compareItem = (
    options: DifferentialSmokeOptions,
    content: GhostContentItem,
    state: SmokeState
): void => {
    const workspaceOutcome = computeOutcome(
        options.buildWorkspaceRecords,
        content,
        'workspace-builder-failure'
    );
    const publishedOutcome = computeOutcome(
        options.buildPublishedRecords,
        content,
        'published-builder-failure'
    );

    state.comparison.compared += 1;
    if (workspaceOutcome.startsWith('error:')) {
        state.comparison.workspaceErrorOutcomes += 1;
    }
    if (publishedOutcome.startsWith('error:')) {
        state.comparison.publishedErrorOutcomes += 1;
    }
    if (workspaceOutcome === publishedOutcome) {
        state.comparison.equal += 1;
    } else {
        state.comparison.differing += 1;
    }
};

const observeItem = (options: DifferentialSmokeOptions, item: unknown, state: SmokeState): void => {
    if (!isObject(item)) {
        throw new SmokeAbort('schema-drift', 'invalid-schema');
    }

    // Ghost returns a null html value for an item with an empty rendered body. Such an item is
    // counted so resource totals still reconcile with the declared pagination total, but it
    // reaches neither record builder because production webhooks have no record seam for it.
    if (item.html === null) {
        state.totals.itemsWithoutHtml += 1;
        state.totals.items += 1;
        return;
    }

    const {id, slug, url, title, html} = item;
    if (
        typeof html !== 'string' ||
        typeof id !== 'string' ||
        typeof slug !== 'string' ||
        typeof url !== 'string' ||
        typeof title !== 'string'
    ) {
        throw new SmokeAbort('schema-drift', 'invalid-schema');
    }

    compareItem(options, {id, slug, url, title, html}, state);
    state.totals.items += 1;
};

const readPosts = async (options: DifferentialSmokeOptions, state: SmokeState): Promise<void> => {
    let currentPage = 1;
    let declaredPages: number | null = null;
    let declaredTotal: number | null = null;

    // readPagination pins next to exactly page + 1 or null, so the walk strictly advances
    // and needs no visited-page cycle guard.
    while (true) {
        const body = await requestPage(options, currentPage);
        const items = body.posts;
        if (!Array.isArray(items) || items.length > PAGE_LIMIT) {
            throw new SmokeAbort('schema-drift', 'invalid-schema');
        }

        const pagination = readPagination(body, currentPage);
        declaredPages ??= pagination.pages;
        declaredTotal ??= pagination.total;
        if (pagination.pages !== declaredPages || pagination.total !== declaredTotal) {
            throw new SmokeAbort('schema-drift', 'invalid-pagination');
        }

        for (const item of items) {
            observeItem(options, item, state);
        }
        state.totals.pages += 1;

        if (pagination.next === null) {
            break;
        }
        currentPage = pagination.next;
    }

    if (state.totals.pages !== declaredPages || state.totals.items !== declaredTotal) {
        throw new SmokeAbort('schema-drift', 'invalid-pagination');
    }
};

const writeSummary = async (
    options: DifferentialSmokeOptions,
    report: DifferentialReport,
    failure?: SmokeAbort
): Promise<void> => {
    try {
        await options.summarySink(formatDifferentialSummary(report));
    } catch {
        if (failure !== undefined) {
            throw new DifferentialSmokeError(
                failure.category,
                failure.code,
                report,
                'summary-failure'
            );
        }
        throw new DifferentialSmokeError('operational-failure', 'summary-failure', {
            ...report,
            category: 'operational-failure'
        });
    }
};

export async function runDifferentialRecordSmoke(
    options: DifferentialSmokeOptions
): Promise<DifferentialReport> {
    let observedAt = new Date(0).toISOString();
    const state = createState();
    let declaration: ExpectedDriftDeclaration | undefined;

    try {
        observedAt = readObservedAt(options.clock);
        validateOptions(options);
        declaration = validateExpectedDrift(options.expectedDrift);
        await readPosts(options, state);
        // A read that compared nothing, whether from no posts or only posts without html,
        // exercised neither record builder. It is no evidence of behavioral parity and
        // must never report success.
        if (state.comparison.compared === 0) {
            throw new SmokeAbort('schema-drift', 'empty-census');
        }
    } catch (error) {
        const failure =
            error instanceof SmokeAbort
                ? error
                : new SmokeAbort('operational-failure', 'transport-failure');
        const expectedDrift = resolveExpectedDriftStatus(
            declaration,
            options.publishedVersion,
            state.comparison.differing
        );
        const report = createReport(
            failure.category,
            observedAt,
            options.publishedVersion,
            state,
            expectedDrift
        );
        await writeSummary(options, report, failure);
        throw new DifferentialSmokeError(failure.category, failure.code, report);
    }

    const expectedDrift = resolveExpectedDriftStatus(
        declaration,
        options.publishedVersion,
        state.comparison.differing
    );
    const category: DifferentialCategory =
        state.comparison.differing === 0
            ? 'ok'
            : expectedDrift === 'applied'
              ? 'expected-drift'
              : 'record-drift';
    const report = createReport(
        category,
        observedAt,
        options.publishedVersion,
        state,
        expectedDrift
    );
    await writeSummary(options, report);
    return report;
}
