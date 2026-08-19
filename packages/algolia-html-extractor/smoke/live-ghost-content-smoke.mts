import {createHash} from 'node:crypto';

import {parse, type DefaultTreeAdapterTypes} from 'parse5';

import {extract} from '../index.mts';

const EXPECTED_TARGET = 'https://main.ghost.is' as const;
const EXPECTED_API_VERSION = 'v6.0' as const;
const PAGE_LIMIT = 100 as const;

export type GhostContentType = 'posts' | 'pages';
export type SignatureId = `sha256:${string}`;
export type SmokeResultCategory =
    | 'ok'
    | 'operational-failure'
    | 'schema-drift'
    | 'structural-drift'
    | 'extractor-failure';

export type SmokeTransportRequest = Readonly<{
    target: typeof EXPECTED_TARGET;
    apiVersion: typeof EXPECTED_API_VERSION;
    contentApiKey: string;
    contentType: GhostContentType;
    page: number;
    limit: typeof PAGE_LIMIT;
    fields: 'html';
    formats: 'html';
    redirect: 'error';
}>;

export type SmokeTransportResponse = Readonly<{
    status: number;
    redirected: boolean;
    body: unknown;
}>;

export type SmokeTransport = (request: SmokeTransportRequest) => Promise<SmokeTransportResponse>;

export type ResourceTotals = Readonly<{
    pages: number;
    items: number;
}>;

export type SmokeReport = Readonly<{
    category: SmokeResultCategory;
    observedAt: string;
    target: typeof EXPECTED_TARGET;
    apiVersion: typeof EXPECTED_API_VERSION;
    totals: Readonly<Record<GhostContentType, ResourceTotals>>;
    signatures: readonly Readonly<{id: SignatureId; count: number}>[];
    drift: Readonly<{
        added: readonly SignatureId[];
        missing: readonly SignatureId[];
        countChanged: readonly SignatureId[];
    }>;
}>;

export type LiveGhostContentSmokeOptions = Readonly<{
    target: string;
    apiVersion: string;
    contentApiKey: string;
    transport: SmokeTransport;
    clock: () => Date;
    summarySink: (summary: string) => void | Promise<void>;
    baseline?: Readonly<Record<SignatureId, number>>;
}>;

export type SmokeErrorCode =
    | 'invalid-credentials'
    | 'invalid-target'
    | 'invalid-api-version'
    | 'clock-failure'
    | 'transport-failure'
    | 'summary-failure'
    | 'redirect-rejected'
    | 'http-failure'
    | 'invalid-schema'
    | 'invalid-pagination'
    | 'empty-census'
    | 'normalization-failure'
    | 'extractor-invariant';

type FailureCategory = Exclude<SmokeResultCategory, 'ok' | 'structural-drift'>;

type Element = DefaultTreeAdapterTypes.Element;
type Node = DefaultTreeAdapterTypes.Node;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;

type SmokeState = {
    totals: Record<GhostContentType, {pages: number; items: number}>;
    signatureCounts: Map<SignatureId, number>;
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
    readonly code: SmokeErrorCode;

    constructor(category: FailureCategory, code: SmokeErrorCode) {
        super(category);
        this.category = category;
        this.code = code;
    }
}

export class SmokeError extends Error {
    readonly category: FailureCategory;
    readonly code: SmokeErrorCode;
    readonly report: SmokeReport;
    readonly reportingCode: 'summary-failure' | undefined;

    constructor(
        category: FailureCategory,
        code: SmokeErrorCode,
        report: SmokeReport,
        reportingCode?: 'summary-failure'
    ) {
        super(`Live Ghost content smoke failed: ${category}`);
        this.name = 'SmokeError';
        this.category = category;
        this.code = code;
        this.report = report;
        this.reportingCode = reportingCode;
    }
}

const createState = (): SmokeState => ({
    totals: {
        posts: {pages: 0, items: 0},
        pages: {pages: 0, items: 0}
    },
    signatureCounts: new Map()
});

const sortSignatureIds = (identifiers: Iterable<SignatureId>): readonly SignatureId[] => {
    return [...identifiers].sort();
};

const classifyDrift = (
    signatureCounts: ReadonlyMap<SignatureId, number>,
    baseline: Readonly<Record<SignatureId, number>> | undefined
): SmokeReport['drift'] => {
    if (baseline === undefined) {
        return {added: [], missing: [], countChanged: []};
    }

    const baselineIds = Object.keys(baseline) as SignatureId[];
    const added = sortSignatureIds(
        [...signatureCounts.keys()].filter(identifier => baseline[identifier] === undefined)
    );
    const missing = sortSignatureIds(
        baselineIds.filter(identifier => !signatureCounts.has(identifier))
    );
    const countChanged = sortSignatureIds(
        baselineIds.filter(identifier => {
            const observedCount = signatureCounts.get(identifier);
            return observedCount !== undefined && observedCount !== baseline[identifier];
        })
    );

    return {added, missing, countChanged};
};

const createReport = (
    category: SmokeResultCategory,
    observedAt: string,
    state: SmokeState,
    baseline: Readonly<Record<SignatureId, number>> | undefined
): SmokeReport => ({
    category,
    observedAt,
    target: EXPECTED_TARGET,
    apiVersion: EXPECTED_API_VERSION,
    totals: {
        posts: {...state.totals.posts},
        pages: {...state.totals.pages}
    },
    signatures: sortSignatureIds(state.signatureCounts.keys()).map(id => ({
        id,
        count: state.signatureCounts.get(id) ?? 0
    })),
    drift: classifyDrift(state.signatureCounts, baseline)
});

const formatIdentifiers = (identifiers: readonly SignatureId[]): string => {
    return identifiers.length === 0 ? 'none' : identifiers.join(', ');
};

export function formatSmokeSummary(report: SmokeReport): string {
    const signatureLines = report.signatures.map(({id, count}) => `| ${id} | ${count} |`);
    const signatureTable = signatureLines.length === 0 ? '| none | 0 |' : signatureLines.join('\n');

    return [
        '# Live Ghost content smoke',
        '',
        `Result: ${report.category}`,
        `Observed: ${report.observedAt}`,
        `Target: ${report.target}`,
        `API version: ${report.apiVersion}`,
        '',
        '| Resource | Pages | Items |',
        '| --- | ---: | ---: |',
        `| posts | ${report.totals.posts.pages} | ${report.totals.posts.items} |`,
        `| pages | ${report.totals.pages.pages} | ${report.totals.pages.items} |`,
        '',
        `Distinct signatures: ${report.signatures.length}`,
        '',
        '| Signature | Count |',
        '| --- | ---: |',
        signatureTable,
        '',
        `Added: ${formatIdentifiers(report.drift.added)}`,
        `Missing: ${formatIdentifiers(report.drift.missing)}`,
        `Count changed: ${formatIdentifiers(report.drift.countChanged)}`,
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

const validateOptions = (options: LiveGhostContentSmokeOptions): void => {
    if (typeof options.contentApiKey !== 'string' || options.contentApiKey.trim().length === 0) {
        throw new SmokeAbort('operational-failure', 'invalid-credentials');
    }

    if (options.target !== EXPECTED_TARGET) {
        throw new SmokeAbort('operational-failure', 'invalid-target');
    }

    if (options.apiVersion !== EXPECTED_API_VERSION) {
        throw new SmokeAbort('operational-failure', 'invalid-api-version');
    }
};

const SIGNATURE_ID_PATTERN = /^sha256:[0-9a-f]{64}$/u;

const validateBaseline = (
    baseline: Readonly<Record<SignatureId, number>> | undefined
): Readonly<Record<SignatureId, number>> | undefined => {
    if (baseline === undefined) {
        return undefined;
    }

    if (!isObject(baseline)) {
        throw new SmokeAbort('schema-drift', 'invalid-schema');
    }

    for (const [identifier, count] of Object.entries(baseline)) {
        if (!SIGNATURE_ID_PATTERN.test(identifier) || !isPositiveInteger(count)) {
            throw new SmokeAbort('schema-drift', 'invalid-schema');
        }
    }

    return baseline;
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
    options: LiveGhostContentSmokeOptions,
    contentType: GhostContentType,
    page: number
): Promise<Record<string, unknown>> => {
    let response: SmokeTransportResponse;
    try {
        response = await options.transport({
            target: EXPECTED_TARGET,
            apiVersion: EXPECTED_API_VERSION,
            contentApiKey: options.contentApiKey,
            contentType,
            page,
            limit: PAGE_LIMIT,
            fields: 'html',
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

const STRUCTURAL_ATTRIBUTE_NAMES = [
    'id',
    'name',
    'href',
    'src',
    'alt',
    'data-kg-toggle-state',
    'data-kg-background-image',
    'data-kg-thumbnail',
    'data-kg-custom-thumbnail',
    'data-kg-transistor-embed'
] as const;
const GHOST_STRUCTURAL_CLASS_TOKENS = [
    'kg-card',
    'kg-card-hascaption',
    'kg-content-wide',
    'kg-gallery-container',
    'kg-gallery-image',
    'kg-gallery-row',
    'kg-image',
    'kg-layout-split',
    'kg-width-full',
    'kg-width-regular',
    'kg-width-wide'
] as const;
const GHOST_CARD_FAMILY_CLASS_TOKENS = [
    'kg-audio-card',
    'kg-blockquote-alt',
    'kg-bookmark-card',
    'kg-button-card',
    'kg-callout-card',
    'kg-code-card',
    'kg-cta-card',
    'kg-embed-card',
    'kg-file-card',
    'kg-gallery-card',
    'kg-header-card',
    'kg-image-card',
    'kg-nft-card',
    'kg-product-card',
    'kg-signup-card',
    'kg-toggle-card',
    'kg-transistor-card',
    'kg-video-card'
] as const;
const SELECTED_TAGS = ['p', 'pre', 'td', 'li'] as const;
const HEADING_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;
const GHOST_CLASS_TOKEN_SET: ReadonlySet<string> = new Set([
    ...GHOST_STRUCTURAL_CLASS_TOKENS,
    ...GHOST_CARD_FAMILY_CLASS_TOKENS
]);
const GHOST_CARD_FAMILY_CLASS_TOKEN_SET: ReadonlySet<string> = new Set(
    GHOST_CARD_FAMILY_CLASS_TOKENS
);
const SELECTED_TAG_SET: ReadonlySet<string> = new Set(SELECTED_TAGS);
const HEADING_TAG_SET: ReadonlySet<string> = new Set(HEADING_TAGS);

const isElement = (node: Node): node is Element => 'tagName' in node;

const getPresentAttributeNames = (element: Element): readonly string[] => {
    const attributeNames = new Set(element.attrs.map(attribute => attribute.name));
    return STRUCTURAL_ATTRIBUTE_NAMES.filter(name => attributeNames.has(name));
};

const getGhostClassTokens = (element: Element): readonly string[] => {
    const classValue = element.attrs.find(attribute => attribute.name === 'class')?.value ?? '';
    return [
        ...new Set(classValue.split(/\s+/u).filter(token => GHOST_CLASS_TOKEN_SET.has(token)))
    ].toSorted();
};

const hasNonEmptyAnchor = (element: Element): boolean => {
    return element.attrs.some(
        attribute =>
            (attribute.name === 'id' || attribute.name === 'name') && attribute.value !== ''
    );
};

const hasDescendantAnchor = (parent: ParentNode): boolean => {
    for (const child of parent.childNodes) {
        if (!isElement(child)) {
            continue;
        }
        if (hasNonEmptyAnchor(child) || hasDescendantAnchor(child)) {
            return true;
        }
    }
    return false;
};

const getHeadingAnchorShape = (element: Element): 'direct' | 'descendant' | 'none' => {
    if (hasNonEmptyAnchor(element)) {
        return 'direct';
    }
    return hasDescendantAnchor(element) ? 'descendant' : 'none';
};

const normalizeStructure = (renderedHtml: string): string => {
    const document = parse(renderedHtml);
    const nodes: Array<{
        tag: string;
        parent: number | null;
        kgClasses: readonly string[];
        attributes: readonly string[];
    }> = [];
    const headings: Array<{level: string; anchor: 'direct' | 'descendant' | 'none'}> = [];
    const selectedCounts: Record<(typeof SELECTED_TAGS)[number], number> = {
        p: 0,
        pre: 0,
        td: 0,
        li: 0
    };
    const semanticGaps = {
        caption: false,
        tableHeader: false,
        blockquote: false,
        figure: false,
        cardWrapper: false
    };

    const visit = (parent: ParentNode, parentIndex: number | null): void => {
        for (const child of parent.childNodes) {
            if (!isElement(child)) {
                continue;
            }

            const kgClasses = getGhostClassTokens(child);
            const nodeIndex = nodes.length;
            nodes.push({
                tag: child.tagName,
                parent: parentIndex,
                kgClasses,
                attributes: getPresentAttributeNames(child)
            });

            if (SELECTED_TAG_SET.has(child.tagName)) {
                selectedCounts[child.tagName as keyof typeof selectedCounts] += 1;
            }
            if (HEADING_TAG_SET.has(child.tagName)) {
                headings.push({level: child.tagName, anchor: getHeadingAnchorShape(child)});
            }

            semanticGaps.caption ||= child.tagName === 'figcaption' || child.tagName === 'caption';
            semanticGaps.tableHeader ||= child.tagName === 'th';
            semanticGaps.blockquote ||= child.tagName === 'blockquote';
            semanticGaps.figure ||= child.tagName === 'figure';
            semanticGaps.cardWrapper ||= kgClasses.some(
                className =>
                    className === 'kg-card' || GHOST_CARD_FAMILY_CLASS_TOKEN_SET.has(className)
            );

            visit(child, nodeIndex);
        }
    };

    visit(document, null);
    return JSON.stringify({version: 1, nodes, headings, selectedCounts, semanticGaps});
};

const createSignature = (canonicalStructure: string): SignatureId => {
    return `sha256:${createHash('sha256').update(canonicalStructure, 'utf8').digest('hex')}`;
};

const validateExtractionFragments = (renderedHtml: string): void => {
    let fragments: unknown;
    try {
        fragments = extract(renderedHtml);
    } catch {
        throw new SmokeAbort('extractor-failure', 'extractor-invariant');
    }

    if (!Array.isArray(fragments)) {
        throw new SmokeAbort('extractor-failure', 'extractor-invariant');
    }

    const allowedSourceTags: ReadonlySet<string> = new Set(SELECTED_TAGS);
    const allowedHeadingRanks: ReadonlySet<number> = new Set([40, 50, 60, 70, 80, 90, 100]);
    for (const [position, fragment] of fragments.entries()) {
        if (!isObject(fragment)) {
            throw new SmokeAbort('extractor-failure', 'extractor-invariant');
        }

        const hasValidAnchor = fragment.anchor === null || typeof fragment.anchor === 'string';
        const hasValidHeadings =
            Array.isArray(fragment.headingPath) &&
            fragment.headingPath.every(heading => typeof heading === 'string');
        const isValid =
            typeof fragment.html === 'string' &&
            typeof fragment.text === 'string' &&
            hasValidHeadings &&
            hasValidAnchor &&
            fragment.position === position &&
            typeof fragment.sourceTag === 'string' &&
            allowedSourceTags.has(fragment.sourceTag) &&
            typeof fragment.headingRank === 'number' &&
            allowedHeadingRanks.has(fragment.headingRank);
        if (!isValid) {
            throw new SmokeAbort('extractor-failure', 'extractor-invariant');
        }
    }
};

const observeHtml = (renderedHtml: string, state: SmokeState): void => {
    let firstPass: string;
    let secondPass: string;
    try {
        firstPass = normalizeStructure(renderedHtml);
        secondPass = normalizeStructure(renderedHtml);
    } catch {
        throw new SmokeAbort('schema-drift', 'normalization-failure');
    }

    if (firstPass !== secondPass) {
        throw new SmokeAbort('schema-drift', 'normalization-failure');
    }

    validateExtractionFragments(renderedHtml);
    const signature = createSignature(firstPass);
    state.signatureCounts.set(signature, (state.signatureCounts.get(signature) ?? 0) + 1);
};

const readContentType = async (
    options: LiveGhostContentSmokeOptions,
    contentType: GhostContentType,
    state: SmokeState
): Promise<void> => {
    const visitedPages = new Set<number>();
    let currentPage = 1;
    let declaredPages: number | null = null;
    let declaredTotal: number | null = null;

    while (true) {
        if (visitedPages.has(currentPage)) {
            throw new SmokeAbort('schema-drift', 'invalid-pagination');
        }
        visitedPages.add(currentPage);

        const body = await requestPage(options, contentType, currentPage);
        const items = body[contentType];
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
            if (!isObject(item) || typeof item.html !== 'string') {
                throw new SmokeAbort('schema-drift', 'invalid-schema');
            }
            observeHtml(item.html, state);
            state.totals[contentType].items += 1;
        }
        state.totals[contentType].pages += 1;

        if (pagination.next === null) {
            break;
        }
        if (visitedPages.has(pagination.next)) {
            throw new SmokeAbort('schema-drift', 'invalid-pagination');
        }
        currentPage = pagination.next;
    }

    if (
        state.totals[contentType].pages !== declaredPages ||
        state.totals[contentType].items !== declaredTotal
    ) {
        throw new SmokeAbort('schema-drift', 'invalid-pagination');
    }
};

const writeSummary = async (
    options: LiveGhostContentSmokeOptions,
    report: SmokeReport,
    observedAt: string,
    state: SmokeState,
    baseline: Readonly<Record<SignatureId, number>> | undefined,
    failure?: SmokeAbort
): Promise<void> => {
    try {
        await options.summarySink(formatSmokeSummary(report));
    } catch {
        if (failure !== undefined) {
            throw new SmokeError(failure.category, failure.code, report, 'summary-failure');
        }
        const failureReport = createReport('operational-failure', observedAt, state, baseline);
        throw new SmokeError('operational-failure', 'summary-failure', failureReport);
    }
};

export async function runLiveGhostContentSmoke(
    options: LiveGhostContentSmokeOptions
): Promise<SmokeReport> {
    let observedAt = new Date(0).toISOString();
    const state = createState();
    let baseline: Readonly<Record<SignatureId, number>> | undefined;

    try {
        observedAt = readObservedAt(options.clock);
        validateOptions(options);
        baseline = validateBaseline(options.baseline);
        await readContentType(options, 'posts', state);
        await readContentType(options, 'pages', state);
        if (state.totals.posts.items + state.totals.pages.items === 0) {
            throw new SmokeAbort('schema-drift', 'empty-census');
        }
    } catch (error) {
        const failure =
            error instanceof SmokeAbort
                ? error
                : new SmokeAbort('operational-failure', 'transport-failure');
        const report = createReport(failure.category, observedAt, state, baseline);
        await writeSummary(options, report, observedAt, state, baseline, failure);
        throw new SmokeError(failure.category, failure.code, report);
    }

    const drift = classifyDrift(state.signatureCounts, baseline);
    const category = drift.added.length === 0 ? 'ok' : 'structural-drift';
    const report = createReport(category, observedAt, state, baseline);
    await writeSummary(options, report, observedAt, state, baseline);
    return report;
}
