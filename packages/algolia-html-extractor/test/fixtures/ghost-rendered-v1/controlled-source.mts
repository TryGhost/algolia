export type ControlledFamily = Readonly<{
    id: 'legacy-selected-flow' | 'intentional-semantic-gaps' | 'controlled-card-boundary';
    sourceId: string;
    purpose: string;
    sourceHtml: string;
}>;

export const controlledFamilies = [
    {
        id: 'legacy-selected-flow',
        sourceId: 'synthetic-html-import-legacy-flow-v1',
        purpose: 'Exercise every legacy-selected tag in a Ghost-rendered hierarchy.',
        sourceHtml: [
            '<h2>Legacy selected flow</h2>',
            '<p>Before <strong>inline</strong> &amp; café 👻 with ',
            '<a href="https://fixture.invalid/guide/">a synthetic link</a>.</p>',
            '<h3>Lists and code</h3>',
            '<ol><li>First ordered</li><li>Second ordered',
            '<ul><li>Nested unordered</li></ul></li></ol>',
            '<pre><code class="language-js">const selected = true;\nconsole.log(selected);</code></pre>',
            '<table><thead><tr><th>Ignored header</th></tr></thead>',
            '<tbody><tr><td>Selected body cell</td></tr></tbody></table>',
            '<p>After the controlled table.</p>'
        ].join('')
    },
    {
        id: 'intentional-semantic-gaps',
        sourceId: 'synthetic-html-import-semantic-gaps-v1',
        purpose: 'Freeze Ghost-rendered structures that compatibility intentionally ignores.',
        sourceHtml: [
            '<h2>Intentional semantic gaps</h2>',
            '<figure class="kg-card kg-image-card">',
            '<img src="https://fixture.invalid/images/gap.png" alt="Ignored synthetic alternative" ',
            'width="1200" height="630">',
            '<figcaption>Ignored synthetic caption</figcaption></figure>',
            '<blockquote>Synthetic blockquote text.</blockquote>',
            '<table><thead><tr><th>Ignored semantic header</th></tr></thead>',
            '<tbody><tr><td>Selected semantic cell</td></tr></tbody></table>',
            '<div class="kg-card kg-embed-card">',
            '<iframe src="https://embed.fixture.invalid/card" title="Synthetic embed"></iframe>',
            '</div>'
        ].join('')
    },
    {
        id: 'controlled-card-boundary',
        sourceId: 'synthetic-html-import-image-card-v1',
        purpose: 'Reproduce the existing controlled image-card boundary without a live census.',
        sourceHtml: [
            '<h2>Controlled card boundary</h2>',
            '<p>Before the synthetic image card.</p>',
            '<figure class="kg-card kg-image-card">',
            '<img src="https://fixture.invalid/images/content-card.png" ',
            'alt="Synthetic fixture image" width="1200" height="630">',
            '</figure>',
            '<p>After the synthetic image card.</p>'
        ].join('')
    }
] as const satisfies readonly ControlledFamily[];
