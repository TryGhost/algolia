import type {PolicyIssue, PolicyIssueReason} from './errors.mjs';

export type OptionalProjectionSource =
    | 'image'
    | 'tags'
    | 'authors'
    | 'excerpt'
    | 'custom_excerpt'
    | 'feature_image_alt'
    | 'feature_image_caption'
    | 'canonical_url'
    | 'featured'
    | 'visibility'
    | 'created_at'
    | 'updated_at'
    | 'published_at'
    | 'reading_time';

export type ProjectionField =
    | OptionalProjectionSource
    | Readonly<{
          source: OptionalProjectionSource;
          as: string;
      }>;

export type RankingSource = 'featured' | 'reading_time';

export type RankingField = Readonly<{
    source: RankingSource;
    as: string;
}>;

export type ContentProjection = Readonly<{
    fields: readonly ProjectionField[];
    customRanking?: readonly RankingField[];
}>;

export type CreateAlgoliaRecordsOptions = Readonly<{
    ignoreSlugs?: readonly string[];
    contentProjection?: ContentProjection;
}>;

export type ResolvedProjectionField = Readonly<{
    source: OptionalProjectionSource;
    outputKey: string;
}>;

export type ResolvedRankingField = Readonly<{
    source: RankingSource;
    outputKey: string;
}>;

export type ResolvedPolicy = Readonly<{
    ignoreSlugs: readonly string[];
    fields: readonly ResolvedProjectionField[];
    rankingFields: readonly ResolvedRankingField[];
}>;

export type PolicyResolution =
    | Readonly<{ok: true; policy: ResolvedPolicy}>
    | Readonly<{ok: false; issues: readonly PolicyIssue[]}>;

type AliasedFieldShape = Readonly<{source: string; alias: string}>;

type ProjectionFieldShape = Readonly<{source: string; alias: string | null}>;

type Resolution<Value> =
    | Readonly<{ok: true; value: Value}>
    | Readonly<{ok: false; issue: PolicyIssue}>;

type ResolvedProjection = Readonly<{
    fields: readonly ResolvedProjectionField[];
    rankingFields: readonly ResolvedRankingField[];
}>;

/**
 * Every canonical allowlist name. The `Record` keeps this set exhaustive: a source added to
 * `OptionalProjectionSource` without a name here fails to compile.
 */
const CANONICAL_SOURCE_NAMES: Readonly<Record<OptionalProjectionSource, true>> = {
    image: true,
    tags: true,
    authors: true,
    excerpt: true,
    custom_excerpt: true,
    feature_image_alt: true,
    feature_image_caption: true,
    canonical_url: true,
    featured: true,
    visibility: true,
    created_at: true,
    updated_at: true,
    published_at: true,
    reading_time: true
};

const RANKING_SOURCE_NAMES: Readonly<Record<RankingSource, true>> = {
    featured: true,
    reading_time: true
};

const DEFAULT_PROJECTION_SOURCES: readonly OptionalProjectionSource[] = [
    'image',
    'tags',
    'authors',
    'excerpt'
];

const PROTECTED_RECORD_FIELDS: readonly string[] = [
    'objectID',
    'slug',
    'url',
    'title',
    'html',
    'headings',
    'anchor'
];

const PROTECTED_RANKING_FIELDS: readonly string[] = ['heading', 'position'];

const PROTECTED_RANKING_OUTPUT_NAMES: readonly string[] = [
    ...PROTECTED_RECORD_FIELDS,
    ...PROTECTED_RANKING_FIELDS
];

const ALGOLIA_RESERVED_NAMES: readonly string[] = [
    '_highlightResult',
    '_snippetResult',
    '_rankingInfo',
    '_distinctSeqID',
    'distinctSeqId',
    '_tags',
    '_geoloc'
];

const RANKING_CONTAINER = 'customRanking';
const ALIAS_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/u;
const OPTIONS_PROPERTIES: readonly string[] = ['ignoreSlugs', 'contentProjection'];
const CONTENT_PROJECTION_PROPERTIES: readonly string[] = ['fields', 'customRanking'];
const PROJECTION_FIELD_PROPERTIES: readonly string[] = ['source', 'as'];

export const isPlainObject = (value: unknown): value is Record<string, unknown> => {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const isProjectionSource = (value: string): value is OptionalProjectionSource => {
    return Object.hasOwn(CANONICAL_SOURCE_NAMES, value);
};

const isRankingSource = (value: string): value is RankingSource => {
    return Object.hasOwn(RANKING_SOURCE_NAMES, value);
};

const createIssue = (reason: PolicyIssueReason, path: string, message: string): PolicyIssue => ({
    kind: 'policy',
    reason,
    path,
    message
});

const invalidShape = (path: string, expectedShape: string): PolicyIssue =>
    createIssue('invalid-shape', path, `${path}: expected ${expectedShape}.`);

const unknownProperty = (path: string, name: string): PolicyIssue =>
    createIssue('unknown-property', path, `${path}: unknown property "${name}".`);

const unknownSource = (path: string, value: string, kind: string): PolicyIssue =>
    createIssue('unknown-source', path, `${path}: "${value}" is not an allowed ${kind} source.`);

const repeatedSource = (path: string, source: string, kind: string): PolicyIssue =>
    createIssue(
        'repeated-source',
        path,
        `${path}: ${kind} source "${source}" is configured more than once.`
    );

const invalidAlias = (path: string, name: string): PolicyIssue =>
    createIssue(
        'invalid-alias',
        path,
        `${path}: alias "${name}" must match ^[A-Za-z][A-Za-z0-9_]*$.`
    );

const findUnknownProperties = (
    value: Readonly<Record<string, unknown>>,
    allowed: readonly string[]
): readonly string[] => {
    return Object.keys(value).filter(key => !allowed.includes(key));
};

const collectUnknownProperties = (
    value: Readonly<Record<string, unknown>>,
    allowed: readonly string[],
    path: string,
    issues: PolicyIssue[]
): void => {
    for (const key of findUnknownProperties(value, allowed)) {
        issues.push(unknownProperty(path, key));
    }
};

/**
 * Output names live in one policy-wide namespace shared by projection fields and ranking
 * siblings, so the checks below run in a fixed order for every configured output name.
 */
const findOutputCollision = (
    outputName: string,
    source: string,
    path: string,
    protectedNames: readonly string[],
    usedOutputNames: ReadonlySet<string>
): PolicyIssue | null => {
    if (protectedNames.includes(outputName)) {
        const owner = PROTECTED_RANKING_FIELDS.includes(outputName) ? 'ranking' : 'record';
        return createIssue(
            'protected-collision',
            path,
            `${path}: output name "${outputName}" is a protected ${owner} field.`
        );
    }
    if (outputName === RANKING_CONTAINER) {
        return createIssue(
            'container-collision',
            path,
            `${path}: output name "customRanking" is the package-owned ranking container.`
        );
    }
    if (ALGOLIA_RESERVED_NAMES.includes(outputName)) {
        return createIssue(
            'reserved-collision',
            path,
            `${path}: output name "${outputName}" is reserved by Algolia.`
        );
    }
    if (outputName !== source && isProjectionSource(outputName)) {
        return createIssue(
            'canonical-collision',
            path,
            `${path}: output name "${outputName}" impersonates a canonical allowlist field.`
        );
    }
    if (usedOutputNames.has(outputName)) {
        return createIssue(
            'repeated-output',
            path,
            `${path}: output name "${outputName}" is produced more than once.`
        );
    }

    return null;
};

const readAliasedFieldShape = (
    entry: unknown,
    path: string,
    expectedShape: string
): Resolution<AliasedFieldShape> => {
    if (!isPlainObject(entry)) {
        return {ok: false, issue: invalidShape(path, expectedShape)};
    }

    const [unknownKey] = findUnknownProperties(entry, PROJECTION_FIELD_PROPERTIES);
    if (unknownKey !== undefined) {
        return {ok: false, issue: unknownProperty(path, unknownKey)};
    }
    if (typeof entry.source !== 'string' || typeof entry.as !== 'string') {
        return {ok: false, issue: invalidShape(path, 'a {source, as} object of strings')};
    }

    return {ok: true, value: {source: entry.source, alias: entry.as}};
};

const readProjectionFieldShape = (
    entry: unknown,
    path: string
): Resolution<ProjectionFieldShape> => {
    if (typeof entry === 'string') {
        return {ok: true, value: {source: entry, alias: null}};
    }

    return readAliasedFieldShape(entry, path, 'a projection source name or a {source, as} object');
};

const resolveProjectionField = (
    entry: unknown,
    path: string,
    usedSources: Set<string>,
    usedOutputNames: Set<string>
): Resolution<ResolvedProjectionField> => {
    const shape = readProjectionFieldShape(entry, path);
    if (!shape.ok) {
        return shape;
    }

    const {source, alias} = shape.value;
    if (!isProjectionSource(source)) {
        return {ok: false, issue: unknownSource(path, source, 'projection')};
    }
    if (usedSources.has(source)) {
        return {ok: false, issue: repeatedSource(path, source, 'projection')};
    }

    const outputPath = alias === null ? path : `${path}.as`;
    if (alias !== null && !ALIAS_PATTERN.test(alias)) {
        return {ok: false, issue: invalidAlias(outputPath, alias)};
    }

    const outputKey = alias ?? source;
    const collision = findOutputCollision(
        outputKey,
        source,
        outputPath,
        PROTECTED_RECORD_FIELDS,
        usedOutputNames
    );
    if (collision !== null) {
        return {ok: false, issue: collision};
    }

    usedSources.add(source);
    usedOutputNames.add(outputKey);
    return {ok: true, value: {source, outputKey}};
};

const resolveRankingField = (
    entry: unknown,
    path: string,
    usedSources: Set<string>,
    usedOutputNames: Set<string>
): Resolution<ResolvedRankingField> => {
    const shape = readAliasedFieldShape(entry, path, 'a {source, as} object');
    if (!shape.ok) {
        return shape;
    }

    const {source, alias} = shape.value;
    if (!isRankingSource(source)) {
        return {ok: false, issue: unknownSource(path, source, 'ranking')};
    }
    if (usedSources.has(source)) {
        return {ok: false, issue: repeatedSource(path, source, 'ranking')};
    }

    const outputPath = `${path}.as`;
    if (!ALIAS_PATTERN.test(alias)) {
        return {ok: false, issue: invalidAlias(outputPath, alias)};
    }

    const collision = findOutputCollision(
        alias,
        source,
        outputPath,
        PROTECTED_RANKING_OUTPUT_NAMES,
        usedOutputNames
    );
    if (collision !== null) {
        return {ok: false, issue: collision};
    }

    usedSources.add(source);
    usedOutputNames.add(alias);
    return {ok: true, value: {source, outputKey: alias}};
};

/**
 * Resolves one configured list. Sources are unique per list, while output names are checked
 * against the policy-wide namespace the caller owns.
 */
const resolveEntries = <Field,>(
    entries: readonly unknown[],
    listPath: string,
    usedOutputNames: Set<string>,
    issues: PolicyIssue[],
    resolveEntry: (
        entry: unknown,
        path: string,
        usedSources: Set<string>,
        usedOutputNames: Set<string>
    ) => Resolution<Field>
): readonly Field[] => {
    const usedSources = new Set<string>();
    const fields: Field[] = [];
    for (const [index, entry] of entries.entries()) {
        const resolved = resolveEntry(entry, `${listPath}[${index}]`, usedSources, usedOutputNames);
        if (!resolved.ok) {
            issues.push(resolved.issue);
            continue;
        }
        fields.push(resolved.value);
    }

    return fields;
};

const resolveFields = (
    value: unknown,
    usedOutputNames: Set<string>,
    issues: PolicyIssue[]
): readonly ResolvedProjectionField[] => {
    if (!Array.isArray(value)) {
        issues.push(invalidShape('contentProjection.fields', 'an array of projection fields'));
        return [];
    }

    return resolveEntries(
        value,
        'contentProjection.fields',
        usedOutputNames,
        issues,
        resolveProjectionField
    );
};

const resolveRankingFields = (
    value: unknown,
    usedOutputNames: Set<string>,
    issues: PolicyIssue[]
): readonly ResolvedRankingField[] => {
    if (value === undefined) {
        return [];
    }
    if (!Array.isArray(value)) {
        issues.push(invalidShape('contentProjection.customRanking', 'an array of ranking fields'));
        return [];
    }

    return resolveEntries(
        value,
        'contentProjection.customRanking',
        usedOutputNames,
        issues,
        resolveRankingField
    );
};

const createDefaultProjection = (): ResolvedProjection => ({
    fields: DEFAULT_PROJECTION_SOURCES.map(source => ({source, outputKey: source})),
    rankingFields: []
});

const resolveContentProjection = (value: unknown, issues: PolicyIssue[]): ResolvedProjection => {
    if (value === undefined) {
        return createDefaultProjection();
    }
    if (!isPlainObject(value)) {
        issues.push(invalidShape('contentProjection', 'an object'));
        return {fields: [], rankingFields: []};
    }

    collectUnknownProperties(value, CONTENT_PROJECTION_PROPERTIES, 'contentProjection', issues);
    const usedOutputNames = new Set<string>();

    return {
        fields: resolveFields(value.fields, usedOutputNames, issues),
        rankingFields: resolveRankingFields(value.customRanking, usedOutputNames, issues)
    };
};

const resolveIgnoreSlugs = (value: unknown, issues: PolicyIssue[]): readonly string[] => {
    if (value === undefined) {
        return [];
    }
    if (!Array.isArray(value)) {
        issues.push(invalidShape('ignoreSlugs', 'an array of strings'));
        return [];
    }

    const slugs: string[] = [];
    for (const [index, entry] of value.entries()) {
        if (typeof entry !== 'string') {
            issues.push(invalidShape(`ignoreSlugs[${index}]`, 'a string'));
            continue;
        }
        slugs.push(entry);
    }

    return slugs;
};

/**
 * Validates caller options before any Ghost content is inspected and returns the policy the
 * projection, ranking, and record stages read. Every policy issue is collected in declaration
 * order rather than stopping at the first one.
 */
export const resolvePolicy = (options: unknown): PolicyResolution => {
    if (options === undefined) {
        const projection = createDefaultProjection();
        return {ok: true, policy: {ignoreSlugs: [], ...projection}};
    }
    if (!isPlainObject(options)) {
        return {ok: false, issues: [invalidShape('options', 'an object')]};
    }

    const issues: PolicyIssue[] = [];
    collectUnknownProperties(options, OPTIONS_PROPERTIES, 'options', issues);
    const ignoreSlugs = resolveIgnoreSlugs(options.ignoreSlugs, issues);
    const projection = resolveContentProjection(options.contentProjection, issues);

    if (issues.length > 0) {
        return {ok: false, issues};
    }

    return {ok: true, policy: {ignoreSlugs, ...projection}};
};
