import {Buffer} from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {
    createAlgoliaRecords,
    FragmenterError,
    fragmentTransformer,
    transformToAlgoliaObject,
    type AlgoliaRecord,
    type CreateAlgoliaRecordsOptions,
    type GhostContent,
    type GhostContentIssue,
    type RecordSizeIssue
} from '../src/index.mjs';

const MAX_RECORD_BYTES = 9999;
const testDirectory = path.dirname(fileURLToPath(import.meta.url));

type TestContent = Record<string, unknown>;

const readFixture = (fileName: string): string => {
    return fs.readFileSync(path.join(testDirectory, 'fixtures', `${fileName}.html`), {
        encoding: 'utf8'
    });
};

const createContent = (overrides: TestContent = {}): TestContent => ({
    id: 'post-1',
    slug: 'getting-started',
    url: 'https://example.com/getting-started/',
    title: 'Getting started',
    html: '<p>Introduction.</p>',
    ...overrides
});

/**
 * Every rejection case feeds deliberately invalid values through the public signature, so the
 * runtime validation rather than the compiler is what the assertions observe.
 */
const buildRecords = (ghostContent: unknown, options?: unknown): readonly AlgoliaRecord[] => {
    return createAlgoliaRecords(
        ghostContent as readonly GhostContent[],
        options as CreateAlgoliaRecordsOptions
    );
};

const bytesOf = (record: unknown): number => {
    return Buffer.byteLength(JSON.stringify(record), 'utf8');
};

const expectFragmenterError = (run: () => unknown): FragmenterError => {
    let caught: unknown;
    try {
        run();
    } catch (error) {
        caught = error;
    }

    expect(caught).toBeInstanceOf(FragmenterError);
    return caught as FragmenterError;
};

const describeIssues = (error: FragmenterError): readonly string[] => {
    return error.issues.map(issue => `${issue.reason} @ ${issue.path}`);
};

const contentIssuesOf = (error: FragmenterError): readonly GhostContentIssue[] => {
    return error.issues.filter(issue => issue.kind === 'content');
};

const sizeIssuesOf = (error: FragmenterError): readonly RecordSizeIssue[] => {
    return error.issues.filter(issue => issue.kind === 'size');
};

const paragraphs = (...texts: readonly string[]): string => {
    return texts.map(text => `<p>${text}</p>`).join('');
};

const ALL_PROJECTION_SOURCES = [
    'image',
    'tags',
    'authors',
    'excerpt',
    'custom_excerpt',
    'feature_image_alt',
    'feature_image_caption',
    'canonical_url',
    'featured',
    'visibility',
    'created_at',
    'updated_at',
    'published_at',
    'reading_time'
];

const createFullyProjectedContent = (overrides: TestContent = {}): TestContent =>
    createContent({
        feature_image: 'https://example.com/feature.jpg',
        tags: [{id: 'tag-id', name: 'Guide', slug: 'guide', description: 'not indexed'}],
        authors: [{id: 'author-id', name: 'Ada Lovelace', slug: 'ada', bio: 'not indexed'}],
        excerpt: 'Ghost computed excerpt',
        custom_excerpt: 'Custom excerpt',
        feature_image_alt: 'Feature image alt',
        feature_image_caption: 'Feature image caption',
        canonical_url: 'https://example.com/canonical/',
        featured: true,
        visibility: 'public',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-02T00:00:00.000Z',
        published_at: '2026-01-03T00:00:00.000Z',
        reading_time: 4,
        ...overrides
    });

describe('createAlgoliaRecords projection', () => {
    it('projects image, tags, authors, and excerpt by default', () => {
        const records = buildRecords([createFullyProjectedContent()]);

        expect(records).toEqual([
            {
                objectID: 'post-1_0',
                slug: 'getting-started',
                url: 'https://example.com/getting-started/',
                html: '<p>Introduction.</p>',
                title: 'Getting started',
                headings: [],
                anchor: null,
                image: 'https://example.com/feature.jpg',
                tags: [{name: 'Guide', slug: 'guide'}],
                authors: [{name: 'Ada Lovelace', slug: 'ada'}],
                excerpt: 'Ghost computed excerpt',
                customRanking: {position: 0, heading: 100}
            }
        ]);
    });

    it('projects no optional fields when the configured field list is empty', () => {
        const records = buildRecords([createFullyProjectedContent()], {
            contentProjection: {fields: []}
        });

        expect(records).toEqual([
            {
                objectID: 'post-1_0',
                slug: 'getting-started',
                url: 'https://example.com/getting-started/',
                html: '<p>Introduction.</p>',
                title: 'Getting started',
                headings: [],
                anchor: null,
                customRanking: {position: 0, heading: 100}
            }
        ]);
    });

    it('projects every allowlisted source under its canonical name', () => {
        const [record] = buildRecords([createFullyProjectedContent()], {
            contentProjection: {fields: ALL_PROJECTION_SOURCES}
        });

        expect(record).toEqual({
            objectID: 'post-1_0',
            slug: 'getting-started',
            url: 'https://example.com/getting-started/',
            html: '<p>Introduction.</p>',
            title: 'Getting started',
            headings: [],
            anchor: null,
            image: 'https://example.com/feature.jpg',
            tags: [{name: 'Guide', slug: 'guide'}],
            authors: [{name: 'Ada Lovelace', slug: 'ada'}],
            excerpt: 'Ghost computed excerpt',
            custom_excerpt: 'Custom excerpt',
            feature_image_alt: 'Feature image alt',
            feature_image_caption: 'Feature image caption',
            canonical_url: 'https://example.com/canonical/',
            featured: true,
            visibility: 'public',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-02T00:00:00.000Z',
            published_at: '2026-01-03T00:00:00.000Z',
            reading_time: 4,
            customRanking: {position: 0, heading: 100}
        });
    });

    it('reads image from feature_image', () => {
        const [record] = buildRecords([
            createContent({feature_image: 'https://example.com/feature.jpg', image: 'ignored'})
        ]);

        expect(record).toMatchObject({image: 'https://example.com/feature.jpg'});
    });

    it('reduces tags and authors to name and slug', () => {
        const [record] = buildRecords([
            createContent({
                tags: [{id: 'tag-id', name: 'Guide', slug: 'guide', description: 'not indexed'}],
                authors: [{id: 'author-id', name: 'Ada', slug: 'ada', bio: 'not indexed'}]
            })
        ]);

        expect(record).toMatchObject({
            tags: [{name: 'Guide', slug: 'guide'}],
            authors: [{name: 'Ada', slug: 'ada'}]
        });
    });

    it('renames optional fields with validated aliases', () => {
        const [record] = buildRecords([createFullyProjectedContent()], {
            contentProjection: {
                fields: [
                    {source: 'image', as: 'heroImage'},
                    {source: 'reading_time', as: 'readingMinutes'}
                ]
            }
        });

        expect(record).toMatchObject({
            heroImage: 'https://example.com/feature.jpg',
            readingMinutes: 4
        });
        expect(record).not.toHaveProperty('image');
        expect(record).not.toHaveProperty('reading_time');
    });

    it("reads Ghost's computed excerpt without deriving it from custom_excerpt", () => {
        const [record] = buildRecords([createContent({custom_excerpt: 'Custom excerpt'})], {
            contentProjection: {fields: ['excerpt', 'custom_excerpt']}
        });

        expect(record).toMatchObject({excerpt: null, custom_excerpt: 'Custom excerpt'});
    });

    it('normalizes missing scalars to null and missing relations to empty arrays', () => {
        const records = buildRecords([
            createContent({id: 'undefined-fields'}),
            createContent({
                id: 'null-fields',
                feature_image: null,
                excerpt: null,
                tags: null,
                authors: null
            })
        ]);

        expect(
            records.map(({objectID, image, excerpt, tags, authors}) => ({
                objectID,
                image,
                excerpt,
                tags,
                authors
            }))
        ).toEqual([
            {objectID: 'undefined-fields_0', image: null, excerpt: null, tags: [], authors: []},
            {objectID: 'null-fields_0', image: null, excerpt: null, tags: [], authors: []}
        ]);
    });

    it('preserves false, zero, and empty-string values', () => {
        const [record] = buildRecords(
            [createContent({featured: false, reading_time: 0, custom_excerpt: ''})],
            {contentProjection: {fields: ['featured', 'reading_time', 'custom_excerpt']}}
        );

        expect(record).toMatchObject({featured: false, reading_time: 0, custom_excerpt: ''});
    });

    it('repeats every enabled optional field in every record of the same content', () => {
        const records = buildRecords([
            createFullyProjectedContent({
                html: '<h2 id="one">One</h2><p>First.</p><h2 id="two">Two</h2><p>Second.</p>'
            })
        ]);

        expect(records).toHaveLength(2);
        expect(
            records.map(({image, tags, authors, excerpt}) => ({image, tags, authors, excerpt}))
        ).toEqual([
            {
                image: 'https://example.com/feature.jpg',
                tags: [{name: 'Guide', slug: 'guide'}],
                authors: [{name: 'Ada Lovelace', slug: 'ada'}],
                excerpt: 'Ghost computed excerpt'
            },
            {
                image: 'https://example.com/feature.jpg',
                tags: [{name: 'Guide', slug: 'guide'}],
                authors: [{name: 'Ada Lovelace', slug: 'ada'}],
                excerpt: 'Ghost computed excerpt'
            }
        ]);
    });
});

describe('createAlgoliaRecords policy validation', () => {
    const rejections = [
        {
            name: 'an unknown projection source',
            options: {contentProjection: {fields: ['plaintext']}},
            reason: 'unknown-source',
            path: 'contentProjection.fields[0]'
        },
        {
            name: 'a repeated projection source',
            options: {contentProjection: {fields: ['tags', 'tags']}},
            reason: 'repeated-source',
            path: 'contentProjection.fields[1]'
        },
        {
            name: 'a repeated output name inside the projection list',
            options: {
                contentProjection: {
                    fields: [
                        {source: 'excerpt', as: 'blurb'},
                        {source: 'custom_excerpt', as: 'blurb'}
                    ]
                }
            },
            reason: 'repeated-output',
            path: 'contentProjection.fields[1].as'
        },
        {
            name: 'a repeated output name across projection and ranking fields',
            options: {
                contentProjection: {
                    fields: [{source: 'reading_time', as: 'minutes'}],
                    customRanking: [{source: 'featured', as: 'minutes'}]
                }
            },
            reason: 'repeated-output',
            path: 'contentProjection.customRanking[0].as'
        },
        {
            name: 'an alias colliding with a protected record field',
            options: {contentProjection: {fields: [{source: 'excerpt', as: 'html'}]}},
            reason: 'protected-collision',
            path: 'contentProjection.fields[0].as'
        },
        {
            name: 'an alias equal to the customRanking container',
            options: {contentProjection: {fields: [{source: 'excerpt', as: 'customRanking'}]}},
            reason: 'container-collision',
            path: 'contentProjection.fields[0].as'
        },
        {
            name: 'a ranking alias equal to the customRanking container',
            options: {
                contentProjection: {
                    fields: [],
                    customRanking: [{source: 'featured', as: 'customRanking'}]
                }
            },
            reason: 'container-collision',
            path: 'contentProjection.customRanking[0].as'
        },
        {
            name: 'an alias impersonating another canonical allowlist name',
            options: {contentProjection: {fields: [{source: 'custom_excerpt', as: 'excerpt'}]}},
            reason: 'canonical-collision',
            path: 'contentProjection.fields[0].as'
        },
        {
            name: 'a ranking alias impersonating another canonical allowlist name',
            options: {
                contentProjection: {
                    fields: [],
                    customRanking: [{source: 'featured', as: 'reading_time'}]
                }
            },
            reason: 'canonical-collision',
            path: 'contentProjection.customRanking[0].as'
        },
        {
            name: 'heading inside customRanking',
            options: {
                contentProjection: {
                    fields: [],
                    customRanking: [{source: 'featured', as: 'heading'}]
                }
            },
            reason: 'protected-collision',
            path: 'contentProjection.customRanking[0].as'
        },
        {
            name: 'position inside customRanking',
            options: {
                contentProjection: {
                    fields: [],
                    customRanking: [{source: 'reading_time', as: 'position'}]
                }
            },
            reason: 'protected-collision',
            path: 'contentProjection.customRanking[0].as'
        },
        {
            name: 'an Algolia-reserved output name',
            options: {contentProjection: {fields: [{source: 'excerpt', as: 'distinctSeqId'}]}},
            reason: 'reserved-collision',
            path: 'contentProjection.fields[0].as'
        },
        {
            name: 'an alias containing a dot',
            options: {contentProjection: {fields: [{source: 'excerpt', as: 'meta.excerpt'}]}},
            reason: 'invalid-alias',
            path: 'contentProjection.fields[0].as'
        },
        {
            name: 'an alias with a leading underscore',
            options: {contentProjection: {fields: [{source: 'tags', as: '_tags'}]}},
            reason: 'invalid-alias',
            path: 'contentProjection.fields[0].as'
        },
        {
            name: 'an alias containing a wildcard',
            options: {contentProjection: {fields: [{source: 'excerpt', as: 'excerpt*'}]}},
            reason: 'invalid-alias',
            path: 'contentProjection.fields[0].as'
        },
        {
            name: 'an alias that is an object path',
            options: {contentProjection: {fields: [{source: 'excerpt', as: 'meta[0].text'}]}},
            reason: 'invalid-alias',
            path: 'contentProjection.fields[0].as'
        },
        {
            name: 'a ranking alias that is not a record attribute name',
            options: {
                contentProjection: {fields: [], customRanking: [{source: 'featured', as: '_rank'}]}
            },
            reason: 'invalid-alias',
            path: 'contentProjection.customRanking[0].as'
        },
        {
            name: 'a ranking sibling without an alias',
            options: {contentProjection: {fields: [], customRanking: ['featured']}},
            reason: 'invalid-shape',
            path: 'contentProjection.customRanking[0]'
        },
        {
            name: 'a ranking source outside featured and reading_time',
            options: {
                contentProjection: {
                    fields: [],
                    customRanking: [{source: 'created_at', as: 'createdAt'}]
                }
            },
            reason: 'unknown-source',
            path: 'contentProjection.customRanking[0]'
        },
        {
            name: 'a repeated ranking source',
            options: {
                contentProjection: {
                    fields: [],
                    customRanking: [
                        {source: 'featured', as: 'isFeatured'},
                        {source: 'featured', as: 'promoted'}
                    ]
                }
            },
            reason: 'repeated-source',
            path: 'contentProjection.customRanking[1]'
        },
        {
            name: 'an unknown policy property',
            options: {customRankings: []},
            reason: 'unknown-property',
            path: 'options'
        },
        {
            name: 'an unknown contentProjection property',
            options: {contentProjection: {fields: [], ranking: []}},
            reason: 'unknown-property',
            path: 'contentProjection'
        },
        {
            name: 'an unknown projection field property',
            options: {
                contentProjection: {fields: [{source: 'excerpt', as: 'blurb', transform: 'upper'}]}
            },
            reason: 'unknown-property',
            path: 'contentProjection.fields[0]'
        },
        {
            name: 'an unknown ranking field property',
            options: {
                contentProjection: {
                    fields: [],
                    customRanking: [{source: 'featured', as: 'isFeatured', weight: 2}]
                }
            },
            reason: 'unknown-property',
            path: 'contentProjection.customRanking[0]'
        },
        {
            name: 'options that are not an object',
            options: 42,
            reason: 'invalid-shape',
            path: 'options'
        },
        {
            name: 'a non-array fields property',
            options: {contentProjection: {fields: 'image'}},
            reason: 'invalid-shape',
            path: 'contentProjection.fields'
        },
        {
            name: 'a missing fields property',
            options: {contentProjection: {}},
            reason: 'invalid-shape',
            path: 'contentProjection.fields'
        },
        {
            name: 'a null contentProjection',
            options: {contentProjection: null},
            reason: 'invalid-shape',
            path: 'contentProjection'
        },
        {
            name: 'an array contentProjection',
            options: {contentProjection: []},
            reason: 'invalid-shape',
            path: 'contentProjection'
        },
        {
            name: 'a non-array customRanking property',
            options: {contentProjection: {fields: [], customRanking: 'featured'}},
            reason: 'invalid-shape',
            path: 'contentProjection.customRanking'
        },
        {
            name: 'a projection field that is neither a name nor an object',
            options: {contentProjection: {fields: [42]}},
            reason: 'invalid-shape',
            path: 'contentProjection.fields[0]'
        },
        {
            name: 'a projection field alias that is not a string',
            options: {contentProjection: {fields: [{source: 'excerpt', as: 42}]}},
            reason: 'invalid-shape',
            path: 'contentProjection.fields[0]'
        },
        {
            name: 'a non-array ignoreSlugs property',
            options: {ignoreSlugs: 'ignored'},
            reason: 'invalid-shape',
            path: 'ignoreSlugs'
        },
        {
            name: 'a non-string ignoreSlugs entry',
            options: {ignoreSlugs: ['ignored', 42]},
            reason: 'invalid-shape',
            path: 'ignoreSlugs[1]'
        }
    ];

    it.each(rejections)('rejects $name', ({options, reason, path: issuePath}) => {
        const error = expectFragmenterError(() => buildRecords([createContent()], options));

        expect(error.code).toBe('INVALID_POLICY');
        expect(describeIssues(error)).toEqual([`${reason} @ ${issuePath}`]);
        expect(error.issues.every(issue => issue.kind === 'policy')).toBe(true);
    });

    it('accepts an alias equal to its own source name', () => {
        const [record] = buildRecords([createFullyProjectedContent()], {
            contentProjection: {
                fields: [{source: 'featured', as: 'featured'}],
                customRanking: [{source: 'reading_time', as: 'reading_time'}]
            }
        });

        expect(record).toMatchObject({
            featured: true,
            customRanking: {position: 0, heading: 100, reading_time: 4}
        });
    });

    it('reports every policy issue in declaration order', () => {
        const error = expectFragmenterError(() =>
            buildRecords([createContent()], {
                unexpected: true,
                ignoreSlugs: [42],
                contentProjection: {
                    fields: ['plaintext', {source: 'excerpt', as: 'html'}],
                    customRanking: [{source: 'featured', as: 'heading'}]
                }
            })
        );

        expect(error.code).toBe('INVALID_POLICY');
        expect(error.issues.map(issue => issue.path)).toEqual([
            'options',
            'ignoreSlugs[0]',
            'contentProjection.fields[0]',
            'contentProjection.fields[1].as',
            'contentProjection.customRanking[0].as'
        ]);
    });

    it('summarizes at most five issue messages and counts the rest', () => {
        const error = expectFragmenterError(() =>
            buildRecords([createContent()], {
                contentProjection: {
                    fields: ['a', 'b', 'c', 'd', 'e', 'f']
                }
            })
        );

        expect(error.issues).toHaveLength(6);
        expect(error.message.startsWith('INVALID_POLICY: 6 issues.')).toBe(true);
        expect(error.message.endsWith('; and 1 more')).toBe(true);
    });

    it('names a single issue in the singular', () => {
        const error = expectFragmenterError(() =>
            buildRecords([createContent()], {contentProjection: {fields: ['plaintext']}})
        );

        expect(error.message).toBe(
            'INVALID_POLICY: 1 issue. contentProjection.fields[0]: "plaintext" is not an allowed projection source.'
        );
    });

    it('names the repeated source kind in its message', () => {
        const projection = expectFragmenterError(() =>
            buildRecords([createContent()], {contentProjection: {fields: ['tags', 'tags']}})
        );
        const ranking = expectFragmenterError(() =>
            buildRecords([createContent()], {
                contentProjection: {
                    fields: [],
                    customRanking: [
                        {source: 'featured', as: 'isFeatured'},
                        {source: 'featured', as: 'promoted'}
                    ]
                }
            })
        );

        expect(projection.issues[0]?.message).toBe(
            'contentProjection.fields[1]: projection source "tags" is configured more than once.'
        );
        expect(ranking.issues[0]?.message).toBe(
            'contentProjection.customRanking[1]: ranking source "featured" is configured more than once.'
        );
    });

    it('throws INVALID_POLICY before any content is inspected', () => {
        const error = expectFragmenterError(() =>
            buildRecords([createContent({id: 42, html: null})], {
                contentProjection: {fields: ['plaintext']}
            })
        );

        expect(error.code).toBe('INVALID_POLICY');
        expect(error.issues.some(issue => issue.kind === 'content')).toBe(false);
    });

    it('validates the policy even for an empty batch', () => {
        const error = expectFragmenterError(() =>
            buildRecords([], {contentProjection: {fields: ['plaintext']}})
        );

        expect(error.code).toBe('INVALID_POLICY');
    });

    it('returns an empty array for an empty batch', () => {
        expect(buildRecords([])).toEqual([]);
    });

    it('freezes the reported issues', () => {
        const error = expectFragmenterError(() =>
            buildRecords([], {contentProjection: {fields: ['plaintext']}})
        );

        expect(Object.isFrozen(error.issues)).toBe(true);
        expect(error.name).toBe('FragmenterError');
    });
});

describe('createAlgoliaRecords ignored slugs', () => {
    it('removes ignored content and preserves input order for the rest', () => {
        const records = buildRecords(
            [
                createContent({id: 'first', slug: 'first'}),
                createContent({id: 'ignored', slug: 'ignored'}),
                createContent({id: 'last', slug: 'last'})
            ],
            {ignoreSlugs: ['ignored']}
        );

        expect(records.map(record => record.objectID)).toEqual(['first_0', 'last_0']);
    });

    it.each([
        {name: 'a missing slug', slug: undefined, reason: 'missing'},
        {name: 'a non-string slug', slug: 42, reason: 'wrong-type'},
        {name: 'an empty slug', slug: '', reason: 'wrong-type'}
    ])('fails on $name even when the caller listed the content as ignored', ({slug, reason}) => {
        const error = expectFragmenterError(() =>
            buildRecords([createContent({slug})], {ignoreSlugs: ['getting-started', '']})
        );

        expect(error.code).toBe('INVALID_GHOST_CONTENT');
        expect(describeIssues(error)).toEqual([`${reason} @ ghostContent[0].slug`]);
    });

    it('does not validate other fields of an ignored item', () => {
        const records = buildRecords(
            [
                createContent({
                    id: 42,
                    slug: 'ignored',
                    html: 42,
                    url: null,
                    reading_time: 'four',
                    tags: 'none'
                }),
                createContent({id: 'kept', slug: 'kept'})
            ],
            {ignoreSlugs: ['ignored']}
        );

        expect(records.map(record => record.objectID)).toEqual(['kept_0']);
    });

    it('emits only the slug issue for an item whose slug is invalid', () => {
        const error = expectFragmenterError(() =>
            buildRecords([createContent({slug: 42, id: undefined, html: 42, excerpt: 42})])
        );

        expect(describeIssues(error)).toEqual(['wrong-type @ ghostContent[0].slug']);
    });
});

describe('createAlgoliaRecords content validation', () => {
    it('rejects missing and non-string required fields in canonical order', () => {
        const error = expectFragmenterError(() =>
            buildRecords([createContent({id: undefined, url: 42, title: [], html: null})])
        );

        expect(error.code).toBe('INVALID_GHOST_CONTENT');
        expect(error.issues.map(issue => issue.path)).toEqual([
            'ghostContent[0].id',
            'ghostContent[0].url',
            'ghostContent[0].title',
            'ghostContent[0].html'
        ]);
        expect(error.issues.map(issue => issue.message)).toEqual([
            'ghostContent[0].id: required Ghost field is missing.',
            'ghostContent[0].url: expected string but received number.',
            'ghostContent[0].title: expected string but received array.',
            'ghostContent[0].html: required Ghost field is missing.'
        ]);
    });

    it('accepts empty url, title, and html but rejects an empty id', () => {
        const records = buildRecords([createContent({url: '', title: '', html: ''})]);
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({url: '', title: '', html: ''});

        const error = expectFragmenterError(() => buildRecords([createContent({id: ''})]));
        expect(describeIssues(error)).toEqual(['wrong-type @ ghostContent[0].id']);
        expect(error.issues[0]).toMatchObject({
            contentId: null,
            message: 'ghostContent[0].id: expected a non-empty string but received an empty string.'
        });
    });

    it('rejects a present optional field of the wrong documented type', () => {
        const error = expectFragmenterError(() =>
            buildRecords([createContent({featured: 'yes', reading_time: '4', excerpt: 12})], {
                contentProjection: {fields: ['featured', 'reading_time', 'excerpt']}
            })
        );

        expect(
            contentIssuesOf(error).map(issue => ({path: issue.path, expected: issue.expected}))
        ).toEqual([
            {path: 'ghostContent[0].featured', expected: 'boolean'},
            {path: 'ghostContent[0].reading_time', expected: 'number'},
            {path: 'ghostContent[0].excerpt', expected: 'string'}
        ]);
    });

    it('treats an explicit null as missing rather than as a wrong type', () => {
        const records = buildRecords(
            [
                createContent({
                    feature_image: null,
                    featured: null,
                    reading_time: null,
                    canonical_url: null
                })
            ],
            {
                contentProjection: {
                    fields: ['image', 'featured', 'reading_time', 'canonical_url']
                }
            }
        );

        expect(records[0]).toMatchObject({
            image: null,
            featured: null,
            reading_time: null,
            canonical_url: null
        });
    });

    it('rejects a relation that is not an array', () => {
        const error = expectFragmenterError(() =>
            buildRecords([createContent({tags: {length: 1, forEach: () => undefined}})])
        );

        expect(error.issues[0]).toMatchObject({
            reason: 'wrong-type',
            path: 'ghostContent[0].tags',
            expected: 'array'
        });
    });

    it.each([
        {
            name: 'an element that is not an object',
            tags: [null],
            path: 'ghostContent[0].tags[0]',
            expected: 'object'
        },
        {
            name: 'an element that is an array',
            tags: [[]],
            path: 'ghostContent[0].tags[0]',
            expected: 'object'
        },
        {
            name: 'an element without a string name',
            tags: [{name: null, slug: 'guide'}],
            path: 'ghostContent[0].tags[0].name',
            expected: 'string'
        },
        {
            name: 'an element without a string slug',
            tags: [{name: 'Guide'}],
            path: 'ghostContent[0].tags[0].slug',
            expected: 'string'
        }
    ])('rejects a relation with $name', ({tags, path: issuePath, expected}) => {
        const error = expectFragmenterError(() => buildRecords([createContent({tags})]));

        expect(error.issues[0]).toMatchObject({
            reason: 'wrong-type',
            path: issuePath,
            expected
        });
    });

    it('validates only enabled optional fields', () => {
        const records = buildRecords([createContent({visibility: 42, reading_time: 'four'})], {
            contentProjection: {fields: ['image']}
        });

        expect(records).toHaveLength(1);
        expect(records[0]).not.toHaveProperty('visibility');
    });

    it('reports a wrong-typed value once when it feeds both a projection field and a ranking sibling', () => {
        const error = expectFragmenterError(() =>
            buildRecords([createContent({featured: 'yes'})], {
                contentProjection: {
                    fields: ['featured'],
                    customRanking: [{source: 'featured', as: 'isFeatured'}]
                }
            })
        );

        expect(describeIssues(error)).toEqual(['wrong-type @ ghostContent[0].featured']);
    });

    it('reports content issues for every item in input order', () => {
        const error = expectFragmenterError(() =>
            buildRecords([
                createContent({id: 'first', slug: 'first', html: 42}),
                createContent({id: 'second', slug: 'second', title: null}),
                createContent({id: 'third', slug: 42})
            ])
        );

        expect(
            contentIssuesOf(error).map(issue => ({path: issue.path, contentId: issue.contentId}))
        ).toEqual([
            {path: 'ghostContent[0].html', contentId: 'first'},
            {path: 'ghostContent[1].title', contentId: 'second'},
            {path: 'ghostContent[2].slug', contentId: 'third'}
        ]);
    });

    it('rejects a non-array ghostContent argument', () => {
        const error = expectFragmenterError(() => buildRecords({length: 0}));

        expect(error.code).toBe('INVALID_GHOST_CONTENT');
        expect(error.issues).toEqual([
            {
                kind: 'content',
                reason: 'invalid-shape',
                path: 'ghostContent',
                index: null,
                contentId: null,
                expected: 'array',
                message: 'ghostContent: expected array.'
            }
        ]);
    });

    it('rejects a batch item that is not an object', () => {
        const error = expectFragmenterError(() => buildRecords([createContent(), 'post']));

        expect(error.issues).toEqual([
            {
                kind: 'content',
                reason: 'invalid-shape',
                path: 'ghostContent[1]',
                index: 1,
                contentId: null,
                expected: 'object',
                message: 'ghostContent[1]: expected object.'
            }
        ]);
    });

    it('throws INVALID_GHOST_CONTENT when content and size problems coexist', () => {
        const error = expectFragmenterError(() =>
            buildRecords([
                createContent({
                    id: 'oversized',
                    slug: 'oversized',
                    html: paragraphs('A'.repeat(11000))
                }),
                createContent({id: 'invalid', slug: 'invalid', title: 42})
            ])
        );

        expect(error.code).toBe('INVALID_GHOST_CONTENT');
        expect(describeIssues(error)).toEqual(['wrong-type @ ghostContent[1].title']);
    });

    it('returns no records when any item fails validation', () => {
        const error = expectFragmenterError(() =>
            buildRecords([createContent({id: 'valid', slug: 'valid'}), createContent({url: 42})])
        );

        expect(error.issues).toHaveLength(1);
        expect(error.issues.every(issue => issue.kind === 'content')).toBe(true);
    });
});

describe('createAlgoliaRecords ranking siblings', () => {
    it("always emits heading and position from each record's first packed fragment", () => {
        const records = buildRecords([
            createContent({
                html: '<h2 id="one">One</h2><p>First.</p><h3 id="two">Two</h3><p>Second.</p>'
            })
        ]);

        expect(records.map(record => record.customRanking)).toEqual([
            {position: 0, heading: 80},
            {position: 1, heading: 70}
        ]);
    });

    it('adds featured and reading_time siblings under their aliases', () => {
        const [record] = buildRecords([createFullyProjectedContent()], {
            contentProjection: {
                fields: [],
                customRanking: [
                    {source: 'featured', as: 'isFeatured'},
                    {source: 'reading_time', as: 'readingMinutes'}
                ]
            }
        });

        expect(record?.customRanking).toEqual({
            position: 0,
            heading: 100,
            isFeatured: true,
            readingMinutes: 4
        });
    });

    it('emits null for a missing ranking sibling value', () => {
        const [record] = buildRecords([createContent()], {
            contentProjection: {
                fields: [],
                customRanking: [{source: 'featured', as: 'isFeatured'}]
            }
        });

        expect(record?.customRanking).toEqual({position: 0, heading: 100, isFeatured: null});
    });

    it('repeats identical sibling values in every record of one content item', () => {
        const records = buildRecords(
            [
                createFullyProjectedContent({
                    html: '<h2 id="one">One</h2><p>First.</p><h2 id="two">Two</h2><p>Second.</p>'
                })
            ],
            {
                contentProjection: {
                    fields: [],
                    customRanking: [{source: 'reading_time', as: 'readingMinutes'}]
                }
            }
        );

        expect(records.map(record => record.customRanking)).toEqual([
            {position: 0, heading: 80, readingMinutes: 4},
            {position: 1, heading: 80, readingMinutes: 4}
        ]);
    });

    it('uses the headingless rank for content with no headings', () => {
        const [record] = buildRecords([createContent({html: paragraphs('Only text.')})]);

        expect(record?.customRanking).toEqual({position: 0, heading: 100});
    });
});

describe('createAlgoliaRecords fallback record', () => {
    it('emits one fallback record for content with no extraction fragments', () => {
        const records = buildRecords([createContent({html: ''})]);

        expect(records).toEqual([
            {
                objectID: 'post-1_0',
                slug: 'getting-started',
                url: 'https://example.com/getting-started/',
                html: '',
                title: 'Getting started',
                headings: [],
                anchor: null,
                image: null,
                tags: [],
                authors: [],
                excerpt: null,
                customRanking: {position: 0, heading: 100}
            }
        ]);
    });

    it('emits a fallback record for markup with no extractable text', () => {
        const records = buildRecords([
            createContent({html: '<div><span>Only inline text.</span></div>'})
        ]);

        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({objectID: 'post-1_0', html: '', anchor: null});
    });

    it('includes every enabled optional field and ranking sibling in the fallback record', () => {
        const [record] = buildRecords([createFullyProjectedContent({html: ''})], {
            contentProjection: {
                fields: ['image', {source: 'reading_time', as: 'readingMinutes'}],
                customRanking: [{source: 'featured', as: 'isFeatured'}]
            }
        });

        expect(record).toEqual({
            objectID: 'post-1_0',
            slug: 'getting-started',
            url: 'https://example.com/getting-started/',
            html: '',
            title: 'Getting started',
            headings: [],
            anchor: null,
            image: 'https://example.com/feature.jpg',
            readingMinutes: 4,
            customRanking: {position: 0, heading: 100, isFeatured: true}
        });
    });

    it('fails when a fallback record alone exceeds the ceiling', () => {
        const error = expectFragmenterError(() =>
            buildRecords([createContent({html: '', title: 'Required title '.repeat(760)})])
        );

        expect(error.code).toBe('RECORD_TOO_LARGE');
        expect(error.issues).toHaveLength(1);
        expect(error.issues[0]).toMatchObject({
            kind: 'size',
            reason: 'record-too-large',
            path: 'ghostContent[0]',
            index: 0,
            contentId: 'post-1',
            objectID: 'post-1_0',
            anchor: null,
            position: null,
            limit: MAX_RECORD_BYTES
        });
        expect(error.issues[0]?.message).toContain('fallback record needs');
    });
});

describe('createAlgoliaRecords grouping, deep links, and ordering', () => {
    it('emits one record per legacy anchor group with legacy identifiers', () => {
        const records = buildRecords([
            createContent({
                html: '<p>Lead.</p><h2 id="one">One</h2><p>First.</p><h2 id="two">Two</h2><p>Second.</p>'
            })
        ]);

        expect(records.map(record => ({objectID: record.objectID, anchor: record.anchor}))).toEqual(
            [
                {objectID: 'post-1_0', anchor: null},
                {objectID: 'post-1_1', anchor: 'one'},
                {objectID: 'post-1_2', anchor: 'two'}
            ]
        );
    });

    it('merges non-adjacent fragments that repeat an anchor', () => {
        const records = buildRecords([
            createContent({
                html: [
                    '<h2 id="setup">Setup</h2><p>First setup.</p>',
                    '<h2 id="overview">Overview</h2><p>Overview.</p>',
                    '<h2 id="setup">Setup again</h2><p>Later setup.</p>'
                ].join('')
            })
        ]);

        expect(records.map(({objectID, html, headings}) => ({objectID, html, headings}))).toEqual([
            {
                objectID: 'post-1_0',
                html: '<p>First setup.</p><p>Later setup.</p>',
                headings: ['Setup']
            },
            {objectID: 'post-1_1', html: '<p>Overview.</p>', headings: ['Overview']}
        ]);
    });

    it("keeps preformatted markup for a record's first packed fragment and merges later ones as text", () => {
        const records = buildRecords([
            createContent({
                html: [
                    '<h2 id="code">Code</h2><pre><code>first</code></pre><p>After.</p>',
                    '<h2 id="prose">Prose</h2><p>Run:</p><pre><code>later</code></pre>'
                ].join('')
            })
        ]);

        expect(records.map(record => record.html)).toEqual([
            '<pre><code>first</code></pre><p>After.</p>',
            '<p>Run:</p> later'
        ]);
    });

    it('links each record to its anchor and falls back to the base URL', () => {
        const records = buildRecords([
            createContent({html: '<p>Lead.</p><h2 id="one">One</h2><p>First.</p>'})
        ]);

        expect(records.map(record => record.url)).toEqual([
            'https://example.com/getting-started/',
            'https://example.com/getting-started/#one'
        ]);
    });

    it('returns records in content order, then group order, then continuation order', () => {
        const longParagraph = 'A'.repeat(6000);
        const records = buildRecords([
            createContent({
                id: 'first',
                slug: 'first',
                html: [
                    `<h2 id="a">A</h2>${paragraphs(longParagraph, longParagraph)}`,
                    '<h2 id="b">B</h2><p>Short.</p>'
                ].join('')
            }),
            createContent({id: 'second', slug: 'second', html: '<p>Second content.</p>'})
        ]);

        expect(records.map(record => record.objectID)).toEqual([
            'first_0',
            'first_0_1',
            'first_1',
            'second_0'
        ]);
    });
});

describe('createAlgoliaRecords record size', () => {
    it('keeps every complete record within 9,999 UTF-8 bytes', () => {
        const records = buildRecords([
            createFullyProjectedContent({html: readFixture('massive-example')})
        ]);

        expect(records.length).toBeGreaterThan(1);
        records.forEach(record => {
            expect(bytesOf(record)).toBeLessThanOrEqual(MAX_RECORD_BYTES);
        });
    });

    it('packs whole fragments greedily into continuation records', () => {
        const records = buildRecords([
            createContent({
                html: paragraphs(
                    'A'.repeat(3900),
                    'B'.repeat(3900),
                    'C'.repeat(3900),
                    'D'.repeat(3900)
                )
            })
        ]);

        expect(records).toHaveLength(2);
        expect(records.map(record => record.html)).toEqual([
            paragraphs('A'.repeat(3900), 'B'.repeat(3900)),
            paragraphs('C'.repeat(3900), 'D'.repeat(3900))
        ]);
        records.forEach(record => {
            expect(bytesOf(record)).toBeLessThanOrEqual(MAX_RECORD_BYTES);
        });
    });

    it('numbers continuations deterministically', () => {
        const records = buildRecords([
            createContent({
                html: paragraphs('A'.repeat(9000), 'B'.repeat(9000), 'C'.repeat(9000))
            })
        ]);

        expect(records.map(record => record.objectID)).toEqual([
            'post-1_0',
            'post-1_0_1',
            'post-1_0_2'
        ]);
    });

    it("uses each record's first packed fragment for position and heading rank", () => {
        const records = buildRecords([
            createContent({
                html: `<h2 id="a">A</h2>${paragraphs('A'.repeat(9000), 'B'.repeat(9000))}`
            })
        ]);

        expect(records.map(record => record.customRanking)).toEqual([
            {position: 0, heading: 80},
            {position: 1, heading: 80}
        ]);
    });

    it('repeats projection, anchor and URL in every continuation', () => {
        const records = buildRecords([
            createFullyProjectedContent({
                html: `<h2 id="a">A</h2>${paragraphs('A'.repeat(9000), 'B'.repeat(9000))}`
            })
        ]);

        const shared = records.map(({url, anchor, image, excerpt}) => ({
            url,
            anchor,
            image,
            excerpt
        }));
        expect(shared[0]).toEqual({
            url: 'https://example.com/getting-started/#a',
            anchor: 'a',
            image: 'https://example.com/feature.jpg',
            excerpt: 'Ghost computed excerpt'
        });
        expect(shared[1]).toEqual(shared[0]);
    });

    it('describes each continuation with its own heading context', () => {
        const records = buildRecords([
            createFullyProjectedContent({
                html: [
                    `<h2 id="a">A</h2><p>${'A'.repeat(9000)}</p>`,
                    `<h3>Sub</h3><p>${'B'.repeat(9000)}</p>`
                ].join('')
            })
        ]);

        expect(
            records.map(({objectID, headings, anchor, url, customRanking, image}) => ({
                objectID,
                headings,
                anchor,
                url,
                customRanking,
                image
            }))
        ).toEqual([
            {
                objectID: 'post-1_0',
                headings: ['A'],
                anchor: 'a',
                url: 'https://example.com/getting-started/#a',
                customRanking: {position: 0, heading: 80},
                image: 'https://example.com/feature.jpg'
            },
            {
                objectID: 'post-1_0_1',
                headings: ['A', 'Sub'],
                anchor: 'a',
                url: 'https://example.com/getting-started/#a',
                customRanking: {position: 1, heading: 70},
                image: 'https://example.com/feature.jpg'
            }
        ]);
    });

    it('measures multi-byte characters as UTF-8 bytes', () => {
        const emojiParagraph = '👻'.repeat(1000);
        const records = buildRecords([
            createContent({html: paragraphs(emojiParagraph, emojiParagraph, emojiParagraph)})
        ]);

        const mergedHtml = records.map(record => String(record.html)).join('');
        expect(records).toHaveLength(2);
        expect(mergedHtml.length).toBeLessThan(MAX_RECORD_BYTES);
        expect(Buffer.byteLength(mergedHtml, 'utf8')).toBeGreaterThan(MAX_RECORD_BYTES);
    });

    it('measures JSON escaping', () => {
        const escapedParagraph = '"\\'.repeat(1300);
        const records = buildRecords([
            createContent({html: paragraphs(escapedParagraph, escapedParagraph)})
        ]);

        const mergedHtml = records.map(record => String(record.html)).join('');
        expect(records).toHaveLength(2);
        expect(Buffer.byteLength(mergedHtml, 'utf8')).toBeLessThan(MAX_RECORD_BYTES);
        records.forEach(record => {
            expect(bytesOf(record)).toBeLessThanOrEqual(MAX_RECORD_BYTES);
        });
    });

    it('counts repeated projected metadata toward every record', () => {
        const content = createContent({
            excerpt: 'E'.repeat(3000),
            html: paragraphs('A'.repeat(3400), 'B'.repeat(3400))
        });

        expect(buildRecords([content], {contentProjection: {fields: []}})).toHaveLength(1);
        expect(buildRecords([content], {contentProjection: {fields: ['excerpt']}})).toHaveLength(2);
    });

    it('accepts a record of exactly 9,999 bytes and splits at 10,000', () => {
        const [smallest] = buildRecords([createContent({html: '<p>a</p>'})]);
        const fillLength = MAX_RECORD_BYTES - (bytesOf(smallest) - 1);
        const exactHtml = `<p>${'a'.repeat(fillLength)}</p>`;

        const exact = buildRecords([createContent({html: exactHtml})]);
        expect(exact).toHaveLength(1);
        expect(bytesOf(exact[0])).toBe(MAX_RECORD_BYTES);

        const split = buildRecords([createContent({html: `${exactHtml}<p>b</p>`})]);
        expect(split.map(record => record.objectID)).toEqual(['post-1_0', 'post-1_0_1']);
        expect(bytesOf(split[0])).toBe(MAX_RECORD_BYTES);

        const error = expectFragmenterError(() =>
            buildRecords([createContent({html: `<p>${'a'.repeat(fillLength + 1)}</p>`})])
        );
        expect(error.issues[0]).toMatchObject({bytes: MAX_RECORD_BYTES + 1, excess: 1});
    });

    it('fails on an indivisible fragment with actionable size context', () => {
        const error = expectFragmenterError(() =>
            buildRecords([
                createContent({
                    html: `<h2 id="appendix">Appendix</h2>${paragraphs('G'.repeat(11000))}`
                })
            ])
        );

        expect(error.code).toBe('RECORD_TOO_LARGE');
        expect(error.issues).toHaveLength(1);

        const [issue] = sizeIssuesOf(error);
        expect(issue).toMatchObject({
            kind: 'size',
            reason: 'record-too-large',
            path: 'ghostContent[0]',
            index: 0,
            contentId: 'post-1',
            objectID: 'post-1_0',
            anchor: 'appendix',
            position: 0,
            limit: MAX_RECORD_BYTES
        });
        expect(issue?.excess).toBe((issue?.bytes ?? 0) - MAX_RECORD_BYTES);
        expect(issue?.message).toContain('fragment at source position 0');
    });

    it('fails when required metadata leaves no room for the smallest fragment', () => {
        const error = expectFragmenterError(() =>
            buildRecords([
                createContent({
                    title: 'Required title '.repeat(760),
                    html: '<h2 id="details">Details</h2><p>Small paragraph.</p>'
                })
            ])
        );

        expect(error.code).toBe('RECORD_TOO_LARGE');
        expect(sizeIssuesOf(error)).toHaveLength(1);
        expect(sizeIssuesOf(error)[0]).toMatchObject({
            path: 'ghostContent[0]',
            objectID: 'post-1_0',
            anchor: 'details',
            position: 0
        });
        expect(sizeIssuesOf(error)[0]?.message).toContain('fragment at source position 0');
    });

    it('reports every size issue in input order', () => {
        const error = expectFragmenterError(() =>
            buildRecords([
                createContent({
                    id: 'first',
                    slug: 'first',
                    html: paragraphs('Short.', 'A'.repeat(11000))
                }),
                createContent({id: 'second', slug: 'second', html: paragraphs('B'.repeat(11000))})
            ])
        );

        expect(error.code).toBe('RECORD_TOO_LARGE');
        expect(sizeIssuesOf(error).map(issue => `${issue.contentId}:${issue.objectID}`)).toEqual([
            'first:first_0_1',
            'second:second_0'
        ]);
    });

    it('returns no records when any record is too large', () => {
        const error = expectFragmenterError(() =>
            buildRecords([
                createContent({id: 'fine', slug: 'fine'}),
                createContent({
                    id: 'oversized',
                    slug: 'oversized',
                    html: paragraphs('A'.repeat(11000))
                })
            ])
        );

        expect(error.code).toBe('RECORD_TOO_LARGE');
        expect(error.issues).toHaveLength(1);
    });
});

describe('deprecated wrapper non-regression', () => {
    it('fragmentTransformer emits one oversized record without packing', () => {
        const post = {
            id: 'oversized',
            slug: 'oversized',
            url: 'https://example.com/oversized/',
            html: paragraphs('A'.repeat(6000), 'B'.repeat(6000)),
            feature_image: null,
            title: 'Oversized',
            tags: [],
            authors: []
        };

        const records = transformToAlgoliaObject([post]).reduce(fragmentTransformer, []);

        expect(records.map(record => record.objectID)).toEqual(['oversized_0']);
        expect(bytesOf(records[0])).toBeGreaterThan(MAX_RECORD_BYTES);
    });

    it('transformToAlgoliaObject keeps rejecting a relation collection without forEach', () => {
        expect(() =>
            transformToAlgoliaObject([
                {
                    id: 'legacy',
                    slug: 'legacy',
                    url: 'https://example.com/legacy/',
                    html: '<p>Legacy.</p>',
                    feature_image: null,
                    title: 'Legacy',
                    tags: {length: 1},
                    authors: []
                }
            ])
        ).toThrow(new TypeError('post.tags.forEach is not a function'));
    });

    it('transformToAlgoliaObject ignores projection-only Ghost fields', () => {
        const [record] = transformToAlgoliaObject([
            {
                id: 'legacy',
                slug: 'legacy',
                url: 'https://example.com/legacy/',
                html: '<p>Legacy.</p>',
                feature_image: null,
                title: 'Legacy',
                tags: [],
                authors: [],
                excerpt: 'not indexed',
                featured: true,
                reading_time: 4
            }
        ]);

        expect(record).not.toHaveProperty('excerpt');
        expect(record).not.toHaveProperty('featured');
        expect(record).not.toHaveProperty('reading_time');
    });
});
