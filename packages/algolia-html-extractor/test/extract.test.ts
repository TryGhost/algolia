import {describe, expect, it} from 'vitest';

import {extract} from '../index.mts';

describe('extract', () => {
    it('extracts a paragraph with its active heading context', () => {
        expect(extract('<h2 id="start">Start here</h2><p>Run <strong>Ghost</strong>.</p>')).toEqual(
            [
                {
                    html: '<p>Run <strong>Ghost</strong>.</p>',
                    text: 'Run Ghost.',
                    headingPath: ['Start here'],
                    anchor: 'start',
                    position: 0,
                    headingRank: 80,
                    sourceTag: 'p'
                }
            ]
        );
    });

    it('tracks heading hierarchy, ranks, resets, and legacy anchors', () => {
        const renderedHtml = [
            '<p>Outside.</p>',
            '<h1 name="one" id="ignored">One</h1><p>First.</p>',
            '<h3><span id="three">Three</span></h3><p>Third.</p>',
            '<h2>Two</h2><p>Second.</p>',
            '<h4 id="four">Four</h4><p>Fourth.</p>',
            '<h5 id="five">Five</h5><p>Fifth.</p>',
            '<h6 id="six">Six</h6><p>Sixth.</p>',
            '<h1 id="reset">Reset</h1><p>After reset.</p>'
        ].join('');

        expect(extract(renderedHtml)).toEqual([
            {
                html: '<p>Outside.</p>',
                text: 'Outside.',
                headingPath: [],
                anchor: null,
                position: 0,
                headingRank: 100,
                sourceTag: 'p'
            },
            {
                html: '<p>First.</p>',
                text: 'First.',
                headingPath: ['One'],
                anchor: 'one',
                position: 1,
                headingRank: 90,
                sourceTag: 'p'
            },
            {
                html: '<p>Third.</p>',
                text: 'Third.',
                headingPath: ['One', 'Three'],
                anchor: 'three',
                position: 2,
                headingRank: 70,
                sourceTag: 'p'
            },
            {
                html: '<p>Second.</p>',
                text: 'Second.',
                headingPath: ['One', 'Two'],
                anchor: 'three',
                position: 3,
                headingRank: 80,
                sourceTag: 'p'
            },
            {
                html: '<p>Fourth.</p>',
                text: 'Fourth.',
                headingPath: ['One', 'Two', 'Four'],
                anchor: 'four',
                position: 4,
                headingRank: 60,
                sourceTag: 'p'
            },
            {
                html: '<p>Fifth.</p>',
                text: 'Fifth.',
                headingPath: ['One', 'Two', 'Four', 'Five'],
                anchor: 'five',
                position: 5,
                headingRank: 50,
                sourceTag: 'p'
            },
            {
                html: '<p>Sixth.</p>',
                text: 'Sixth.',
                headingPath: ['One', 'Two', 'Four', 'Five', 'Six'],
                anchor: 'six',
                position: 6,
                headingRank: 40,
                sourceTag: 'p'
            },
            {
                html: '<p>After reset.</p>',
                text: 'After reset.',
                headingPath: ['Reset'],
                anchor: 'reset',
                position: 7,
                headingRank: 90,
                sourceTag: 'p'
            }
        ]);
    });

    it('carries the previous anchor past an empty direct id', () => {
        const renderedHtml = [
            '<h2 id="previous">Previous</h2><p>Before.</p>',
            '<h2 id="">Empty direct id</h2><p>After.</p>'
        ].join('');

        expect(extract(renderedHtml).map(fragment => fragment.anchor)).toEqual([
            'previous',
            'previous'
        ]);
    });

    it('resolves only within the first descendant carrying name or id', () => {
        const renderedHtml = [
            '<h2 id="previous">Previous</h2><p>Before.</p>',
            '<h2><span id=""></span><span id="later">Later branch</span>Heading</h2>',
            '<p>After ignored later branch.</p>',
            '<h2><span name=""><b id="nested">Nested anchor</b></span>',
            '<span id="also-later">Also later</span>Nested heading</h2>',
            '<p>After nested resolution.</p>'
        ].join('');

        expect(extract(renderedHtml).map(fragment => fragment.anchor)).toEqual([
            'previous',
            'previous',
            'nested'
        ]);
    });

    it('emits selected nested elements in document order with exact HTML5 content', () => {
        const renderedHtml = [
            '<h2 id="flow">Flow</h2>',
            '<ul><li>Outer <p>Nested &amp; <strong>bold</strong><br> café 👻</p>',
            '<ul><li>Inner</li></ul></li></ul>',
            '<pre><code>x&lt;y</code></pre>',
            '<table><tbody><tr><td>Cell</td></tr></tbody></table>',
            '<p></p><p> </p>'
        ].join('');

        expect(extract(renderedHtml)).toEqual([
            {
                html: '<li>Outer <p>Nested &amp; <strong>bold</strong><br> café 👻</p><ul><li>Inner</li></ul></li>',
                text: 'Outer Nested & bold café 👻Inner',
                headingPath: ['Flow'],
                anchor: 'flow',
                position: 0,
                headingRank: 80,
                sourceTag: 'li'
            },
            {
                html: '<p>Nested &amp; <strong>bold</strong><br> café 👻</p>',
                text: 'Nested & bold café 👻',
                headingPath: ['Flow'],
                anchor: 'flow',
                position: 1,
                headingRank: 80,
                sourceTag: 'p'
            },
            {
                html: '<li>Inner</li>',
                text: 'Inner',
                headingPath: ['Flow'],
                anchor: 'flow',
                position: 2,
                headingRank: 80,
                sourceTag: 'li'
            },
            {
                html: '<pre><code>x&lt;y</code></pre>',
                text: 'x<y',
                headingPath: ['Flow'],
                anchor: 'flow',
                position: 3,
                headingRank: 80,
                sourceTag: 'pre'
            },
            {
                html: '<td>Cell</td>',
                text: 'Cell',
                headingPath: ['Flow'],
                anchor: 'flow',
                position: 4,
                headingRank: 80,
                sourceTag: 'td'
            },
            {
                html: '<p> </p>',
                text: ' ',
                headingPath: ['Flow'],
                anchor: 'flow',
                position: 5,
                headingRank: 80,
                sourceTag: 'p'
            }
        ]);
    });

    it('uses normal HTML5 recovery for malformed table content', () => {
        expect(extract('<h2 id=table>Table<table><td>Recovered cell')).toEqual([
            {
                html: '<td>Recovered cell</td>',
                text: 'Recovered cell',
                headingPath: ['TableRecovered cell'],
                anchor: 'table',
                position: 0,
                headingRank: 80,
                sourceTag: 'td'
            }
        ]);
    });

    it('parses a document rather than treating orphan table cells as a fragment context', () => {
        expect(extract('<td>Orphan cell</td><p>After orphan.</p>')).toEqual([
            {
                html: '<p>After orphan.</p>',
                text: 'After orphan.',
                headingPath: [],
                anchor: null,
                position: 0,
                headingRank: 100,
                sourceTag: 'p'
            }
        ]);
    });

    it('preserves HTML integration points inside foreign content', () => {
        const renderedHtml = [
            '<svg viewBox="0 0 1 1"><foreignObject>',
            '<p>Inside SVG &amp; <br></p>',
            '</foreignObject></svg>',
            '<math><mtext><p>Inside MathML.</p></mtext></math>',
            '<p>Outside.</p>'
        ].join('');

        expect(extract(renderedHtml)).toEqual([
            {
                html: '<p>Inside SVG &amp; <br></p>',
                text: 'Inside SVG & ',
                headingPath: [],
                anchor: null,
                position: 0,
                headingRank: 100,
                sourceTag: 'p'
            },
            {
                html: '<p>Inside MathML.</p>',
                text: 'Inside MathML.',
                headingPath: [],
                anchor: null,
                position: 1,
                headingRank: 100,
                sourceTag: 'p'
            },
            {
                html: '<p>Outside.</p>',
                text: 'Outside.',
                headingPath: [],
                anchor: null,
                position: 2,
                headingRank: 100,
                sourceTag: 'p'
            }
        ]);
    });

    it('keeps intentional legacy semantic gaps outside the extraction stream', () => {
        const renderedHtml = [
            '<figure class="kg-card kg-image-card">',
            '<img src="https://fixture.invalid/image.png" alt="Ignored alternative">',
            '<figcaption>Ignored caption</figcaption></figure>',
            '<blockquote>Ignored wrapper<p>Selected paragraph.</p></blockquote>',
            '<table><tr><th>Ignored header</th><td>Selected cell.</td></tr></table>'
        ].join('');

        expect(extract(renderedHtml)).toEqual([
            {
                html: '<p>Selected paragraph.</p>',
                text: 'Selected paragraph.',
                headingPath: [],
                anchor: null,
                position: 0,
                headingRank: 100,
                sourceTag: 'p'
            },
            {
                html: '<td>Selected cell.</td>',
                text: 'Selected cell.',
                headingPath: [],
                anchor: null,
                position: 1,
                headingRank: 100,
                sourceTag: 'td'
            }
        ]);
    });

    it('returns deeply immutable values and rejects only non-string inputs', () => {
        const empty = extract('');
        const fragments = extract('<p>Immutable.</p>');

        expect(empty).toEqual([]);
        expect(Object.isFrozen(empty)).toBe(true);
        expect(Object.isFrozen(fragments)).toBe(true);
        expect(Object.isFrozen(fragments[0])).toBe(true);
        expect(Object.isFrozen(fragments[0]?.headingPath)).toBe(true);
        expect(() => extract(42 as unknown as string)).toThrow(TypeError);
    });
});
