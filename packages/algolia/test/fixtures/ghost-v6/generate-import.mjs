import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const outputDirectory = dirname(fileURLToPath(import.meta.url));
const postCount = 101;
const tagIds = {
    ghost6: '100000000000000000000001',
    acceptance: '100000000000000000000002'
};

function postId(index) {
    return index.toString(16).padStart(24, '0');
}

function postUuid(index) {
    return `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`;
}

function timestamp(index) {
    return new Date(Date.UTC(2026, 0, 1, 0, index, 0)).toISOString();
}

function sourcePost(index) {
    const id = postId(index + 1);
    const date = timestamp(index);
    let title = `Synthetic Ghost post ${String(index + 1).padStart(3, '0')}`;
    let slug = `synthetic-ghost-post-${String(index + 1).padStart(3, '0')}`;
    let html = `<p>Deterministic synthetic content for pagination record ${index + 1}.</p>`;
    let featureImage = index % 3 === 0
        ? `https://fixture.invalid/images/feature-${String(index + 1).padStart(3, '0')}.jpg`
        : null;

    if (index === postCount - 3) {
        title = 'Ignored by Algolia fixture configuration';
        slug = 'ignored-by-config';
        html = '<p>This real Ghost Content API record proves configured slug exclusion.</p>';
    }

    if (index === postCount - 2) {
        title = 'No tags and no feature image';
        slug = 'no-tags-no-feature-image';
        html = '<p>This record intentionally has no tags and a null feature image.</p>';
        featureImage = null;
    }

    if (index === postCount - 1) {
        title = 'Ghost 6 rendered content contract';
        slug = 'ghost-6-rendered-content-contract';
        html = [
            '<h2>Fixture overview</h2>',
            '<p>Rendered by Ghost 6 from synthetic source HTML with an <a href="/internal-destination/">internal link</a>.</p>',
            '<h3>Structured blocks</h3>',
            '<ul><li>First deterministic item</li><li>Second deterministic item</li></ul>',
            '<pre><code class="language-js">const fixture = true;\nconsole.log(fixture);</code></pre>',
            '<figure class="kg-card kg-image-card"><img src="https://fixture.invalid/images/content-card.png" alt="Synthetic fixture image" width="1200" height="630"></figure>',
            '<p>End of the rendered acceptance fixture.</p>'
        ].join('');
        featureImage = 'https://fixture.invalid/images/ghost-6-contract.jpg';
    }

    return {
        id,
        uuid: postUuid(index + 1),
        title,
        slug,
        html,
        comment_id: `fixture-comment-${String(index + 1).padStart(3, '0')}`,
        feature_image: featureImage,
        featured: false,
        type: 'post',
        status: 'published',
        visibility: 'public',
        created_at: date,
        updated_at: date,
        published_at: date
    };
}

const posts = Array.from({length: postCount}, (_, index) => sourcePost(index));
const postsAuthors = posts.map((post, index) => ({
    id: `3${(index + 1).toString(16).padStart(23, '0')}`,
    post_id: post.id,
    author_id: 'owner-fallback',
    sort_order: 0
}));
const postsTags = [];

for (const [index, post] of posts.entries()) {
    if (post.slug === 'no-tags-no-feature-image') {
        continue;
    }

    postsTags.push({
        id: `4${(postsTags.length + 1).toString(16).padStart(23, '0')}`,
        post_id: post.id,
        tag_id: tagIds.ghost6,
        sort_order: 0
    });

    if (index % 2 === 0 || post.slug === 'ghost-6-rendered-content-contract') {
        postsTags.push({
            id: `5${(postsTags.length + 1).toString(16).padStart(23, '0')}`,
            post_id: post.id,
            tag_id: tagIds.acceptance,
            sort_order: 1
        });
    }
}

const syntheticImport = {
    db: [{
        meta: {
            exported_on: Date.UTC(2026, 0, 1),
            version: '6.57.1'
        },
        data: {
            posts,
            posts_meta: [],
            tags: [
                {
                    id: tagIds.ghost6,
                    name: 'Ghost 6',
                    slug: 'ghost-6',
                    description: 'Synthetic Ghost 6 acceptance content',
                    visibility: 'public',
                    created_at: timestamp(0),
                    updated_at: timestamp(0)
                },
                {
                    id: tagIds.acceptance,
                    name: 'Acceptance',
                    slug: 'acceptance',
                    description: 'Deterministic test fixture',
                    visibility: 'public',
                    created_at: timestamp(0),
                    updated_at: timestamp(0)
                }
            ],
            posts_tags: postsTags,
            users: [],
            posts_authors: postsAuthors
        }
    }]
};

await writeFile(
    join(outputDirectory, 'synthetic-import.json'),
    `${JSON.stringify(syntheticImport, null, 2)}\n`,
    {mode: 0o644}
);
