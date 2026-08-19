import { isPlainObject } from './policy.mjs';
/**
 * The single projection-source descriptor table. Content validation and value projection read
 * it through the same reader, so a Ghost source can never be validated as one type and
 * projected as another.
 */
const PROJECTION_SOURCES = {
    image: { ghostKey: 'feature_image', kind: 'string' },
    tags: { ghostKey: 'tags', kind: 'relations' },
    authors: { ghostKey: 'authors', kind: 'relations' },
    excerpt: { ghostKey: 'excerpt', kind: 'string' },
    custom_excerpt: { ghostKey: 'custom_excerpt', kind: 'string' },
    feature_image_alt: { ghostKey: 'feature_image_alt', kind: 'string' },
    feature_image_caption: { ghostKey: 'feature_image_caption', kind: 'string' },
    canonical_url: { ghostKey: 'canonical_url', kind: 'string' },
    featured: { ghostKey: 'featured', kind: 'boolean' },
    visibility: { ghostKey: 'visibility', kind: 'string' },
    created_at: { ghostKey: 'created_at', kind: 'string' },
    updated_at: { ghostKey: 'updated_at', kind: 'string' },
    published_at: { ghostKey: 'published_at', kind: 'string' },
    reading_time: { ghostKey: 'reading_time', kind: 'number' }
};
const describeReceived = (value) => {
    if (value === null) {
        return 'null';
    }
    if (Array.isArray(value)) {
        return 'array';
    }
    return typeof value;
};
const createContentIssue = (context, reason, path, expected, message) => ({
    kind: 'content',
    reason,
    path,
    index: context.index,
    contentId: context.contentId,
    expected,
    message
});
const missingIssue = (context, path) => createContentIssue(context, 'missing', path, 'string', `${path}: required Ghost field is missing.`);
const wrongTypeIssue = (context, path, expected, received) => createContentIssue(context, 'wrong-type', path, expected, `${path}: expected ${expected} but received ${describeReceived(received)}.`);
const emptyIdentityIssue = (context, path) => createContentIssue(context, 'wrong-type', path, 'string', `${path}: expected a non-empty string but received an empty string.`);
const createBatchShapeIssue = () => ({
    kind: 'content',
    reason: 'invalid-shape',
    path: 'ghostContent',
    index: null,
    contentId: null,
    expected: 'array',
    message: 'ghostContent: expected array.'
});
const invalidShapeIssue = (context, path, expected) => createContentIssue(context, 'invalid-shape', path, expected, `${path}: expected ${expected}.`);
const isFailedRead = (read) => !read.ok;
const readContentString = (raw, path, context) => {
    if (raw === undefined || raw === null) {
        return { ok: false, issue: missingIssue(context, path) };
    }
    if (typeof raw !== 'string') {
        return { ok: false, issue: wrongTypeIssue(context, path, 'string', raw) };
    }
    return { ok: true, value: raw };
};
const readIdentityString = (raw, path, context) => {
    const read = readContentString(raw, path, context);
    if (read.ok && read.value === '') {
        return { ok: false, issue: emptyIdentityIssue(context, path) };
    }
    return read;
};
const readScalar = (kind, raw, path, context) => {
    if (raw === undefined || raw === null) {
        return { ok: true, value: null };
    }
    if (typeof raw !== kind) {
        return { ok: false, issue: wrongTypeIssue(context, path, kind, raw) };
    }
    return { ok: true, value: raw };
};
const readRelations = (raw, path, context) => {
    if (raw === undefined || raw === null) {
        return { ok: true, value: [] };
    }
    if (!Array.isArray(raw)) {
        return { ok: false, issue: wrongTypeIssue(context, path, 'array', raw) };
    }
    const relations = [];
    for (const [index, element] of raw.entries()) {
        const elementPath = `${path}[${index}]`;
        if (!isPlainObject(element)) {
            return { ok: false, issue: wrongTypeIssue(context, elementPath, 'object', element) };
        }
        const { name, slug } = element;
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
        relations.push({ name, slug });
    }
    return { ok: true, value: relations };
};
const readSource = (item, source, context) => {
    const descriptor = PROJECTION_SOURCES[source];
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
const collectEnabledSources = (policy) => {
    const sources = [];
    for (const field of [...policy.fields, ...policy.rankingFields]) {
        if (!sources.includes(field.source)) {
            sources.push(field.source);
        }
    }
    return sources;
};
const readEnabledSources = (item, policy, context) => {
    const values = new Map();
    const issues = [];
    for (const source of collectEnabledSources(policy)) {
        const read = readSource(item, source, context);
        if (isFailedRead(read)) {
            issues.push(read.issue);
            continue;
        }
        values.set(source, read.value);
    }
    return { values, issues };
};
const projectValues = (fields, values) => {
    const projected = {};
    for (const field of fields) {
        projected[field.outputKey] = values.get(field.source);
    }
    return projected;
};
const readContentId = (item) => {
    return typeof item.id === 'string' && item.id !== '' ? item.id : null;
};
const prepareItem = (value, index, policy) => {
    const path = `ghostContent[${index}]`;
    if (!isPlainObject(value)) {
        const context = { index, contentId: null, path };
        return { kind: 'issues', issues: [invalidShapeIssue(context, path, 'object')] };
    }
    const context = { index, contentId: readContentId(value), path };
    const slug = readIdentityString(value.slug, `${path}.slug`, context);
    if (isFailedRead(slug)) {
        return { kind: 'issues', issues: [slug.issue] };
    }
    if (policy.ignoreSlugs.includes(slug.value)) {
        return { kind: 'ignored' };
    }
    const id = readIdentityString(value.id, `${path}.id`, context);
    const url = readContentString(value.url, `${path}.url`, context);
    const title = readContentString(value.title, `${path}.title`, context);
    const html = readContentString(value.html, `${path}.html`, context);
    const enabled = readEnabledSources(value, policy, context);
    // The explicit chain is what narrows `id`, `url`, `title`, and `html` to successful reads
    // for the return below; the `filter` only collects the issues in canonical order. Collapsing
    // the two into one expression loses the narrowing.
    if (isFailedRead(id) ||
        isFailedRead(url) ||
        isFailedRead(title) ||
        isFailedRead(html) ||
        enabled.issues.length > 0) {
        const required = [id, url, title, html].filter(isFailedRead).map(read => read.issue);
        return { kind: 'issues', issues: [...required, ...enabled.issues] };
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
export const prepareGhostContent = (ghostContent, policy) => {
    if (!Array.isArray(ghostContent)) {
        return { ok: false, issues: [createBatchShapeIssue()] };
    }
    const contents = [];
    const issues = [];
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
        return { ok: false, issues };
    }
    return { ok: true, contents };
};
//# sourceMappingURL=projection.mjs.map