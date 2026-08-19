/**
 * Every canonical allowlist name. The `Record` keeps this set exhaustive: a source added to
 * `OptionalProjectionSource` without a name here fails to compile.
 */
const CANONICAL_SOURCE_NAMES = {
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
const RANKING_SOURCE_NAMES = {
    featured: true,
    reading_time: true
};
const DEFAULT_PROJECTION_SOURCES = [
    'image',
    'tags',
    'authors',
    'excerpt'
];
const PROTECTED_RECORD_FIELDS = [
    'objectID',
    'slug',
    'url',
    'title',
    'html',
    'headings',
    'anchor'
];
const PROTECTED_RANKING_FIELDS = ['heading', 'position'];
const PROTECTED_RANKING_OUTPUT_NAMES = [
    ...PROTECTED_RECORD_FIELDS,
    ...PROTECTED_RANKING_FIELDS
];
const ALGOLIA_RESERVED_NAMES = [
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
const OPTIONS_PROPERTIES = ['ignoreSlugs', 'contentProjection'];
const CONTENT_PROJECTION_PROPERTIES = ['fields', 'customRanking'];
const PROJECTION_FIELD_PROPERTIES = ['source', 'as'];
export const isPlainObject = (value) => {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
};
const isProjectionSource = (value) => {
    return Object.hasOwn(CANONICAL_SOURCE_NAMES, value);
};
const isRankingSource = (value) => {
    return Object.hasOwn(RANKING_SOURCE_NAMES, value);
};
const createIssue = (reason, path, message) => ({
    kind: 'policy',
    reason,
    path,
    message
});
const invalidShape = (path, expectedShape) => createIssue('invalid-shape', path, `${path}: expected ${expectedShape}.`);
const unknownProperty = (path, name) => createIssue('unknown-property', path, `${path}: unknown property "${name}".`);
const unknownSource = (path, value, kind) => createIssue('unknown-source', path, `${path}: "${value}" is not an allowed ${kind} source.`);
const repeatedSource = (path, source, kind) => createIssue('repeated-source', path, `${path}: ${kind} source "${source}" is configured more than once.`);
const invalidAlias = (path, name) => createIssue('invalid-alias', path, `${path}: alias "${name}" must match ^[A-Za-z][A-Za-z0-9_]*$.`);
const findUnknownProperties = (value, allowed) => {
    return Object.keys(value).filter(key => !allowed.includes(key));
};
const collectUnknownProperties = (value, allowed, path, issues) => {
    for (const key of findUnknownProperties(value, allowed)) {
        issues.push(unknownProperty(path, key));
    }
};
/**
 * Output names live in one policy-wide namespace shared by projection fields and ranking
 * siblings, so the checks below run in a fixed order for every configured output name.
 */
const findOutputCollision = (outputName, source, path, protectedNames, usedOutputNames) => {
    if (protectedNames.includes(outputName)) {
        const owner = PROTECTED_RANKING_FIELDS.includes(outputName) ? 'ranking' : 'record';
        return createIssue('protected-collision', path, `${path}: output name "${outputName}" is a protected ${owner} field.`);
    }
    if (outputName === RANKING_CONTAINER) {
        return createIssue('container-collision', path, `${path}: output name "customRanking" is the package-owned ranking container.`);
    }
    if (ALGOLIA_RESERVED_NAMES.includes(outputName)) {
        return createIssue('reserved-collision', path, `${path}: output name "${outputName}" is reserved by Algolia.`);
    }
    if (outputName !== source && isProjectionSource(outputName)) {
        return createIssue('canonical-collision', path, `${path}: output name "${outputName}" impersonates a canonical allowlist field.`);
    }
    if (usedOutputNames.has(outputName)) {
        return createIssue('repeated-output', path, `${path}: output name "${outputName}" is produced more than once.`);
    }
    return null;
};
const readAliasedFieldShape = (entry, path, expectedShape) => {
    if (!isPlainObject(entry)) {
        return { ok: false, issue: invalidShape(path, expectedShape) };
    }
    const [unknownKey] = findUnknownProperties(entry, PROJECTION_FIELD_PROPERTIES);
    if (unknownKey !== undefined) {
        return { ok: false, issue: unknownProperty(path, unknownKey) };
    }
    if (typeof entry.source !== 'string' || typeof entry.as !== 'string') {
        return { ok: false, issue: invalidShape(path, 'a {source, as} object of strings') };
    }
    return { ok: true, value: { source: entry.source, alias: entry.as } };
};
const readProjectionFieldShape = (entry, path) => {
    if (typeof entry === 'string') {
        return { ok: true, value: { source: entry, alias: null } };
    }
    return readAliasedFieldShape(entry, path, 'a projection source name or a {source, as} object');
};
const resolveProjectionField = (entry, path, usedSources, usedOutputNames) => {
    const shape = readProjectionFieldShape(entry, path);
    if (!shape.ok) {
        return shape;
    }
    const { source, alias } = shape.value;
    if (!isProjectionSource(source)) {
        return { ok: false, issue: unknownSource(path, source, 'projection') };
    }
    if (usedSources.has(source)) {
        return { ok: false, issue: repeatedSource(path, source, 'projection') };
    }
    const outputPath = alias === null ? path : `${path}.as`;
    if (alias !== null && !ALIAS_PATTERN.test(alias)) {
        return { ok: false, issue: invalidAlias(outputPath, alias) };
    }
    const outputKey = alias ?? source;
    const collision = findOutputCollision(outputKey, source, outputPath, PROTECTED_RECORD_FIELDS, usedOutputNames);
    if (collision !== null) {
        return { ok: false, issue: collision };
    }
    usedSources.add(source);
    usedOutputNames.add(outputKey);
    return { ok: true, value: { source, outputKey } };
};
const resolveRankingField = (entry, path, usedSources, usedOutputNames) => {
    const shape = readAliasedFieldShape(entry, path, 'a {source, as} object');
    if (!shape.ok) {
        return shape;
    }
    const { source, alias } = shape.value;
    if (!isRankingSource(source)) {
        return { ok: false, issue: unknownSource(path, source, 'ranking') };
    }
    if (usedSources.has(source)) {
        return { ok: false, issue: repeatedSource(path, source, 'ranking') };
    }
    const outputPath = `${path}.as`;
    if (!ALIAS_PATTERN.test(alias)) {
        return { ok: false, issue: invalidAlias(outputPath, alias) };
    }
    const collision = findOutputCollision(alias, source, outputPath, PROTECTED_RANKING_OUTPUT_NAMES, usedOutputNames);
    if (collision !== null) {
        return { ok: false, issue: collision };
    }
    usedSources.add(source);
    usedOutputNames.add(alias);
    return { ok: true, value: { source, outputKey: alias } };
};
/**
 * Resolves one configured list. Sources are unique per list, while output names are checked
 * against the policy-wide namespace the caller owns.
 */
const resolveEntries = (entries, listPath, usedOutputNames, issues, resolveEntry) => {
    const usedSources = new Set();
    const fields = [];
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
const resolveFields = (value, usedOutputNames, issues) => {
    if (!Array.isArray(value)) {
        issues.push(invalidShape('contentProjection.fields', 'an array of projection fields'));
        return [];
    }
    return resolveEntries(value, 'contentProjection.fields', usedOutputNames, issues, resolveProjectionField);
};
const resolveRankingFields = (value, usedOutputNames, issues) => {
    if (value === undefined) {
        return [];
    }
    if (!Array.isArray(value)) {
        issues.push(invalidShape('contentProjection.customRanking', 'an array of ranking fields'));
        return [];
    }
    return resolveEntries(value, 'contentProjection.customRanking', usedOutputNames, issues, resolveRankingField);
};
const createDefaultProjection = () => ({
    fields: DEFAULT_PROJECTION_SOURCES.map(source => ({ source, outputKey: source })),
    rankingFields: []
});
const resolveContentProjection = (value, issues) => {
    if (value === undefined) {
        return createDefaultProjection();
    }
    if (!isPlainObject(value)) {
        issues.push(invalidShape('contentProjection', 'an object'));
        return { fields: [], rankingFields: [] };
    }
    collectUnknownProperties(value, CONTENT_PROJECTION_PROPERTIES, 'contentProjection', issues);
    const usedOutputNames = new Set();
    return {
        fields: resolveFields(value.fields, usedOutputNames, issues),
        rankingFields: resolveRankingFields(value.customRanking, usedOutputNames, issues)
    };
};
const resolveIgnoreSlugs = (value, issues) => {
    if (value === undefined) {
        return [];
    }
    if (!Array.isArray(value)) {
        issues.push(invalidShape('ignoreSlugs', 'an array of strings'));
        return [];
    }
    const slugs = [];
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
export const resolvePolicy = (options) => {
    if (options === undefined) {
        const projection = createDefaultProjection();
        return { ok: true, policy: { ignoreSlugs: [], ...projection } };
    }
    if (!isPlainObject(options)) {
        return { ok: false, issues: [invalidShape('options', 'an object')] };
    }
    const issues = [];
    collectUnknownProperties(options, OPTIONS_PROPERTIES, 'options', issues);
    const ignoreSlugs = resolveIgnoreSlugs(options.ignoreSlugs, issues);
    const projection = resolveContentProjection(options.contentProjection, issues);
    if (issues.length > 0) {
        return { ok: false, issues };
    }
    return { ok: true, policy: { ignoreSlugs, ...projection } };
};
//# sourceMappingURL=policy.mjs.map