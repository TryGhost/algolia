import {describe, expect, it} from 'vitest';

import {fragmentTransformer, transformToAlgoliaObject} from '../src/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));

type TestPost = {
    id: string;
    slug: string;
    url: string;
    html: string;
    feature_image: string | null;
    title: string;
    tags?: readonly Readonly<Record<string, unknown>>[] | null;
    authors?: readonly Readonly<Record<string, unknown>>[] | null;
    [key: string]: unknown;
};

const readFixture = (fileName: string): string => {
    return fs.readFileSync(path.join(testDirectory, `fixtures`, `${fileName}.html`), {
        encoding: `utf8`
    });
};

const createPost = (overrides: Partial<TestPost> = {}): TestPost => ({
    id: 'post-1',
    slug: 'getting-started',
    url: 'https://example.com/getting-started/',
    html: '<p>Introduction.</p>',
    feature_image: 'https://example.com/getting-started.jpg',
    title: 'Getting started',
    tags: [],
    authors: [],
    ...overrides
});

const fragmentPosts = (posts: readonly TestPost[]) => {
    return transformToAlgoliaObject(posts).reduce(fragmentTransformer, []);
};

describe('Algolia fragmenter public contracts', function () {
    it('selects the exact Algolia record shape and projects tag and author relations', function () {
        const posts = [
            createPost({
                tags: [{id: 'tag-id', name: 'Guide', slug: 'guide', description: 'not indexed'}],
                authors: [{id: 'author-id', name: 'Ada Lovelace', slug: 'ada', bio: 'not indexed'}],
                excerpt: 'not indexed'
            })
        ];

        expect(transformToAlgoliaObject(posts)).toEqual([
            {
                objectID: 'post-1',
                slug: 'getting-started',
                url: 'https://example.com/getting-started/',
                html: '<p>Introduction.</p>',
                image: 'https://example.com/getting-started.jpg',
                title: 'Getting started',
                tags: [{name: 'Guide', slug: 'guide'}],
                authors: [{name: 'Ada Lovelace', slug: 'ada'}]
            }
        ]);
    });

    it('omits posts whose slug is ignored', function () {
        const posts = [
            createPost({id: 'ignored-id', slug: 'ignored'}),
            createPost({id: 'kept-id', slug: 'kept', title: 'Kept post'})
        ];

        expect(transformToAlgoliaObject(posts, ['ignored'])).toEqual([
            {
                objectID: 'kept-id',
                slug: 'kept',
                url: 'https://example.com/getting-started/',
                html: '<p>Introduction.</p>',
                image: 'https://example.com/getting-started.jpg',
                title: 'Kept post',
                tags: [],
                authors: []
            }
        ]);
    });

    it('normalizes null and missing relations to empty projections', function () {
        const postWithMissingRelations = createPost({id: 'missing-relations'});
        delete postWithMissingRelations.tags;
        delete postWithMissingRelations.authors;

        const records = transformToAlgoliaObject([
            createPost({id: 'null-relations', tags: null, authors: null}),
            postWithMissingRelations
        ]);

        expect(records.map(({objectID, tags, authors}) => ({objectID, tags, authors}))).toEqual([
            {objectID: 'null-relations', tags: [], authors: []},
            {objectID: 'missing-relations', tags: [], authors: []}
        ]);
    });

    it('creates one exact record for headingless content', function () {
        const records = fragmentPosts([
            createPost({
                id: 'headless',
                slug: 'headless',
                url: '/headless/',
                html: '<p>First <em>paragraph</em>.</p><p>Second paragraph.</p>',
                feature_image: null,
                title: 'Headless'
            })
        ]);

        expect(records).toEqual([
            {
                objectID: 'headless_0',
                slug: 'headless',
                url: '/headless/',
                html: '<p>First <em>paragraph</em>.</p><p>Second paragraph.</p>',
                image: null,
                title: 'Headless',
                tags: [],
                authors: [],
                headings: [],
                anchor: null,
                customRanking: {position: 0, heading: 100}
            }
        ]);
    });

    it('preserves text but drops preformatted markup when merging a heading fragment', function () {
        const records = fragmentPosts([
            createPost({
                id: 'preformatted',
                slug: 'preformatted',
                url: '/preformatted/',
                html: '<h2 id="commands">Commands</h2><p>Run:</p><pre><code>npm install ghost</code></pre><p>Then continue.</p>',
                feature_image: null,
                title: 'Preformatted'
            })
        ]);

        expect(records).toEqual([
            {
                objectID: 'preformatted_0',
                slug: 'preformatted',
                url: '/preformatted/#commands',
                html: '<p>Run:</p> npm install ghost<p>Then continue.</p>',
                image: null,
                title: 'Preformatted',
                tags: [],
                authors: [],
                headings: ['Commands'],
                anchor: 'commands',
                customRanking: {position: 0, heading: 80}
            }
        ]);
    });

    it('accumulates ordered fragments from every post', function () {
        const records = fragmentPosts([
            createPost({
                id: 'first',
                slug: 'first',
                url: '/first/',
                html: '<p>First post.</p>',
                title: 'First'
            }),
            createPost({
                id: 'second',
                slug: 'second',
                url: '/second/',
                html: '<p>Second post.</p>',
                title: 'Second'
            })
        ]);

        expect(records.map(({objectID, slug, html}) => ({objectID, slug, html}))).toEqual([
            {objectID: 'first_0', slug: 'first', html: '<p>First post.</p>'},
            {objectID: 'second_0', slug: 'second', html: '<p>Second post.</p>'}
        ]);
    });

    it("keeps every generated record below Algolia's object size limit", function () {
        const records = fragmentPosts([
            createPost({
                html: readFixture('massive-example')
            })
        ]);

        records.forEach(record => {
            expect(JSON.stringify(record).length).toBeLessThan(10000);
        });
    });
});
