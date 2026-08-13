import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const fixtureDirectory = dirname(fileURLToPath(import.meta.url));
const readJson = async name => JSON.parse(await readFile(join(fixtureDirectory, name), 'utf8'));

const [page1, page2, renderProof] = await Promise.all([
    readJson('posts-page-1.json'),
    readJson('posts-page-2.json'),
    readJson('ghost-renderer-proof.json')
]);

assert.deepEqual(page1.meta.pagination, {
    page: 1,
    limit: 100,
    pages: 2,
    total: 101,
    next: 2,
    prev: null
});
assert.deepEqual(page2.meta.pagination, {
    page: 2,
    limit: 100,
    pages: 2,
    total: 101,
    next: null,
    prev: 1
});
assert.equal(page1.posts.length, 100);
assert.equal(page2.posts.length, 1);

const posts = [...page1.posts, ...page2.posts];
assert.equal(posts.length, 101);
assert.equal(new Set(posts.map(post => post.id)).size, 101);
assert.equal(new Set(posts.map(post => post.uuid)).size, 101);

for (const post of posts) {
    assert.match(post.id, /^[0-9a-f]{24}$/);
    assert.match(post.uuid, /^00000000-0000-4000-8000-\d{12}$/);
    assert.equal(post.url, `http://127.0.0.1:23689/${post.slug}/`);
    assert.ok(Array.isArray(post.tags));
    assert.ok(Array.isArray(post.authors));
    assert.equal(post.authors.length, 1);
    assert.equal(post.authors[0].name, 'Algolia Fixture Author');
}

const oldest = page2.posts[0];
assert.equal(oldest.slug, 'synthetic-ghost-post-001');
assert.equal(oldest.uuid, '00000000-0000-4000-8000-000000000001');
assert.equal(oldest.published_at, '2026-01-01T00:00:00.000+00:00');

const ignored = posts.find(post => post.slug === 'ignored-by-config');
assert.ok(ignored);

const noTags = posts.find(post => post.slug === 'no-tags-no-feature-image');
assert.ok(noTags);
assert.deepEqual(noTags.tags, []);
assert.equal(noTags.primary_tag, null);
assert.equal(noTags.feature_image, null);

const rendered = posts.find(post => post.slug === 'ghost-6-rendered-content-contract');
assert.ok(rendered);
assert.equal(rendered.uuid, '00000000-0000-4000-8000-000000000101');
assert.equal(rendered.published_at, '2026-01-01T01:40:00.000+00:00');
assert.deepEqual(rendered.tags.map(tag => tag.name), ['Ghost 6', 'Acceptance']);

const expectedRenderedHtml = '<h2 id="fixture-overview">Fixture overview</h2><p>Rendered by Ghost 6 from synthetic source HTML with an <a href="http://127.0.0.1:23689/internal-destination/">internal link</a>.</p><h3 id="structured-blocks">Structured blocks</h3><ul><li>First deterministic item</li><li>Second deterministic item</li></ul><pre><code class="language-js">const fixture = true;\nconsole.log(fixture);</code></pre><figure class="kg-card kg-image-card"><img src="https://fixture.invalid/images/content-card.png" class="kg-image" alt="Synthetic fixture image" loading="lazy" width="1200" height="630"></figure><p>End of the rendered acceptance fixture.</p>';
assert.equal(rendered.html, expectedRenderedHtml);

assert.equal(renderProof.ghost_version, '6.57.1');
assert.equal(renderProof.slug, 'ghost-6-rendered-content-contract');
assert.equal(renderProof.uuid, '00000000-0000-4000-8000-000000000101');
assert.equal(renderProof.html, expectedRenderedHtml);
const lexical = JSON.parse(renderProof.lexical);
assert.deepEqual(
    lexical.root.children.map(node => node.type),
    ['extended-heading', 'paragraph', 'extended-heading', 'list', 'codeblock', 'image', 'paragraph']
);

console.log(JSON.stringify({
    posts: posts.length,
    page1: page1.posts.length,
    page2: page2.posts.length,
    next: page1.meta.pagination.next,
    tagsAndAuthorsIncluded: true,
    renderedLexicalTypes: lexical.root.children.map(node => node.type),
    ignoredSlug: ignored.slug,
    noTagsSlug: noTags.slug
}, null, 2));
