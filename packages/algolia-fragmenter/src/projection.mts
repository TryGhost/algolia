import type {ExpectedValueType, GhostContentIssue, GhostContentIssueReason} from './errors.mjs';
import {isPlainObject, type OptionalProjectionSource, type ResolvedPolicy} from './policy.mjs';

export type GhostContent = Readonly<Record<string, unknown>>;

export type PreparedContent = Readonly<{
    index: number;
    id: string;
    slug: string;
    url: string;
    title: string;
    html: string;
    projected: Readonly<Record<string, unknown>>;
    rankingSiblings: Readonly<Record<string, unknown>>;
}>;

export type ContentPreparation =
    | Readonly<{ok: true; contents: readonly PreparedContent[]}>
    | Readonly<{ok: false; issues: readonly GhostContentIssue[]}>;

type ProjectionValueKind = 'string' | 'boolean' | 'number' | 'relations';

type ProjectionSourceDescriptor = Readonly<{ghostKey: string; kind: ProjectionValueKind}>;

type IssueContext = Readonly<{index: number; contentId: string | null; path: string}>;

type FailedRead = Readonly<{ok: false; issue: GhostContentIssue}>;

type ValueRead<Value> = Readonly<{ok: true; value: Value}> | FailedRead;

type ItemPreparation =
    | Readonly<{kind: 'content'; content: PreparedContent}>
    | Readonly<{kind: 'ignored'}>
    | Readonly<{kind: 'issues'; issues: readonly GhostContentIssue[]}>;

/**
 * The single projection-source descriptor table. Content validation and value projection read
 * it through the same reader, so a Ghost source can never be validated as one type and
 * projected as another.
 */
const PROJECTION_SOURCES = {
    image: {ghostKey: 'feature_image', kind: 'string'},
    tags: {ghostKey: 'tags', kind: 'relations'},
    authors: {ghostKey: 'authors', kind: 'relations'},
    excerpt: {ghostKey: 'excerpt', kind: 'string'},
    custom_excerpt: {ghostKey: 'custom_excerpt', kind: 'string'},
    feature_image_alt: {ghostKey: 'feature_image_alt', kind: 'string'},
    feature_image_caption: {ghostKey: 'feature_image_caption', kind: 'string'},
    canonical_url: {ghostKey: 'canonical_url', kind: 'string'},
    featured: {ghostKey: 'featured', kind: 'boolean'},
    visibility: {ghostKey: 'visibility', kind: 'string'},
    created_at: {ghostKey: 'created_at', kind: 'string'},
    updated_at: {ghostKey: 'updated_at', kind: 'string'},
    published_at: {ghostKey: 'published_at', kind: 'string'},
    reading_time: {ghostKey: 'reading_time', kind: 'number'}
} as const satisfies Readonly<Record<OptionalProjectionSource, ProjectionSourceDescriptor>>;

const describeReceived = (value: unknown): string => {
    if (value === null) {
        return 'null';
    }
    if (Array.isArray(value)) {
        return 'array';
    }

    return typeof value;
};

const createContentIssue = (
    context: IssueContext,
    reason: GhostContentIssueReason,
    path: string,
    expected: ExpectedValueType,
    message: string
): GhostContentIssue => ({
    kind: 'content',
    reason,
    path,
    index: context.index,
    contentId: context.contentId,
    expected,
    message
});

const missingIssue = (context: IssueContext, path: string): GhostContentIssue =>
    createContentIssue(
        context,
        'missing',
        path,
        'string',
        `${path}: required Ghost field is missing.`
    );

const wrongTypeIssue = (
    context: IssueContext,
    path: string,
    expected: ExpectedValueType,
    received: unknown
): GhostContentIssue =>
    createContentIssue(
        context,
        'wrong-type',
        path,
        expected,
        `${path}: expected ${expected} but received ${describeReceived(received)}.`
    );

const emptyIdentityIssue = (context: IssueContext, path: string): GhostContentIssue =>
    createContentIssue(
        context,
        'wrong-type',
        path,
        'string',
        `${path}: expected a non-empty string but received an empty string.`
    );

const createBatchShapeIssue = (): GhostContentIssue => ({
    kind: 'content',
    reason: 'invalid-shape',
    path: 'ghostContent',
    index: null,
    contentId: null,
    expected: 'array',
    message: 'ghostContent: expected array.'
});

const invalidShapeIssue = (
    context: IssueContext,
    path: string,
    expected: ExpectedValueType
): GhostContentIssue =>
    createContentIssue(context, 'invalid-shape', path, expected, `${path}: expected ${expected}.`);

const isFailedRead = <Value,>(read: ValueRead<Value>): read is FailedRead => !read.ok;

const readContentString = (
    raw: unknown,
    path: string,
    context: IssueContext
): ValueRead<string> => {
    if (raw === undefined || raw === null) {
        return {ok: false, issue: missingIssue(context, path)};
    }
    if (typeof raw !== 'string') {
        return {ok: false, issue: wrongTypeIssue(context, path, 'string', raw)};
    }

    return {ok: true, value: raw};
};

const readIdentityString = (
    raw: unknown,
    path: string,
    context: IssueContext
): ValueRead<string> => {
    const read = readContentString(raw, path, context);
    if (read.ok && read.value === '') {
        return {ok: false, issue: emptyIdentityIssue(context, path)};
    }

    return read;
};

const readScalar = (
    kind: Exclude<ProjectionValueKind, 'relations'>,
    raw: unknown,
    path: string,
    context: IssueContext
): ValueRead<unknown> => {
    if (raw === undefined || raw === null) {
        return {ok: true, value: null};
    }
    if (typeof raw !== kind) {
        return {ok: false, issue: wrongTypeIssue(context, path, kind, raw)};
    }

    return {ok: true, value: raw};
};

const readRelations = (
    raw: unknown,
    path: string,
    context: IssueContext
): ValueRead<readonly Readonly<{name: string; slug: string}>[]> => {
    if (raw === undefined || raw === null) {
        return {ok: true, value: []};
    }
    if (!Array.isArray(raw)) {
        return {ok: false, issue: wrongTypeIssue(context, path, 'array', raw)};
    }

    const relations: Array<{name: string; slug: string}> = [];
    for (const [index, element] of raw.entries()) {
        const elementPath = `${path}[${index}]`;
        if (!isPlainObject(element)) {
            return {ok: false, issue: wrongTypeIssue(context, elementPath, 'object', element)};
        }

        const {name, slug} = element;
        if (typeof name !== 'string') {
            return {
                ok: false,
                issue: wrongTypeIssue(context, `${elementPath}.name`, 'string', name)
            };
        }
        if (typeof slug !== 'string') {
            return {
                ok: false,
                issue: wrongTypeIssue(context, `${elementPath}.slug`, 'string', slug)
            };
        }

        relations.push({name, slug});
    }

    return {ok: true, value: relations};
};

const readSource = (
    item: Readonly<Record<string, unknown>>,
    source: OptionalProjectionSource,
    context: IssueContext
): ValueRead<unknown> => {
    const descriptor: ProjectionSourceDescriptor = PROJECTION_SOURCES[source];
    const path = `${context.path}.${descriptor.ghostKey}`;
    const raw = item[descriptor.ghostKey];
    if (descriptor.kind === 'relations') {
        return readRelations(raw, path, context);
    }

    return readScalar(descriptor.kind, raw, path, context);
};

/**
 * Every enabled projection source, then every ranking source that no projection field already
 * reads, so a source feeding both a projection field and a ranking sibling is read once.
 */
const collectEnabledSources = (policy: ResolvedPolicy): readonly OptionalProjectionSource[] => {
    const sources: OptionalProjectionSource[] = [];
    for (const field of [...policy.fields, ...policy.rankingFields]) {
        if (!sources.includes(field.source)) {
            sources.push(field.source);
        }
    }

    return sources;
};

const readEnabledSources = (
    item: Readonly<Record<string, unknown>>,
    policy: ResolvedPolicy,
    context: IssueContext
): Readonly<{
    values: ReadonlyMap<OptionalProjectionSource, unknown>;
    issues: readonly GhostContentIssue[];
}> => {
    const values = new Map<OptionalProjectionSource, unknown>();
    const issues: GhostContentIssue[] = [];
    for (const source of collectEnabledSources(policy)) {
        const read = readSource(item, source, context);
        if (isFailedRead(read)) {
            issues.push(read.issue);
            continue;
        }
        values.set(source, read.value);
    }

    return {values, issues};
};

const projectValues = (
    fields: readonly Readonly<{source: OptionalProjectionSource; outputKey: string}>[],
    values: ReadonlyMap<OptionalProjectionSource, unknown>
): Readonly<Record<string, unknown>> => {
    const projected: Record<string, unknown> = {};
    for (const field of fields) {
        projected[field.outputKey] = values.get(field.source);
    }

    return projected;
};

const readContentId = (item: Readonly<Record<string, unknown>>): string | null => {
    return typeof item.id === 'string' && item.id !== '' ? item.id : null;
};

const prepareItem = (value: unknown, index: number, policy: ResolvedPolicy): ItemPreparation => {
    const path = `ghostContent[${index}]`;
    if (!isPlainObject(value)) {
        const context: IssueContext = {index, contentId: null, path};
        return {kind: 'issues', issues: [invalidShapeIssue(context, path, 'object')]};
    }

    const context: IssueContext = {index, contentId: readContentId(value), path};

    const slug = readIdentityString(value.slug, `${path}.slug`, context);
    if (isFailedRead(slug)) {
        return {kind: 'issues', issues: [slug.issue]};
    }
    if (policy.ignoreSlugs.includes(slug.value)) {
        return {kind: 'ignored'};
    }

    const id = readIdentityString(value.id, `${path}.id`, context);
    const url = readContentString(value.url, `${path}.url`, context);
    const title = readContentString(value.title, `${path}.title`, context);
    const html = readContentString(value.html, `${path}.html`, context);
    const enabled = readEnabledSources(value, policy, context);

    // The explicit chain is what narrows `id`, `url`, `title`, and `html` to successful reads
    // for the return below; the `filter` only collects the issues in canonical order. Collapsing
    // the two into one expression loses the narrowing.
    if (
        isFailedRead(id) ||
        isFailedRead(url) ||
        isFailedRead(title) ||
        isFailedRead(html) ||
        enabled.issues.length > 0
    ) {
        const required = [id, url, title, html].filter(isFailedRead).map(read => read.issue);
        return {kind: 'issues', issues: [...required, ...enabled.issues]};
    }

    return {
        kind: 'content',
        content: {
            index,
            id: id.value,
            slug: slug.value,
            url: url.value,
            title: title.value,
            html: html.value,
            projected: projectValues(policy.fields, enabled.values),
            rankingSiblings: projectValues(policy.rankingFields, enabled.values)
        }
    };
};

/**
 * Validates the whole batch in input order and prepares the content that survives ignored-slug
 * exclusion. Validation and projection share one reader, so a prepared item always projects the
 * values that were validated.
 */
export const prepareGhostContent = (
    ghostContent: unknown,
    policy: ResolvedPolicy
): ContentPreparation => {
    if (!Array.isArray(ghostContent)) {
        return {ok: false, issues: [createBatchShapeIssue()]};
    }

    const contents: PreparedContent[] = [];
    const issues: GhostContentIssue[] = [];
    for (const [index, item] of ghostContent.entries()) {
        const prepared = prepareItem(item, index, policy);
        if (prepared.kind === 'issues') {
            issues.push(...prepared.issues);
            continue;
        }
        if (prepared.kind === 'content') {
            contents.push(prepared.content);
        }
    }

    if (issues.length > 0) {
        return {ok: false, issues};
    }

    return {ok: true, contents};
};
