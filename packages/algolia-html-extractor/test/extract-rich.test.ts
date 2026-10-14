import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {extract, extractRich} from '../index.mts';

describe('extractRich', () => {
    it('keeps an image alternative when only part of its caption is represented', () => {
        const html =
            '<figure><img alt="Quote Author"><figcaption>Quote <cite>Author</cite></figcaption></figure>';
        expect(extractRich(html).map(fragment => fragment.text)).toEqual([
            'Quote Author',
            'Author'
        ]);
    });
    it('adds semantic units in order with inherited heading context and immutable sources', () => {
        const html =
            '<h2 id="start">Start</h2><table><tr><th>Header</th><td>Cell</td></tr></table><blockquote>Quote</blockquote><cite>Author</cite>';
        const fragments = extractRich(html);
        expect(
            fragments.map(fragment => [fragment.text, fragment.source, fragment.position])
        ).toEqual([
            ['Header', {kind: 'element', tagName: 'th', selection: 'content'}, 0],
            ['Cell', {kind: 'element', tagName: 'td', selection: 'content'}, 1],
            ['Quote', {kind: 'element', tagName: 'blockquote', selection: 'content'}, 2],
            ['Author', {kind: 'element', tagName: 'cite', selection: 'content'}, 3]
        ]);
        for (const fragment of fragments) {
            expect(fragment.headingPath).toEqual(['Start']);
            expect(fragment.anchor).toBe('start');
            expect(fragment.headingRank).toBe(80);
            expect(Object.isFrozen(fragment)).toBe(true);
            expect(Object.isFrozen(fragment.source)).toBe(true);
            expect(Object.isFrozen(fragment.headingPath)).toBe(true);
        }
        expect(Object.isFrozen(fragments)).toBe(true);
        expect(extract(html).map(fragment => [fragment.text, fragment.position])).toEqual([
            ['Cell', 0]
        ]);
    });
    it('selects the smallest eligible units without changing hidden compatibility fragments', () => {
        const html =
            '<blockquote><p>Quote</p><cite>Author</cite></blockquote>' +
            '<figcaption><p>Caption</p></figcaption><th>   </th>' +
            '<div hidden><cite>Hidden citation</cite><p>Legacy hidden</p></div>' +
            '<div inert><blockquote>Inert quote</blockquote></div>' +
            '<div aria-hidden="true"><figcaption>Hidden caption</figcaption></div>' +
            '<svg><title>Chrome</title><foreignObject><cite>SVG text</cite></foreignObject></svg>' +
            '<button><cite>Control</cite></button><div>Unknown wrapper</div>';
        expect(extractRich(html).map(fragment => fragment.text)).toEqual([
            'Quote',
            'Author',
            'Caption',
            'Legacy hidden'
        ]);
    });

    it('escapes image alternatives and suppresses normalized duplicates only inside their figure', () => {
        const fragments = extractRich(
            '<figure><img alt="  Cafe&#769; &amp; &lt;view&gt;  "><figcaption>CAFÉ &amp; &lt;view&gt;</figcaption></figure>' +
                '<figure><img alt="  Other &amp; &lt;view&gt;  "><figcaption>Caption</figcaption></figure>' +
                '<figure><img alt="Caption"></figure><img alt="  ">'
        );
        expect(fragments.map(fragment => fragment.text)).toEqual([
            'CAFÉ & <view>',
            '  Other & <view>  ',
            'Caption',
            'Caption'
        ]);
        expect(fragments[1]).toMatchObject({
            html: '  Other &amp; &lt;view&gt;  ',
            source: {kind: 'attribute', tagName: 'img', attributeName: 'alt'}
        });
        expect(
            extractRich('<img alt="Same"><img alt="Same">').map(fragment => fragment.text)
        ).toEqual(['Same', 'Same']);
    });

    it('indexes authored card roles from controlled Ghost output without their chrome', () => {
        const captured = JSON.parse(
            readFileSync(new URL('./fixtures/rich-cards-v1/rendered.json', import.meta.url), 'utf8')
        ) as {fixtures: {id: string; html: string}[]};
        expect(
            captured.fixtures.map(fixture => [
                fixture.id,
                extractRich(fixture.html).map(fragment => fragment.text)
            ])
        ).toEqual([
            ['button-0', ['Explore the guide']],
            ['callout-1', ['Authored callout']],
            ['file-2', ['Authored file title', 'Authored file caption']],
            ['header-3', [' Explore header ']],
            ['header-4', [' Heading only ']],
            ['toggle-5', ['Authored toggle content']],
            ['product-6', ['Authored product description', 'Explore product']],
            ['audio-7', ['Authored audio title']],
            ['video-8', ['Authored video caption']],
            ['signup-9', ['Authored signup introduction', 'Authored signup disclaimer']]
        ]);
        const heading = captured.fixtures.find(fixture => fixture.id === 'header-4');
        expect(extractRich(heading!.html)[0]).toMatchObject({
            source: {kind: 'element', tagName: 'h2', selection: 'card-heading-fallback'},
            anchor: 'heading-only',
            headingPath: [' Heading only ']
        });
    });

    it('excludes decorative and provider alternatives but keeps authored embed captions and unknown-card semantic descendants', () => {
        expect(
            extractRich(
                '<img alt="Decorative" role="presentation"><img alt="Decorative" role="none">' +
                    '<figure class="kg-card kg-embed-card"><div><img alt="Provider chrome"></div><figcaption>Authored embed caption</figcaption></figure>' +
                    '<div class="kg-card kg-unknown-card">Wrapper text<figcaption>General caption</figcaption><p>Legacy</p></div>' +
                    '<figcaption>Container<img alt="Smallest alternative"></figcaption>'
            ).map(fragment => fragment.text)
        ).toEqual(['Authored embed caption', 'General caption', 'Legacy', 'Smallest alternative']);
    });

    it('uses only authored card headings for fallback and keeps duplicate meaning in separate containers', () => {
        expect(
            extractRich(
                '<div class="kg-card kg-header-card"><div><h2>Unknown heading role</h2></div></div>'
            )
        ).toEqual([]);
        const html =
            '<blockquote><cite>Café</cite><cite>CAFE&#769;</cite><cite>Cafe</cite><cite>Café!</cite><p>Café</p></blockquote>' +
            '<blockquote><cite>Café</cite></blockquote>';
        expect(extractRich(html).map(fragment => fragment.text)).toEqual([
            'Café',
            'Cafe',
            'Café!',
            'Café',
            'Café'
        ]);
    });

    it('retains equal blockquotes inside separate local containers', () => {
        expect(
            extractRich(
                '<figure><blockquote>Same</blockquote><blockquote>Same</blockquote></figure>'
            ).map(fragment => fragment.text)
        ).toEqual(['Same', 'Same']);
    });

    it('preserves source values, legacy heading carry-forward, and native input errors', () => {
        const fragments = extractRich(
            '<h2 id="kept">First</h2><h3>Second</h3><figcaption> Visible <span hidden>source</span> </figcaption>' +
                '<figure><img alt=" Multiple&#9;spaces "><figcaption>multiple spaces</figcaption></figure>'
        );
        expect(fragments[0]).toMatchObject({
            html: '<figcaption> Visible <span hidden="">source</span> </figcaption>',
            text: ' Visible source ',
            headingPath: ['First', 'Second'],
            anchor: 'kept',
            headingRank: 70
        });
        expect(fragments.map(fragment => fragment.text)).toEqual([
            ' Visible source ',
            'multiple spaces'
        ]);
        expect(extractRich('')).toEqual([]);
        // @ts-expect-error Runtime callers can supply a non-string value.
        expect(() => extractRich(null)).toThrow(TypeError);
    });

    it('omits rich meaning under excluded subtrees while retaining legacy observations', () => {
        const html =
            '<div hidden><h2 id="hidden-heading">Hidden heading</h2><cite>Hidden</cite><p>Preserved</p></div>' +
            '<div aria-hidden="TRUE"><img alt="Hidden image"></div><div inert><figcaption>Inert caption</figcaption></div>' +
            '<script>ignored</script><style>ignored</style><template><cite>Template</cite></template><noscript><cite>No script</cite></noscript>' +
            '<div class="kg-card kg-callout-card"><div class="kg-callout-text"><p>Selected child</p></div></div>' +
            '<div class="kg-card kg-header-card"><h2 class="kg-header-card-header">First fallback</h2><h3 class="kg-header-card-subheader">Second fallback</h3></div>';
        expect(extractRich(html).map(fragment => fragment.text)).toEqual([
            'Preserved',
            'Selected child',
            'First fallback'
        ]);
        expect(extractRich(html)[1]).toMatchObject({
            anchor: 'hidden-heading',
            headingPath: ['Hidden heading']
        });
    });
    it('gives a caption represented by a legacy paragraph precedence over its equal image alternative', () => {
        expect(
            extractRich(
                '<figure><img alt="  CAFÉ  "><figcaption><p>Café</p></figcaption></figure>' +
                    '<figure><img alt="Café"></figure>'
            ).map(fragment => [fragment.text, fragment.source])
        ).toEqual([
            ['Café', {kind: 'element', tagName: 'p', selection: 'content'}],
            ['Café', {kind: 'attribute', tagName: 'img', attributeName: 'alt'}]
        ]);
    });

    it('recovers malformed HTML and emits no placeholder for chrome-only cards', () => {
        expect(
            extractRich('<figure><img alt="Recovered"><figcaption>Unclosed').map(
                fragment => fragment.text
            )
        ).toEqual(['Recovered', 'Unclosed']);
        expect(
            extractRich(
                '<div class="kg-card kg-audio-card"><img class="kg-audio-thumbnail" alt="audio-thumbnail"><button>Play</button></div>'
            )
        ).toEqual([]);
        expect(
            extractRich('<blockquote>Loose quote <cite>Attribution</cite></blockquote>').map(
                fragment => fragment.text
            )
        ).toEqual(['Attribution']);
    });

    it('uses immutable controlled renderer evidence with recorded integrity', () => {
        const root = new URL('./fixtures/rich-cards-v1/', import.meta.url);
        const integrity = JSON.parse(
            readFileSync(new URL('integrity.json', root), 'utf8')
        ) as Record<string, {bytes: number; sha256: string}>;
        expect(Object.keys(integrity).sort()).toEqual(['capture.mts', 'rendered.json']);
        for (const [name, expected] of Object.entries(integrity)) {
            const bytes = readFileSync(new URL(name, root));
            expect({
                bytes: bytes.length,
                sha256: createHash('sha256').update(bytes).digest('hex')
            }).toEqual(expected);
        }
    });
    it('does not suppress the only meaning when an image is the caption smallest unit', () => {
        expect(
            extractRich('<figure><figcaption>Same<img alt="Same"></figcaption></figure>').map(
                fragment => fragment.text
            )
        ).toEqual(['Same']);
    });
});
