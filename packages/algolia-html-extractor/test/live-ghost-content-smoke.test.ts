import {createHash} from 'node:crypto';

import {describe, expect, it, vi} from 'vitest';

import {
    SmokeError,
    runLiveGhostContentSmoke,
    type LiveGhostContentSmokeOptions,
    type SmokeTransport,
    type SmokeTransportResponse
} from '../smoke/live-ghost-content-smoke.mts';

const FIXED_TIME = new Date('2026-08-19T04:17:00.000Z');

const createOptions = (
    transport: SmokeTransport,
    overrides: Partial<LiveGhostContentSmokeOptions> = {}
): LiveGhostContentSmokeOptions => ({
    target: 'https://main.ghost.is',
    apiVersion: 'v6.0',
    contentApiKey: 'test-content-api-key',
    transport,
    clock: () => FIXED_TIME,
    summarySink: () => undefined,
    ...overrides
});

const createSinglePageTransport = (
    postItems: readonly unknown[],
    pageItems: readonly unknown[]
): SmokeTransport => {
    return vi.fn<SmokeTransport>(async request => {
        const items = request.contentType === 'posts' ? postItems : pageItems;
        return {
            status: 200,
            redirected: false,
            body: {
                [request.contentType]: items,
                meta: {
                    pagination: {
                        page: 1,
                        limit: 100,
                        pages: 1,
                        total: items.length,
                        next: null,
                        prev: null
                    }
                }
            }
        };
    });
};

const createSuccessfulTransport = (
    postHtml: readonly (string | null)[],
    pageHtml: readonly (string | null)[]
): SmokeTransport => {
    return createSinglePageTransport(
        postHtml.map(html => ({html})),
        pageHtml.map(html => ({html}))
    );
};

const signatureFor = (canonicalStructure: unknown): `sha256:${string}` => {
    const serializedStructure = JSON.stringify(canonicalStructure);
    return `sha256:${createHash('sha256').update(serializedStructure, 'utf8').digest('hex')}`;
};

const PARAGRAPH_STRUCTURE = {
    version: 1,
    nodes: [
        {tag: 'html', parent: null, kgClasses: [], attributes: []},
        {tag: 'head', parent: 0, kgClasses: [], attributes: []},
        {tag: 'body', parent: 0, kgClasses: [], attributes: []},
        {tag: 'p', parent: 2, kgClasses: [], attributes: []}
    ],
    headings: [],
    selectedCounts: {p: 1, pre: 0, td: 0, li: 0},
    semanticGaps: {
        caption: false,
        tableHeader: false,
        blockquote: false,
        figure: false,
        cardWrapper: false
    }
} as const;

describe('runLiveGhostContentSmoke', () => {
    it.each([
        ['missing credentials', {contentApiKey: ''}],
        ['unexpected target', {target: 'https://example.com'}],
        ['unexpected API version', {apiVersion: 'v5.0'}]
    ])('rejects %s before transport and writes a safe failure summary', async (_name, invalid) => {
        const transport = vi.fn<SmokeTransport>();
        const summaries: string[] = [];
        const secret = 'must-not-escape';

        const execution = runLiveGhostContentSmoke(
            createOptions(transport, {
                contentApiKey: secret,
                summarySink: summary => {
                    summaries.push(summary);
                },
                ...invalid
            })
        );

        await expect(execution).rejects.toMatchObject({
            category: 'operational-failure'
        });
        expect(transport).not.toHaveBeenCalled();
        expect(summaries).toHaveLength(1);
        expect(summaries[0]).toContain('operational-failure');
        expect(summaries[0]).not.toContain(secret);
        expect(summaries[0]).not.toContain('example.com');
    });

    it('paginates posts and pages independently and reports only aggregate structure', async () => {
        const firstStructure = [
            '<h2 id="private-heading-one">Private heading one</h2>',
            '<figure class="unowned kg-image-card kg-card" data-kg-toggle-state="private-state">',
            '<img src="https://private.invalid/one.jpg" alt="Private alternative one">',
            '</figure>',
            '<p>Private prose one</p>'
        ].join('');
        const sameStructureWithDifferentValues = [
            '<h2 id="private-heading-two">Private heading two</h2>',
            '<figure class="another kg-card kg-image-card" data-kg-toggle-state="other-state">',
            '<img src="https://private.invalid/two.jpg" alt="Private alternative two">',
            '</figure>',
            '<p>Private prose two</p>'
        ].join('');
        const responses: SmokeTransportResponse[] = [
            {
                status: 200,
                redirected: false,
                body: {
                    posts: [{id: 'private-post-id', html: firstStructure}],
                    meta: {
                        pagination: {page: 1, limit: 100, pages: 2, total: 2, next: 2, prev: null}
                    }
                }
            },
            {
                status: 200,
                redirected: false,
                body: {
                    posts: [{html: sameStructureWithDifferentValues}],
                    meta: {
                        pagination: {page: 2, limit: 100, pages: 2, total: 2, next: null, prev: 1}
                    }
                }
            },
            {
                status: 200,
                redirected: false,
                body: {
                    pages: [{html: '<blockquote>Private quotation</blockquote>'}],
                    meta: {
                        pagination: {
                            page: 1,
                            limit: 100,
                            pages: 1,
                            total: 1,
                            next: null,
                            prev: null
                        }
                    }
                }
            }
        ];
        const transport = vi.fn<SmokeTransport>(async () => {
            const response = responses.shift();
            if (response === undefined) {
                throw new Error('unexpected request');
            }
            return response;
        });
        const summaries: string[] = [];

        const report = await runLiveGhostContentSmoke(
            createOptions(transport, {
                summarySink: summary => {
                    summaries.push(summary);
                }
            })
        );

        expect(report).toMatchObject({
            category: 'ok',
            observedAt: '2026-08-19T04:17:00.000Z',
            target: 'https://main.ghost.is',
            apiVersion: 'v6.0',
            totals: {
                posts: {pages: 2, items: 2, itemsWithoutHtml: 0},
                pages: {pages: 1, items: 1, itemsWithoutHtml: 0}
            },
            drift: {added: [], missing: [], countChanged: []}
        });
        expect(
            report.signatures.map(signature => signature.count).toSorted((a, b) => a - b)
        ).toEqual([1, 2]);
        expect(report.signatures.every(({id}) => /^sha256:[0-9a-f]{64}$/.test(id))).toBe(true);
        expect(
            transport.mock.calls.map(([request]) => [request.contentType, request.page])
        ).toEqual([
            ['posts', 1],
            ['posts', 2],
            ['pages', 1]
        ]);
        expect(transport.mock.calls[0]?.[0]).toEqual({
            target: 'https://main.ghost.is',
            apiVersion: 'v6.0',
            contentApiKey: 'test-content-api-key',
            contentType: 'posts',
            page: 1,
            limit: 100,
            fields: 'html',
            formats: 'html',
            redirect: 'error'
        });
        expect(summaries).toHaveLength(1);
        expect(summaries[0]).toContain('Result: ok');
        expect(summaries[0]).not.toMatch(
            /private|prose|quotation|heading|\.invalid|post-id|test-content-api-key/i
        );
    });

    it('counts items without html, keeps them out of the census, and never extracts them', async () => {
        const summaries: string[] = [];

        const report = await runLiveGhostContentSmoke(
            createOptions(
                createSuccessfulTransport(
                    ['<p>Private prose one</p>', null, '<p>Private prose two</p>'],
                    [null]
                ),
                {
                    summarySink: summary => {
                        summaries.push(summary);
                    }
                }
            )
        );

        expect(report.category).toBe('ok');
        expect(report.totals).toEqual({
            posts: {pages: 1, items: 3, itemsWithoutHtml: 1},
            pages: {pages: 1, items: 1, itemsWithoutHtml: 1}
        });
        expect(report.signatures).toEqual([{id: signatureFor(PARAGRAPH_STRUCTURE), count: 2}]);
        expect(summaries[0]).not.toMatch(/private|prose/i);
    });

    it('reconciles declared totals when items without html span pages and resources', async () => {
        const responses: SmokeTransportResponse[] = [
            {
                status: 200,
                redirected: false,
                body: {
                    posts: [{html: null}, {html: '<p>Private prose one</p>'}],
                    meta: {
                        pagination: {page: 1, limit: 100, pages: 2, total: 3, next: 2, prev: null}
                    }
                }
            },
            {
                status: 200,
                redirected: false,
                body: {
                    posts: [{html: null}],
                    meta: {
                        pagination: {page: 2, limit: 100, pages: 2, total: 3, next: null, prev: 1}
                    }
                }
            },
            {
                status: 200,
                redirected: false,
                body: {
                    pages: [{html: null}, {html: '<p>Private prose two</p>'}],
                    meta: {
                        pagination: {
                            page: 1,
                            limit: 100,
                            pages: 1,
                            total: 2,
                            next: null,
                            prev: null
                        }
                    }
                }
            }
        ];
        const transport = vi.fn<SmokeTransport>(async () => {
            const response = responses.shift();
            if (response === undefined) {
                throw new Error('unexpected request');
            }
            return response;
        });

        const report = await runLiveGhostContentSmoke(createOptions(transport));

        expect(report.category).toBe('ok');
        expect(report.totals).toEqual({
            posts: {pages: 2, items: 3, itemsWithoutHtml: 2},
            pages: {pages: 1, items: 2, itemsWithoutHtml: 1}
        });
        expect(report.signatures).toEqual([{id: signatureFor(PARAGRAPH_STRUCTURE), count: 2}]);
    });

    it('renders the aggregate of items without html as a summary column', async () => {
        const summaries: string[] = [];

        await runLiveGhostContentSmoke(
            createOptions(createSuccessfulTransport(['<p>Private prose</p>', null], [null]), {
                summarySink: summary => {
                    summaries.push(summary);
                }
            })
        );

        expect(summaries[0]).toContain(
            [
                '| Resource | Pages | Items | Without html |',
                '| --- | ---: | ---: | ---: |',
                '| posts | 1 | 2 | 1 |',
                '| pages | 1 | 1 | 1 |'
            ].join('\n')
        );
    });

    it.each([
        ['a numeric html value', {html: 12}],
        ['an array html value', {html: []}],
        ['an object html value', {html: {private: 'private item value'}}],
        ['a missing html property', {private: 'private item value'}],
        ['an explicitly undefined html value', {html: undefined}],
        ['a non-object item', 'private item value'],
        ['a null item', null]
    ])('keeps %s fatal', async (_name, item) => {
        const summaries: string[] = [];

        const execution = runLiveGhostContentSmoke(
            createOptions(createSinglePageTransport([item], []), {
                summarySink: summary => {
                    summaries.push(summary);
                }
            })
        );

        await expect(execution).rejects.toMatchObject({
            category: 'schema-drift',
            code: 'invalid-schema'
        });
        expect(summaries[0]).not.toMatch(/private/i);
    });

    it('rejects an invalid baseline before transport without echoing its entries', async () => {
        const transport = vi.fn<SmokeTransport>();
        const summaries: string[] = [];
        const unsafeBaseline = {'private-editorial-value': 1} as Readonly<
            Record<`sha256:${string}`, number>
        >;

        const execution = runLiveGhostContentSmoke(
            createOptions(transport, {
                baseline: unsafeBaseline,
                summarySink: summary => {
                    summaries.push(summary);
                }
            })
        );

        await expect(execution).rejects.toMatchObject({
            category: 'schema-drift',
            code: 'invalid-schema'
        });
        expect(transport).not.toHaveBeenCalled();
        expect(summaries).toHaveLength(1);
        expect(summaries[0]).not.toContain('private-editorial-value');
    });

    it.each([
        [
            'a clock that throws',
            () => {
                throw new Error('private clock detail');
            }
        ],
        ['a non-Date observation time', () => 'private time' as unknown as Date],
        ['an invalid observation time', () => new Date(Number.NaN)]
    ])('sanitizes %s before transport', async (_name, clock) => {
        const transport = vi.fn<SmokeTransport>();

        await expect(
            runLiveGhostContentSmoke(createOptions(transport, {clock}))
        ).rejects.toMatchObject({
            category: 'operational-failure',
            code: 'clock-failure',
            message: 'Live Ghost content smoke failed: operational-failure'
        });
        expect(transport).not.toHaveBeenCalled();
    });

    it('rejects a baseline with an invalid aggregate count', async () => {
        const transport = vi.fn<SmokeTransport>();
        const identifier = `sha256:${'0'.repeat(64)}` as const;

        await expect(
            runLiveGhostContentSmoke(createOptions(transport, {baseline: {[identifier]: 0}}))
        ).rejects.toMatchObject({
            category: 'schema-drift',
            code: 'invalid-schema'
        });
        expect(transport).not.toHaveBeenCalled();
    });

    it('rejects a non-object baseline', async () => {
        const transport = vi.fn<SmokeTransport>();
        const baseline = [] as unknown as Readonly<Record<`sha256:${string}`, number>>;

        await expect(
            runLiveGhostContentSmoke(createOptions(transport, {baseline}))
        ).rejects.toMatchObject({
            category: 'schema-drift',
            code: 'invalid-schema'
        });
        expect(transport).not.toHaveBeenCalled();
    });

    it('keeps only the confirmed attribute presence and Ghost class allowlists', async () => {
        const privateAttributes = [
            'data-kg-toggle-state="private-toggle"',
            'data-kg-background-image="https://private.invalid/background.jpg"',
            'data-kg-thumbnail="https://private.invalid/thumbnail.jpg"',
            'data-kg-custom-thumbnail="https://private.invalid/custom.jpg"',
            'data-kg-transistor-embed="private-embed"'
        ].join(' ');
        const samePresenceWithDifferentValues = [
            'data-kg-toggle-state="other-toggle"',
            'data-kg-background-image="https://other.invalid/background.jpg"',
            'data-kg-thumbnail="https://other.invalid/thumbnail.jpg"',
            'data-kg-custom-thumbnail="https://other.invalid/custom.jpg"',
            'data-kg-transistor-embed="other-embed"'
        ].join(' ');
        const summaries: string[] = [];

        const report = await runLiveGhostContentSmoke(
            createOptions(
                createSuccessfulTransport(
                    [
                        `<figure class="private-class kg-card kg-image-card kg-card" ${privateAttributes} data-private="private-one"></figure>`,
                        `<figure class="other-class kg-image-card kg-card" ${samePresenceWithDifferentValues} data-private="private-two"></figure>`,
                        '<figure class="kg-card kg-image-card" data-kg-toggle-state="private-three"></figure>'
                    ],
                    []
                ),
                {
                    summarySink: summary => {
                        summaries.push(summary);
                    }
                }
            )
        );

        expect(report.signatures.map(({count}) => count).toSorted((a, b) => a - b)).toEqual([1, 2]);
        expect(summaries[0]).not.toMatch(/private|other|\.invalid|toggle|thumbnail|embed/i);
    });

    it('drops unowned kg class values from signatures and card detection', async () => {
        const report = await runLiveGhostContentSmoke(
            createOptions(
                createSuccessfulTransport(
                    [
                        '<figure class="kg-private-a kg-private-card"></figure>',
                        '<figure class="kg-private-b kg-v2"></figure>'
                    ],
                    []
                )
            )
        );
        const canonicalStructure = {
            version: 1,
            nodes: [
                {tag: 'html', parent: null, kgClasses: [], attributes: []},
                {tag: 'head', parent: 0, kgClasses: [], attributes: []},
                {tag: 'body', parent: 0, kgClasses: [], attributes: []},
                {tag: 'figure', parent: 2, kgClasses: [], attributes: []}
            ],
            headings: [],
            selectedCounts: {p: 0, pre: 0, td: 0, li: 0},
            semanticGaps: {
                caption: false,
                tableHeader: false,
                blockquote: false,
                figure: true,
                cardWrapper: false
            }
        };

        expect(report.signatures).toEqual([{id: signatureFor(canonicalStructure), count: 2}]);
    });

    it('recognizes the reviewed Ghost card family roots as wrappers', async () => {
        const familyClassTokens = [
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
        const report = await runLiveGhostContentSmoke(
            createOptions(
                createSuccessfulTransport(
                    familyClassTokens.map(className => `<div class="${className}"></div>`),
                    []
                )
            )
        );
        const expectedIds = familyClassTokens
            .map(className =>
                signatureFor({
                    version: 1,
                    nodes: [
                        {tag: 'html', parent: null, kgClasses: [], attributes: []},
                        {tag: 'head', parent: 0, kgClasses: [], attributes: []},
                        {tag: 'body', parent: 0, kgClasses: [], attributes: []},
                        {tag: 'div', parent: 2, kgClasses: [className], attributes: []}
                    ],
                    headings: [],
                    selectedCounts: {p: 0, pre: 0, td: 0, li: 0},
                    semanticGaps: {
                        caption: false,
                        tableHeader: false,
                        blockquote: false,
                        figure: false,
                        cardWrapper: true
                    }
                })
            )
            .toSorted();

        expect(report.signatures.map(({id}) => id)).toEqual(expectedIds);
    });

    it('emits the canonical preorder structure from a worked structural example', async () => {
        const renderedHtml = [
            '<h2 id=""><a name="section">Heading</a></h2>',
            '<figure class="kg-image-card kg-card"><figcaption>Figure</figcaption></figure>',
            '<table><caption>Table</caption><tbody><tr><th>Header</th><td>Cell</td></tr></tbody></table>',
            '<blockquote><pre>Quote</pre></blockquote>',
            '<ul><li>Item<p>Paragraph</p></li></ul>'
        ].join('');
        const canonicalStructure = {
            version: 1,
            nodes: [
                {tag: 'html', parent: null, kgClasses: [], attributes: []},
                {tag: 'head', parent: 0, kgClasses: [], attributes: []},
                {tag: 'body', parent: 0, kgClasses: [], attributes: []},
                {tag: 'h2', parent: 2, kgClasses: [], attributes: ['id']},
                {tag: 'a', parent: 3, kgClasses: [], attributes: ['name']},
                {
                    tag: 'figure',
                    parent: 2,
                    kgClasses: ['kg-card', 'kg-image-card'],
                    attributes: []
                },
                {tag: 'figcaption', parent: 5, kgClasses: [], attributes: []},
                {tag: 'table', parent: 2, kgClasses: [], attributes: []},
                {tag: 'caption', parent: 7, kgClasses: [], attributes: []},
                {tag: 'tbody', parent: 7, kgClasses: [], attributes: []},
                {tag: 'tr', parent: 9, kgClasses: [], attributes: []},
                {tag: 'th', parent: 10, kgClasses: [], attributes: []},
                {tag: 'td', parent: 10, kgClasses: [], attributes: []},
                {tag: 'blockquote', parent: 2, kgClasses: [], attributes: []},
                {tag: 'pre', parent: 13, kgClasses: [], attributes: []},
                {tag: 'ul', parent: 2, kgClasses: [], attributes: []},
                {tag: 'li', parent: 15, kgClasses: [], attributes: []},
                {tag: 'p', parent: 16, kgClasses: [], attributes: []}
            ],
            headings: [{level: 'h2', anchor: 'descendant'}],
            selectedCounts: {p: 1, pre: 1, td: 1, li: 1},
            semanticGaps: {
                caption: true,
                tableHeader: true,
                blockquote: true,
                figure: true,
                cardWrapper: true
            }
        };

        const report = await runLiveGhostContentSmoke(
            createOptions(createSuccessfulTransport([renderedHtml], []))
        );

        expect(report.signatures).toEqual([{id: signatureFor(canonicalStructure), count: 1}]);
    });

    it('records empty heading anchor attributes as present without treating them as anchors', async () => {
        const renderedHtml = '<h2 id=""><span name="">Heading</span></h2><p>Text</p>';
        const canonicalStructure = {
            version: 1,
            nodes: [
                {tag: 'html', parent: null, kgClasses: [], attributes: []},
                {tag: 'head', parent: 0, kgClasses: [], attributes: []},
                {tag: 'body', parent: 0, kgClasses: [], attributes: []},
                {tag: 'h2', parent: 2, kgClasses: [], attributes: ['id']},
                {tag: 'span', parent: 3, kgClasses: [], attributes: ['name']},
                {tag: 'p', parent: 2, kgClasses: [], attributes: []}
            ],
            headings: [{level: 'h2', anchor: 'none'}],
            selectedCounts: {p: 1, pre: 0, td: 0, li: 0},
            semanticGaps: {
                caption: false,
                tableHeader: false,
                blockquote: false,
                figure: false,
                cardWrapper: false
            }
        };

        const report = await runLiveGhostContentSmoke(
            createOptions(createSuccessfulTransport([renderedHtml], []))
        );

        expect(report.signatures).toEqual([{id: signatureFor(canonicalStructure), count: 1}]);
    });

    it('classifies added signatures as structural drift while missing and count changes stay non-failing', async () => {
        const postHtml = ['<p>First private value</p>', '<p>Second private value</p>'];
        const pageHtml = ['<blockquote>Third private value</blockquote>'];
        const bootstrap = await runLiveGhostContentSmoke(
            createOptions(createSuccessfulTransport(postHtml, pageHtml))
        );
        const reviewedBaseline = Object.fromEntries(
            bootstrap.signatures.map(({id, count}) => [id, count])
        ) as Record<`sha256:${string}`, number>;

        const known = await runLiveGhostContentSmoke(
            createOptions(createSuccessfulTransport(postHtml, pageHtml), {
                baseline: reviewedBaseline
            })
        );
        expect(known.category).toBe('ok');
        expect(known.drift).toEqual({added: [], missing: [], countChanged: []});

        const missingIdentifier = `sha256:${'0'.repeat(64)}` as const;
        const firstObserved = bootstrap.signatures[0];
        expect(firstObserved).toBeDefined();
        const changedBaseline = {
            ...reviewedBaseline,
            [firstObserved!.id]: firstObserved!.count + 1,
            [missingIdentifier]: 1
        };
        const changed = await runLiveGhostContentSmoke(
            createOptions(createSuccessfulTransport(postHtml, pageHtml), {
                baseline: changedBaseline
            })
        );
        expect(changed.category).toBe('ok');
        expect(changed.drift).toEqual({
            added: [],
            missing: [missingIdentifier],
            countChanged: [firstObserved!.id]
        });

        const unseenBaseline = {...reviewedBaseline};
        delete unseenBaseline[firstObserved!.id];
        const unseen = await runLiveGhostContentSmoke(
            createOptions(createSuccessfulTransport(postHtml, pageHtml), {
                baseline: unseenBaseline
            })
        );
        expect(unseen.category).toBe('structural-drift');
        expect(unseen.drift.added).toEqual([firstObserved!.id]);
    });

    it.each([
        {
            name: 'an invalid transport response',
            category: 'operational-failure',
            code: 'transport-failure',
            transport: vi.fn<SmokeTransport>(async () => null as unknown as SmokeTransportResponse)
        },
        {
            name: 'a thrown transport error',
            category: 'operational-failure',
            code: 'transport-failure',
            transport: vi.fn<SmokeTransport>(async () => {
                throw new Error('private transport detail and test-content-api-key');
            })
        },
        {
            name: 'a redirected response',
            category: 'operational-failure',
            code: 'redirect-rejected',
            transport: vi.fn<SmokeTransport>(async () => ({
                status: 200,
                redirected: true,
                body: {private: 'private redirected response'}
            }))
        },
        {
            name: 'a non-success status',
            category: 'operational-failure',
            code: 'http-failure',
            transport: vi.fn<SmokeTransport>(async () => ({
                status: 401,
                redirected: false,
                body: {private: 'private error response'}
            }))
        },
        {
            name: 'a malformed parsed body',
            category: 'schema-drift',
            code: 'invalid-schema',
            transport: vi.fn<SmokeTransport>(async () => ({
                status: 200,
                redirected: false,
                body: 'private malformed JSON input'
            }))
        },
        {
            name: 'a missing resource array',
            category: 'schema-drift',
            code: 'invalid-schema',
            transport: vi.fn<SmokeTransport>(async () => ({
                status: 200,
                redirected: false,
                body: {
                    private: 'private schema value',
                    meta: {
                        pagination: {
                            page: 1,
                            limit: 100,
                            pages: 1,
                            total: 1,
                            next: null,
                            prev: null
                        }
                    }
                }
            }))
        },
        {
            name: 'missing pagination metadata',
            category: 'schema-drift',
            code: 'invalid-schema',
            transport: vi.fn<SmokeTransport>(async request => ({
                status: 200,
                redirected: false,
                body: {[request.contentType]: [], meta: {}}
            }))
        },
        {
            name: 'an item without HTML',
            category: 'schema-drift',
            code: 'invalid-schema',
            transport: vi.fn<SmokeTransport>(async request => ({
                status: 200,
                redirected: false,
                body: {
                    [request.contentType]: [{html: {private: 'private item value'}}],
                    meta: {
                        pagination: {
                            page: 1,
                            limit: 100,
                            pages: 1,
                            total: 1,
                            next: null,
                            prev: null
                        }
                    }
                }
            }))
        }
    ])('sanitizes $name', async ({category, code, transport}) => {
        const summaries: string[] = [];

        const execution = runLiveGhostContentSmoke(
            createOptions(transport, {
                summarySink: summary => {
                    summaries.push(summary);
                }
            })
        );

        await expect(execution).rejects.toMatchObject({category, code});
        await expect(execution).rejects.not.toThrow(/private|test-content-api-key/i);
        expect(summaries).toHaveLength(1);
        expect(summaries[0]).toContain(`Result: ${category}`);
        expect(summaries[0]).not.toMatch(/private|test-content-api-key/i);
    });

    it.each([
        {
            name: 'repeated pagination',
            secondPagination: {page: 2, limit: 100, pages: 3, total: 0, next: 2, prev: 1}
        },
        {
            name: 'a changing pagination total',
            secondPagination: {page: 2, limit: 100, pages: 2, total: 1, next: null, prev: 1}
        },
        {
            name: 'an invalid current page',
            secondPagination: {page: 1, limit: 100, pages: 2, total: 0, next: 2, prev: null}
        }
    ])('rejects $name', async ({secondPagination}) => {
        let requestCount = 0;
        const transport = vi.fn<SmokeTransport>(async request => {
            requestCount += 1;
            const pagination =
                requestCount === 1
                    ? {page: 1, limit: 100, pages: 2, total: 0, next: 2, prev: null}
                    : secondPagination;
            return {
                status: 200,
                redirected: false,
                body: {[request.contentType]: [], meta: {pagination}}
            };
        });

        await expect(runLiveGhostContentSmoke(createOptions(transport))).rejects.toMatchObject({
            category: 'schema-drift',
            code: 'invalid-pagination'
        });
    });

    it('rejects a zero-item combined census', async () => {
        await expect(
            runLiveGhostContentSmoke(createOptions(createSuccessfulTransport([], [])))
        ).rejects.toMatchObject({
            category: 'schema-drift',
            code: 'empty-census'
        });
    });

    it('rejects a combined census whose items all lack html while reporting their counts', async () => {
        const summaries: string[] = [];

        const execution = runLiveGhostContentSmoke(
            createOptions(createSuccessfulTransport([null, null], [null]), {
                summarySink: summary => {
                    summaries.push(summary);
                }
            })
        );

        await expect(execution).rejects.toMatchObject({
            category: 'schema-drift',
            code: 'empty-census'
        });
        expect(summaries).toHaveLength(1);
        expect(summaries[0]).toContain('| posts | 1 | 2 | 2 |');
        expect(summaries[0]).toContain('| pages | 1 | 1 | 1 |');
        expect(summaries[0]).toContain('Distinct signatures: 0');
    });

    it('keeps baseline comparison unaffected by items without html', async () => {
        const postHtml = ['<p>First private value</p>'];
        const pageHtml = ['<blockquote>Second private value</blockquote>'];
        const bootstrap = await runLiveGhostContentSmoke(
            createOptions(createSuccessfulTransport(postHtml, pageHtml))
        );
        const reviewedBaseline = Object.fromEntries(
            bootstrap.signatures.map(({id, count}) => [id, count])
        ) as Record<`sha256:${string}`, number>;

        const withoutHtml = await runLiveGhostContentSmoke(
            createOptions(
                createSuccessfulTransport([null, ...postHtml, null], [...pageHtml, null]),
                {
                    baseline: reviewedBaseline
                }
            )
        );

        expect(withoutHtml.category).toBe('ok');
        expect(withoutHtml.drift).toEqual({added: [], missing: [], countChanged: []});
        expect(withoutHtml.signatures).toEqual(bootstrap.signatures);
        expect(withoutHtml.totals).toEqual({
            posts: {pages: 1, items: 3, itemsWithoutHtml: 2},
            pages: {pages: 1, items: 2, itemsWithoutHtml: 1}
        });
    });

    it('accepts the real extractor interface invariants across every compatibility source tag', async () => {
        const renderedHtml = [
            '<h2><a id="private-anchor">Private heading</a></h2>',
            '<p>Private paragraph</p>',
            '<pre><code>private code</code></pre>',
            '<table><tbody><tr><td>Private cell</td></tr></tbody></table>',
            '<ul><li>Private item<ul><li>Private nested item</li></ul></li></ul>'
        ].join('');

        const report = await runLiveGhostContentSmoke(
            createOptions(createSuccessfulTransport([renderedHtml], []))
        );

        expect(report.category).toBe('ok');
        expect(report.totals).toEqual({
            posts: {pages: 1, items: 1, itemsWithoutHtml: 0},
            pages: {pages: 1, items: 0, itemsWithoutHtml: 0}
        });
        expect(report.signatures).toHaveLength(1);
    });

    it('sanitizes summary sink failures', async () => {
        const execution = runLiveGhostContentSmoke(
            createOptions(createSuccessfulTransport(['<p>Private source</p>'], []), {
                summarySink: () => {
                    throw new Error('private sink failure and test-content-api-key');
                }
            })
        );

        await expect(execution).rejects.toBeInstanceOf(SmokeError);
        await expect(execution).rejects.toMatchObject({
            category: 'operational-failure',
            code: 'summary-failure',
            message: 'Live Ghost content smoke failed: operational-failure'
        });
        await expect(execution).rejects.not.toThrow(/private|test-content-api-key/i);
    });

    it('preserves the smoke failure when writing its summary also fails', async () => {
        const transport = vi.fn<SmokeTransport>(async request => ({
            status: 200,
            redirected: false,
            body: {
                [request.contentType]: 'private invalid collection',
                meta: {pagination: 'private invalid pagination'}
            }
        }));
        const execution = runLiveGhostContentSmoke(
            createOptions(transport, {
                summarySink: () => {
                    throw new Error('private sink failure and test-content-api-key');
                }
            })
        );

        await expect(execution).rejects.toMatchObject({
            category: 'schema-drift',
            code: 'invalid-schema',
            reportingCode: 'summary-failure',
            report: {category: 'schema-drift'}
        });
        await expect(execution).rejects.not.toThrow(/private|test-content-api-key/i);
    });
});
