type PolicyId = 'fragment-boundaries' | 'reject-group' | 'slice-html';
type ScenarioId =
    | 'headingless-overflow'
    | 'repeated-anchor'
    | 'single-giant-fragment'
    | 'metadata-heavy'
    | 'utf8-boundary';
type RunStatus = 'ready' | 'success' | 'failure';
type SourceTag = 'p' | 'pre' | 'td' | 'li';
type HeadingRank = 40 | 50 | 60 | 70 | 80 | 90 | 100;

interface Relation {
    readonly name: string;
    readonly slug: string;
}

interface PostProjection {
    readonly objectID: string;
    readonly slug: string;
    readonly url: string;
    readonly image: string | null;
    readonly title: string;
    readonly tags: readonly Relation[];
    readonly authors: readonly Relation[];
}

interface ExtractionFragment {
    readonly label: string;
    readonly html: string;
    readonly text: string;
    readonly headingPath: readonly string[];
    readonly anchor: string | null;
    readonly position: number;
    readonly headingRank: HeadingRank;
    readonly sourceTag: SourceTag;
}

interface Scenario {
    readonly id: ScenarioId;
    readonly name: string;
    readonly question: string;
    readonly note: string;
    readonly post: PostProjection;
    readonly fragments: readonly ExtractionFragment[];
}

interface Policy {
    readonly id: PolicyId;
    readonly name: string;
    readonly thesis: string;
    readonly boundary: string;
    readonly ids: string;
    readonly ranking: string;
    readonly failure: string;
    readonly verdict: string;
}

interface Group {
    readonly anchor: string | null;
    readonly fragments: readonly ExtractionFragment[];
}

interface AlgoliaRecord extends PostProjection {
    readonly html: string;
    readonly headings: readonly string[];
    readonly anchor: string | null;
    readonly customRanking: Readonly<{
        position: number;
        heading: HeadingRank;
    }>;
}

interface RecordResult {
    readonly record: AlgoliaRecord;
    readonly bytes: number;
    readonly sourceLabels: readonly string[];
    readonly warning: string | null;
}

interface SuccessOutcome {
    readonly kind: 'success';
    readonly records: readonly RecordResult[];
    readonly summary: string;
}

interface FailureOutcome {
    readonly kind: 'failure';
    readonly error: string;
    readonly recovery: string;
}

type Outcome = SuccessOutcome | FailureOutcome;

interface WalkthroughStep {
    readonly label: string;
    readonly action: PrototypeAction;
}

interface Walkthrough {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly steps: readonly WalkthroughStep[];
}

interface PrototypeState {
    readonly policyId: PolicyId;
    readonly scenarioId: ScenarioId;
    readonly status: RunStatus;
    readonly outcome: Outcome | null;
    readonly activeWalkthroughId: string;
    readonly nextWalkthroughStep: number;
    readonly lastChange: string;
}

type PrototypeAction =
    | Readonly<{type: 'select-policy'; policyId: PolicyId}>
    | Readonly<{type: 'select-scenario'; scenarioId: ScenarioId}>
    | Readonly<{type: 'run'}>
    | Readonly<{type: 'start-walkthrough'; walkthroughId: string}>
    | Readonly<{type: 'reset'}>;

const MAX_RECORD_BYTES = 9_999;
const DISPLAY_HTML_LIMIT = 150;

const createPost = (overrides: Partial<PostProjection> = {}): PostProjection => ({
    objectID: 'post-42',
    slug: 'long-form-guide',
    url: 'https://example.com/long-form-guide/',
    image: 'https://example.com/images/guide.jpg',
    title: 'A long-form Ghost guide',
    tags: [{name: 'Guide', slug: 'guide'}],
    authors: [{name: 'Ada Lovelace', slug: 'ada'}],
    ...overrides
});

const createParagraph = (
    label: string,
    character: string,
    count: number,
    position: number,
    anchor: string | null = null,
    headingPath: readonly string[] = [],
    headingRank: HeadingRank = 100
): ExtractionFragment => {
    const text = character.repeat(count);
    return {
        label,
        html: '<p>' + text + '</p>',
        text,
        headingPath,
        anchor,
        position,
        headingRank,
        sourceTag: 'p'
    };
};

const scenarios = [
    {
        id: 'headingless-overflow',
        name: 'Long headingless post',
        question:
            'Should ordinary paragraphs become deterministic records instead of one oversized null-anchor group?',
        note: 'Four complete paragraphs fit when packed into two records.',
        post: createPost({objectID: 'headless'}),
        fragments: [
            createParagraph('Opening paragraph', 'A', 3_900, 0),
            createParagraph('Second paragraph', 'B', 3_900, 1),
            createParagraph('Third paragraph', 'C', 3_900, 2),
            createParagraph('Closing paragraph', 'D', 3_900, 3)
        ]
    },
    {
        id: 'repeated-anchor',
        name: 'Repeated heading anchor',
        question:
            'When legacy grouping pulls non-adjacent fragments together, do continuation records retain the deep link and useful source positions?',
        note: 'The repeated setup anchor forms one legacy group while the overview remains separate.',
        post: createPost({objectID: 'repeat-anchor'}),
        fragments: [
            createParagraph('First setup paragraph', 'S', 4_500, 0, 'setup', ['Setup'], 80),
            createParagraph('Intervening overview', 'O', 120, 1, 'overview', ['Overview'], 80),
            createParagraph('Later setup paragraph', 'T', 4_500, 2, 'setup', ['Setup'], 80),
            createParagraph('Final setup paragraph', 'U', 4_500, 3, 'setup', ['Setup'], 80)
        ]
    },
    {
        id: 'single-giant-fragment',
        name: 'One giant paragraph',
        question:
            'Should the fragmenter guess where to cut inside one element, or reject it with source context?',
        note: 'The extraction fragment is the proposed indivisible unit.',
        post: createPost({objectID: 'giant-paragraph'}),
        fragments: [
            createParagraph('Giant paragraph', 'G', 11_000, 0, 'appendix', ['Appendix'], 80)
        ]
    },
    {
        id: 'metadata-heavy',
        name: 'Metadata consumes the budget',
        question:
            'Does the policy measure the complete final record when required metadata leaves no room?',
        note: 'A required title makes an otherwise small paragraph impossible to fit.',
        post: createPost({
            objectID: 'metadata-heavy',
            title: 'Required title '.repeat(760),
            image: null
        }),
        fragments: [createParagraph('Small paragraph', 'A', 40, 0, 'details', ['Details'], 80)]
    },
    {
        id: 'utf8-boundary',
        name: 'Unicode and JSON escaping',
        question:
            'Does byte-accurate packing catch content that looks short by JavaScript character count?',
        note: 'Emoji take four UTF-8 bytes; quotes and slashes grow when JSON is serialized.',
        post: createPost({objectID: 'unicode'}),
        fragments: [
            createParagraph(
                'Emoji paragraph',
                '👻',
                1_850,
                0,
                'international',
                ['International'],
                80
            ),
            createParagraph(
                'Escaped paragraph',
                '"\\',
                1_050,
                1,
                'international',
                ['International'],
                80
            ),
            createParagraph(
                'ASCII paragraph',
                'A',
                3_200,
                2,
                'international',
                ['International'],
                80
            )
        ]
    }
] as const satisfies readonly Scenario[];

const policies = [
    {
        id: 'fragment-boundaries',
        name: 'Pack whole fragments',
        thesis: 'Greedily pack complete extraction fragments under the final-record byte ceiling; reject only an indivisible fragment or required metadata.',
        boundary: 'Extraction-fragment boundary after legacy anchor grouping.',
        ids: 'Keep content_group for the first chunk; suffix continuations _1, _2, and so on.',
        ranking:
            'Each chunk uses its first source position; heading rank and deep link stay with the group.',
        failure: 'Preflight every complete output record before calling Algolia.',
        verdict: 'Recommended: deterministic, byte-accurate, valid HTML, and narrow in scope.'
    },
    {
        id: 'reject-group',
        name: 'Reject the whole group',
        thesis: 'Keep one record per legacy anchor group and reject a content item when any group is oversized.',
        boundary: 'No split boundary.',
        ids: 'Legacy IDs remain unchanged.',
        ranking: 'Legacy group position and heading rank remain unchanged.',
        failure: 'Operators must rewrite or exclude otherwise splittable content.',
        verdict: 'Safe but needlessly operational for ordinary long posts.'
    },
    {
        id: 'slice-html',
        name: 'Slice serialized HTML',
        thesis: 'Cut the merged HTML string wherever the remaining byte budget ends.',
        boundary: 'Arbitrary serialized-string boundary.',
        ids: 'Keep the legacy ID for the first slice and suffix later slices.',
        ranking: 'Every slice inherits the group position because source boundaries are lost.',
        failure: 'Slices can break tags, entities, escapes, or Unicode text.',
        verdict: 'Rejected candidate: it fits more inputs by corrupting the content boundary.'
    }
] as const satisfies readonly Policy[];

const walkthroughs = [
    {
        id: 'ordinary-overflow',
        name: 'Ordinary overflow',
        description: 'Pack whole paragraphs instead of rejecting a long headingless post.',
        steps: [
            {
                label: 'Choose whole-fragment packing',
                action: {type: 'select-policy', policyId: 'fragment-boundaries'}
            },
            {
                label: 'Load the long headingless post',
                action: {type: 'select-scenario', scenarioId: 'headingless-overflow'}
            },
            {label: 'Preflight the output', action: {type: 'run'}}
        ]
    },
    {
        id: 'indivisible-failure',
        name: 'Indivisible failure',
        description: 'Confirm that one giant paragraph fails locally without truncation.',
        steps: [
            {
                label: 'Choose whole-fragment packing',
                action: {type: 'select-policy', policyId: 'fragment-boundaries'}
            },
            {
                label: 'Load one giant paragraph',
                action: {type: 'select-scenario', scenarioId: 'single-giant-fragment'}
            },
            {label: 'Preflight the output', action: {type: 'run'}}
        ]
    },
    {
        id: 'bytes-and-metadata',
        name: 'Bytes and metadata',
        description: 'Check UTF-8 accounting, escaping, and required metadata.',
        steps: [
            {
                label: 'Choose whole-fragment packing',
                action: {type: 'select-policy', policyId: 'fragment-boundaries'}
            },
            {
                label: 'Load Unicode and escaping',
                action: {type: 'select-scenario', scenarioId: 'utf8-boundary'}
            },
            {label: 'Preflight Unicode records', action: {type: 'run'}},
            {
                label: 'Load metadata-heavy content',
                action: {type: 'select-scenario', scenarioId: 'metadata-heavy'}
            },
            {label: 'Preflight required metadata', action: {type: 'run'}}
        ]
    }
] as const satisfies readonly Walkthrough[];

const initialState: PrototypeState = {
    policyId: 'fragment-boundaries',
    scenarioId: 'headingless-overflow',
    status: 'ready',
    outcome: null,
    activeWalkthroughId: 'ordinary-overflow',
    nextWalkthroughStep: 0,
    lastChange: 'Ready to compare deterministic size policies.'
};

const utf8Bytes = (value: unknown): number =>
    new globalThis.TextEncoder().encode(JSON.stringify(value)).byteLength;

const getPolicy = (id: PolicyId): Policy => {
    const policy = policies.find(candidate => candidate.id === id);
    if (policy === undefined) {
        throw new Error('Unknown policy: ' + id);
    }
    return policy;
};

const getScenario = (id: ScenarioId): Scenario => {
    const scenario = scenarios.find(candidate => candidate.id === id);
    if (scenario === undefined) {
        throw new Error('Unknown scenario: ' + id);
    }
    return scenario;
};

const getWalkthrough = (id: string): Walkthrough => {
    const walkthrough = walkthroughs.find(candidate => candidate.id === id);
    if (walkthrough === undefined) {
        throw new Error('Unknown walkthrough: ' + id);
    }
    return walkthrough;
};

const isPolicyId = (value: string | undefined): value is PolicyId =>
    policies.some(policy => policy.id === value);

const isScenarioId = (value: string | undefined): value is ScenarioId =>
    scenarios.some(scenario => scenario.id === value);

const groupByLegacyAnchor = (fragments: readonly ExtractionFragment[]): readonly Group[] => {
    const groups: Array<{anchor: string | null; fragments: ExtractionFragment[]}> = [];
    for (const fragment of fragments) {
        const existing = groups.find(group => group.anchor === fragment.anchor);
        if (existing === undefined) {
            groups.push({anchor: fragment.anchor, fragments: [fragment]});
        } else {
            existing.fragments.push(fragment);
        }
    }
    return groups;
};

const fragmentHtml = (fragment: ExtractionFragment): string =>
    fragment.sourceTag === 'pre' ? ' ' + fragment.text : fragment.html;

const createRecord = (
    post: PostProjection,
    groupIndex: number,
    chunkIndex: number,
    fragments: readonly ExtractionFragment[],
    htmlOverride?: string
): AlgoliaRecord => {
    const first = fragments[0];
    if (first === undefined) {
        throw new Error('Cannot create a record without an extraction fragment.');
    }
    const legacyID = post.objectID + '_' + groupIndex;
    return {
        ...post,
        objectID: chunkIndex === 0 ? legacyID : legacyID + '_' + chunkIndex,
        url: first.anchor === null ? post.url : post.url + '#' + first.anchor,
        html: htmlOverride === undefined ? fragments.map(fragmentHtml).join('') : htmlOverride,
        headings: first.headingPath,
        anchor: first.anchor,
        customRanking: {
            position: first.position,
            heading: first.headingRank
        }
    };
};

const asResult = (
    record: AlgoliaRecord,
    sourceLabels: readonly string[],
    warning: string | null = null
): RecordResult => ({
    record,
    bytes: utf8Bytes(record),
    sourceLabels,
    warning
});

const fragmentFailure = (
    scenario: Scenario,
    fragment: ExtractionFragment,
    record: AlgoliaRecord
): FailureOutcome => {
    const bytes = utf8Bytes(record);
    const excess = bytes - MAX_RECORD_BYTES;
    return {
        kind: 'failure',
        error:
            'RecordSizePolicyError: "' +
            fragment.label +
            '" at source position ' +
            fragment.position +
            ' for content "' +
            scenario.post.objectID +
            '" needs ' +
            bytes.toLocaleString() +
            ' UTF-8 bytes (' +
            excess.toLocaleString() +
            ' over the ceiling).',
        recovery:
            'Shorten the indivisible source element or required projected metadata. No truncation or field stripping occurs.'
    };
};

const packWholeFragments = (scenario: Scenario): Outcome => {
    const results: RecordResult[] = [];
    for (const [groupIndex, group] of groupByLegacyAnchor(scenario.fragments).entries()) {
        let chunk: ExtractionFragment[] = [];
        let chunkIndex = 0;
        for (const fragment of group.fragments) {
            const candidateChunk = [...chunk, fragment];
            const candidate = createRecord(scenario.post, groupIndex, chunkIndex, candidateChunk);
            if (utf8Bytes(candidate) <= MAX_RECORD_BYTES) {
                chunk = candidateChunk;
                continue;
            }
            if (chunk.length > 0) {
                const complete = createRecord(scenario.post, groupIndex, chunkIndex, chunk);
                results.push(
                    asResult(
                        complete,
                        chunk.map(item => item.label)
                    )
                );
                chunkIndex += 1;
            }
            const single = createRecord(scenario.post, groupIndex, chunkIndex, [fragment]);
            if (utf8Bytes(single) > MAX_RECORD_BYTES) {
                return fragmentFailure(scenario, fragment, single);
            }
            chunk = [fragment];
        }
        if (chunk.length > 0) {
            const complete = createRecord(scenario.post, groupIndex, chunkIndex, chunk);
            results.push(
                asResult(
                    complete,
                    chunk.map(item => item.label)
                )
            );
        }
    }
    return {
        kind: 'success',
        records: results,
        summary:
            results.length +
            ' complete record' +
            (results.length === 1 ? '' : 's') +
            ' passed local UTF-8 preflight. Algolia has not been called.'
    };
};

const rejectOversizedGroup = (scenario: Scenario): Outcome => {
    const results: RecordResult[] = [];
    for (const [groupIndex, group] of groupByLegacyAnchor(scenario.fragments).entries()) {
        const record = createRecord(scenario.post, groupIndex, 0, group.fragments);
        const bytes = utf8Bytes(record);
        if (bytes > MAX_RECORD_BYTES) {
            return {
                kind: 'failure',
                error:
                    'RecordSizePolicyError: legacy group ' +
                    groupIndex +
                    ' for content "' +
                    scenario.post.objectID +
                    '" needs ' +
                    bytes.toLocaleString() +
                    ' UTF-8 bytes.',
                recovery:
                    'Rewrite or exclude the content item even when its individual fragments would fit.'
            };
        }
        results.push(
            asResult(
                record,
                group.fragments.map(fragment => fragment.label)
            )
        );
    }
    return {
        kind: 'success',
        records: results,
        summary: 'Every unchanged legacy group passed local UTF-8 preflight.'
    };
};

const largestFittingSlice = (
    post: PostProjection,
    groupIndex: number,
    chunkIndex: number,
    source: ExtractionFragment,
    html: string
): number => {
    let low = 0;
    let high = html.length;
    while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        const candidate = createRecord(
            post,
            groupIndex,
            chunkIndex,
            [source],
            html.slice(0, middle)
        );
        if (utf8Bytes(candidate) <= MAX_RECORD_BYTES) {
            low = middle;
        } else {
            high = middle - 1;
        }
    }
    return low;
};

const sliceMergedHtml = (scenario: Scenario): Outcome => {
    const results: RecordResult[] = [];
    for (const [groupIndex, group] of groupByLegacyAnchor(scenario.fragments).entries()) {
        const first = group.fragments[0];
        if (first === undefined) {
            throw new Error('Legacy group unexpectedly contained no fragments.');
        }
        let remaining = group.fragments.map(fragmentHtml).join('');
        let chunkIndex = 0;
        while (remaining.length > 0) {
            const sliceLength = largestFittingSlice(
                scenario.post,
                groupIndex,
                chunkIndex,
                first,
                remaining
            );
            if (sliceLength === 0) {
                return fragmentFailure(
                    scenario,
                    first,
                    createRecord(scenario.post, groupIndex, chunkIndex, [first], '')
                );
            }
            const html = remaining.slice(0, sliceLength);
            const record = createRecord(scenario.post, groupIndex, chunkIndex, [first], html);
            results.push(
                asResult(
                    record,
                    group.fragments.map(fragment => fragment.label),
                    'Arbitrary slicing can cut tags, entities, escape pairs, or surrogate pairs.'
                )
            );
            remaining = remaining.slice(sliceLength);
            chunkIndex += 1;
        }
    }
    return {
        kind: 'success',
        records: results,
        summary: 'The strings fit, but valid and semantically complete HTML is not preserved.'
    };
};

const runPolicy = (policyId: PolicyId, scenario: Scenario): Outcome => {
    if (policyId === 'fragment-boundaries') {
        return packWholeFragments(scenario);
    }
    if (policyId === 'reject-group') {
        return rejectOversizedGroup(scenario);
    }
    return sliceMergedHtml(scenario);
};

const transition = (state: PrototypeState, action: PrototypeAction): PrototypeState => {
    if (action.type === 'select-policy') {
        return {
            ...state,
            policyId: action.policyId,
            status: 'ready',
            outcome: null,
            lastChange: 'Selected ' + getPolicy(action.policyId).name + '.'
        };
    }
    if (action.type === 'select-scenario') {
        return {
            ...state,
            scenarioId: action.scenarioId,
            status: 'ready',
            outcome: null,
            lastChange: 'Loaded ' + getScenario(action.scenarioId).name + '.'
        };
    }
    if (action.type === 'run') {
        const outcome = runPolicy(state.policyId, getScenario(state.scenarioId));
        return {
            ...state,
            status: outcome.kind,
            outcome,
            lastChange:
                outcome.kind === 'success'
                    ? 'Preflight produced complete records.'
                    : 'Preflight rejected the content before indexing.'
        };
    }
    if (action.type === 'start-walkthrough') {
        return {
            ...initialState,
            activeWalkthroughId: action.walkthroughId,
            lastChange: 'Started ' + getWalkthrough(action.walkthroughId).name + '.'
        };
    }
    return initialState;
};

const escapeHtml = (value: string): string =>
    value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');

const clipped = (value: string): string =>
    value.length <= DISPLAY_HTML_LIMIT
        ? value
        : value.slice(0, DISPLAY_HTML_LIMIT) +
          '… (' +
          value.length.toLocaleString() +
          ' characters)';

const renderFragments = (scenario: Scenario): string =>
    scenario.fragments
        .map(fragment => {
            return (
                '<article class="fragment"><strong>' +
                escapeHtml(fragment.label) +
                '</strong><p>' +
                escapeHtml(fragment.anchor ?? 'No anchor') +
                ' · position ' +
                fragment.position +
                ' · ' +
                utf8Bytes(fragment.html).toLocaleString() +
                ' HTML bytes</p><code>' +
                escapeHtml(clipped(fragment.html)) +
                '</code></article>'
            );
        })
        .join('');

const renderRecord = (result: RecordResult): string => {
    const percent = Math.min(100, (result.bytes / MAX_RECORD_BYTES) * 100);
    const warning =
        result.warning === null
            ? ''
            : '<p class="warning"><strong>Boundary warning:</strong> ' +
              escapeHtml(result.warning) +
              '</p>';
    return (
        '<article class="record"><div class="record-head"><div><strong>' +
        escapeHtml(result.record.objectID) +
        '</strong><p>' +
        escapeHtml(result.record.url) +
        '</p></div><span>' +
        result.bytes.toLocaleString() +
        ' / ' +
        MAX_RECORD_BYTES.toLocaleString() +
        ' bytes</span></div><div class="meter"><span style="width:' +
        percent.toFixed(1) +
        '%"></span></div><dl><div><dt>Source</dt><dd>' +
        escapeHtml(result.sourceLabels.join(' + ')) +
        '</dd></div><div><dt>Headings</dt><dd>' +
        escapeHtml(result.record.headings.join(' › ') || 'None') +
        '</dd></div><div><dt>Anchor</dt><dd>' +
        escapeHtml(result.record.anchor ?? 'None') +
        '</dd></div><div><dt>Ranking</dt><dd>position ' +
        result.record.customRanking.position +
        ', heading ' +
        result.record.customRanking.heading +
        '</dd></div></dl><code>' +
        escapeHtml(clipped(result.record.html)) +
        '</code>' +
        warning +
        '</article>'
    );
};

const renderOutcome = (outcome: Outcome | null): string => {
    if (outcome === null) {
        return '<div class="empty">Choose a policy and case, then run local preflight.</div>';
    }
    if (outcome.kind === 'failure') {
        return (
            '<div class="failure"><p class="eyebrow">Rejected before Algolia</p><strong>' +
            escapeHtml(outcome.error) +
            '</strong><p>' +
            escapeHtml(outcome.recovery) +
            '</p><p>Partial indexing risk: <strong>none from this operation</strong></p></div>'
        );
    }
    return (
        '<p class="summary">' +
        escapeHtml(outcome.summary) +
        '</p><div class="record-list">' +
        outcome.records.map(renderRecord).join('') +
        '</div>'
    );
};

const renderWalkthrough = (walkthrough: Walkthrough, state: PrototypeState): string => {
    const active = walkthrough.id === state.activeWalkthroughId;
    const steps = walkthrough.steps
        .map((step, index) => {
            const complete = active && index < state.nextWalkthroughStep;
            const enabled = active && index === state.nextWalkthroughStep;
            return (
                '<button class="step ' +
                (complete ? 'complete' : '') +
                '" data-action="walkthrough-step" data-step-index="' +
                index +
                '" ' +
                (enabled ? '' : 'disabled') +
                '><span>' +
                (complete ? '✓' : index + 1) +
                '</span>' +
                escapeHtml(step.label) +
                '</button>'
            );
        })
        .join('');
    return (
        '<section class="walkthrough-panel ' +
        (active ? 'active' : '') +
        '"><p>' +
        escapeHtml(walkthrough.description) +
        '</p><div class="walkthrough-steps">' +
        steps +
        '</div></section>'
    );
};

const style =
    ':root{color-scheme:light;--ink:#17211d;--muted:#5d6d65;--line:#d9e1dc;--surface:#fff;--bg:#f2f5f2;--accent:#087f5b;--soft:#e6f5ef;--code:#14221c}' +
    '*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,sans-serif}button,select{font:inherit}button{min-height:44px}code{font-family:SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}' +
    '.shell{width:min(1180px,calc(100% - 32px));margin:0 auto;padding:48px 0 80px}.hero{max-width:900px}.kicker,.eyebrow{color:var(--accent);font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase}h1{max-width:850px;margin:8px 0 14px;font-family:Georgia,serif;font-size:clamp(34px,6vw,62px);font-weight:500;line-height:1.03}.lede{color:var(--muted);font-size:19px;line-height:1.6}.recommendation{border-left:4px solid var(--accent);padding:14px 18px;background:var(--soft);line-height:1.55}' +
    '.card{border:1px solid var(--line);border-radius:16px;background:var(--surface);box-shadow:0 10px 30px rgba(19,38,31,.05)}.section{margin-top:24px;padding:24px}.section-header{display:flex;align-items:end;justify-content:space-between;gap:16px;margin-bottom:18px}.section-header h2{margin:0}.section-header p{margin:4px 0 0;color:var(--muted)}' +
    '.policy-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.policy{display:flex;min-height:215px;flex-direction:column;align-items:flex-start;padding:18px;border:1px solid var(--line);border-radius:12px;background:#fafbf9;text-align:left;cursor:pointer}.policy:hover,.policy:focus-visible{border-color:var(--accent);outline:3px solid rgba(8,127,91,.14)}.policy.selected{border:2px solid var(--accent);background:var(--soft)}.policy strong{font-size:17px}.policy p{color:var(--muted);line-height:1.45}.policy small{margin-top:auto;font-weight:700}' +
    '.facts{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin:0}.facts div,.fragment{padding:13px;border-radius:10px;background:#f5f7f5}.facts dt,.record dt{color:var(--muted);font-size:12px;font-weight:800;text-transform:uppercase}.facts dd,.record dd{margin:5px 0 0;line-height:1.4}.controls{display:grid;grid-template-columns:1fr 1fr auto;gap:12px;align-items:end}label{display:grid;gap:6px;color:var(--muted);font-size:13px;font-weight:700}select{min-height:44px;padding:0 12px;border:1px solid var(--line);border-radius:9px;background:#fff}.run,.secondary{border:0;border-radius:9px;padding:0 18px;font-weight:800;cursor:pointer}.run{background:var(--accent);color:#fff}.secondary{border:1px solid var(--line);background:#fff}' +
    '.state-note{color:var(--muted)}.fragment-list,.record-list{display:grid;gap:10px}.fragment{display:grid;gap:8px}.fragment p{margin:4px 0;color:var(--muted)}.fragment code,.record code{display:block;padding:10px;border-radius:8px;background:var(--code);color:#e7fff4;font-size:12px}.empty{padding:28px;border:1px dashed var(--line);border-radius:10px;color:var(--muted);text-align:center}.failure{display:grid;gap:10px;padding:18px;border:1px solid #efb6b6;border-radius:10px;background:#fff0f0}.failure p,.failure strong{margin:0}.summary{padding:13px;border-radius:10px;background:var(--soft)}' +
    '.record{display:grid;gap:12px;padding:16px;border:1px solid var(--line);border-radius:12px}.record-head{display:flex;justify-content:space-between;gap:14px}.record-head p{margin:4px 0;color:var(--muted)}.record-head span{white-space:nowrap;font-weight:800}.record dl{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:0}.meter{height:8px;border-radius:999px;background:#e6ebe8;overflow:hidden}.meter span{display:block;height:100%;background:var(--accent)}.warning{margin:0;color:#8a5a00}' +
    '.tabs{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}.tab{border:1px solid var(--line);border-radius:999px;background:#fff;padding:0 16px;cursor:pointer}.tab.active{border-color:var(--accent);background:var(--soft)}.walkthrough-panel{display:none}.walkthrough-panel.active{display:block}.walkthrough-steps{display:grid;gap:8px}.step{display:flex;align-items:center;gap:12px;border:1px solid var(--line);border-radius:10px;padding:10px 14px;background:#fff;text-align:left}.step:not(:disabled){cursor:pointer;border-color:var(--accent)}.step:disabled{opacity:.55}.step.complete{background:var(--soft);opacity:1}.step span{display:grid;width:26px;height:26px;place-items:center;border-radius:50%;background:#e9edea;font-size:12px;font-weight:800}.footer{margin-top:24px;color:var(--muted);font-size:13px;text-align:center}' +
    '@media(max-width:820px){.policy-grid,.controls,.facts,.record dl{grid-template-columns:1fr}.record-head,.section-header{align-items:flex-start;flex-direction:column}}';

const root = globalThis.document.querySelector<HTMLElement>('#app');
if (root === null) {
    throw new Error('Prototype root element was not found.');
}
const stylesheet = globalThis.document.createElement('style');
stylesheet.textContent = style;
globalThis.document.head.append(stylesheet);

let state: PrototypeState = initialState;

const render = (): void => {
    const policy = getPolicy(state.policyId);
    const scenario = getScenario(state.scenarioId);
    const walkthrough = getWalkthrough(state.activeWalkthroughId);
    const policyCards = policies
        .map(candidate => {
            return (
                '<button class="policy ' +
                (candidate.id === policy.id ? 'selected' : '') +
                '" data-action="select-policy" data-policy-id="' +
                candidate.id +
                '"><strong>' +
                escapeHtml(candidate.name) +
                '</strong><p>' +
                escapeHtml(candidate.thesis) +
                '</p><small>' +
                escapeHtml(candidate.verdict) +
                '</small></button>'
            );
        })
        .join('');
    const policyOptions = policies
        .map(candidate => {
            return (
                '<option value="' +
                candidate.id +
                '" ' +
                (candidate.id === policy.id ? 'selected' : '') +
                '>' +
                escapeHtml(candidate.name) +
                '</option>'
            );
        })
        .join('');
    const scenarioOptions = scenarios
        .map(candidate => {
            return (
                '<option value="' +
                candidate.id +
                '" ' +
                (candidate.id === scenario.id ? 'selected' : '') +
                '>' +
                escapeHtml(candidate.name) +
                '</option>'
            );
        })
        .join('');
    const tabs = walkthroughs
        .map(candidate => {
            return (
                '<button class="tab ' +
                (candidate.id === walkthrough.id ? 'active' : '') +
                '" data-action="start-walkthrough" data-walkthrough-id="' +
                candidate.id +
                '">' +
                escapeHtml(candidate.name) +
                '</button>'
            );
        })
        .join('');

    root.innerHTML =
        '<main class="shell"><header class="hero"><p class="kicker">Throwaway prototype · Wayfinder decision</p><h1>What should happen when a Ghost record is too large?</h1><p class="lede">This demo tests the fragmenter size policy after legacy anchor grouping. It measures complete compact records in UTF-8 bytes and never calls Algolia.</p><p class="recommendation"><strong>Candidate to validate:</strong> pack whole extraction fragments under 9,999 bytes, preserve the first legacy ID, suffix continuations, and reject indivisible content locally.</p></header>' +
        '<section class="card section"><div class="section-header"><div><h2>1. Pick a policy</h2><p>Three deliberately different answers to the same overflow.</p></div></div><div class="policy-grid">' +
        policyCards +
        '</div></section>' +
        '<section class="card section"><div class="section-header"><div><h2>' +
        escapeHtml(policy.name) +
        '</h2><p>' +
        escapeHtml(policy.thesis) +
        '</p></div></div><dl class="facts"><div><dt>Split boundary</dt><dd>' +
        escapeHtml(policy.boundary) +
        '</dd></div><div><dt>Stable IDs</dt><dd>' +
        escapeHtml(policy.ids) +
        '</dd></div><div><dt>Ranking and links</dt><dd>' +
        escapeHtml(policy.ranking) +
        '</dd></div><div><dt>Failure</dt><dd>' +
        escapeHtml(policy.failure) +
        '</dd></div></dl></section>' +
        '<section class="card section"><div class="section-header"><div><h2>2. Drive a case</h2><p>' +
        escapeHtml(scenario.question) +
        '</p></div><button class="secondary" data-action="reset">Reset</button></div><div class="controls"><label>Policy<select data-action="policy-select">' +
        policyOptions +
        '</select></label><label>Case<select data-action="scenario-select">' +
        scenarioOptions +
        '</select></label><button class="run" data-action="run">Run local preflight</button></div><p class="state-note"><strong>Case note:</strong> ' +
        escapeHtml(scenario.note) +
        '</p><p class="state-note"><strong>Last change:</strong> ' +
        escapeHtml(state.lastChange) +
        ' · Status: ' +
        state.status +
        '</p><div class="fragment-list">' +
        renderFragments(scenario) +
        '</div></section>' +
        '<section class="card section"><div class="section-header"><div><h2>3. Inspect complete output records</h2><p>Each meter includes projected metadata, IDs, headings, ranking, URLs, and HTML.</p></div></div>' +
        renderOutcome(state.outcome) +
        '</section>' +
        '<section class="card section"><div class="section-header"><div><h2>4. Guided walkthroughs</h2><p>Start a tab, then press its numbered steps in order.</p></div></div><div class="tabs">' +
        tabs +
        '</div>' +
        walkthroughs.map(candidate => renderWalkthrough(candidate, state)).join('') +
        '</section><p class="footer">Strict TypeScript source; generated JavaScript exists only inside this double-clickable HTML artifact.</p></main>';
};

const advanceWalkthrough = (stepIndex: number): void => {
    const walkthrough = getWalkthrough(state.activeWalkthroughId);
    const step = walkthrough.steps[stepIndex];
    if (step === undefined || stepIndex !== state.nextWalkthroughStep) {
        return;
    }
    state = {
        ...transition(state, step.action),
        activeWalkthroughId: state.activeWalkthroughId,
        nextWalkthroughStep: stepIndex + 1
    };
};

root.addEventListener('click', (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof globalThis.Element)) {
        return;
    }
    const button = target.closest<HTMLButtonElement>('button[data-action]');
    if (button === null) {
        return;
    }
    const action = button.dataset.action;
    if (action === 'select-policy' && isPolicyId(button.dataset.policyId)) {
        state = transition(state, {type: 'select-policy', policyId: button.dataset.policyId});
    } else if (action === 'run') {
        state = transition(state, {type: 'run'});
    } else if (action === 'reset') {
        state = transition(state, {type: 'reset'});
    } else if (action === 'start-walkthrough' && button.dataset.walkthroughId !== undefined) {
        state = transition(state, {
            type: 'start-walkthrough',
            walkthroughId: button.dataset.walkthroughId
        });
    } else if (action === 'walkthrough-step' && button.dataset.stepIndex !== undefined) {
        const index = Number.parseInt(button.dataset.stepIndex, 10);
        if (Number.isInteger(index)) {
            advanceWalkthrough(index);
        }
    }
    render();
});

root.addEventListener('change', (event: Event): void => {
    const target = event.target;
    if (!(target instanceof globalThis.HTMLSelectElement)) {
        return;
    }
    if (target.dataset.action === 'policy-select' && isPolicyId(target.value)) {
        state = transition(state, {type: 'select-policy', policyId: target.value});
    } else if (target.dataset.action === 'scenario-select' && isScenarioId(target.value)) {
        state = transition(state, {type: 'select-scenario', scenarioId: target.value});
    }
    render();
});

render();
export {};
