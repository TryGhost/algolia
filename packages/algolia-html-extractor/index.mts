import {parse, serializeOuter, type DefaultTreeAdapterTypes} from 'parse5';

const EXTRACTED_TAG_NAMES = ['p', 'pre', 'td', 'li'] as const;

export type ExtractedTagName = (typeof EXTRACTED_TAG_NAMES)[number];

export type HeadingRank = 40 | 50 | 60 | 70 | 80 | 90 | 100;

export type ExtractionFragment = Readonly<{
    html: string;
    text: string;
    headingPath: readonly string[];
    anchor: string | null;
    position: number;
    headingRank: HeadingRank;
    sourceTag: ExtractedTagName;
}>;

type Element = DefaultTreeAdapterTypes.Element;
type Node = DefaultTreeAdapterTypes.Node;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;

const EXTRACTED_TAG_NAME_SET: ReadonlySet<string> = new Set(EXTRACTED_TAG_NAMES);

const isElement = (node: Node): node is Element => 'tagName' in node;

const getTextContent = (node: Node): string => {
    if ('value' in node) {
        return node.value;
    }

    if (!('childNodes' in node)) {
        return '';
    }

    return node.childNodes.map(getTextContent).join('');
};

const getAttribute = (element: Element, name: string): string | null => {
    return element.attrs.find(attribute => attribute.name === name)?.value ?? null;
};

const hasAnchorAttribute = (element: Element): boolean => {
    return getAttribute(element, 'name') !== null || getAttribute(element, 'id') !== null;
};

const findFirstDescendantWithAnchorAttribute = (element: Element): Element | null => {
    for (const child of element.childNodes) {
        if (!isElement(child)) {
            continue;
        }

        if (hasAnchorAttribute(child)) {
            return child;
        }

        const nestedMatch = findFirstDescendantWithAnchorAttribute(child);
        if (nestedMatch !== null) {
            return nestedMatch;
        }
    }

    return null;
};

const getAnchor = (heading: Element): string | null => {
    const directAnchor = getAttribute(heading, 'name') || getAttribute(heading, 'id') || null;
    if (directAnchor !== null) {
        return directAnchor;
    }

    const firstDescendant = findFirstDescendantWithAnchorAttribute(heading);
    return firstDescendant === null ? null : getAnchor(firstDescendant);
};

const visitElements = (node: ParentNode, visitor: (element: Element) => void): void => {
    for (const child of node.childNodes) {
        if (!isElement(child)) {
            continue;
        }

        visitor(child);
        visitElements(child, visitor);
    }
};

const getHeadingState = (
    tagName: string
): {index: number; rank: Exclude<HeadingRank, 100>} | null => {
    switch (tagName) {
        case 'h1':
            return {index: 0, rank: 90};
        case 'h2':
            return {index: 1, rank: 80};
        case 'h3':
            return {index: 2, rank: 70};
        case 'h4':
            return {index: 3, rank: 60};
        case 'h5':
            return {index: 4, rank: 50};
        case 'h6':
            return {index: 5, rank: 40};
        default:
            return null;
    }
};

const isExtractedTagName = (tagName: string): tagName is ExtractedTagName => {
    return EXTRACTED_TAG_NAME_SET.has(tagName);
};

const isPresentHeading = (value: string | null): value is string => value !== null && value !== '';

/** Returns immutable compatibility fragments in document order, preserving legacy selection. */
export function extract(renderedHtml: string): readonly ExtractionFragment[] {
    if (typeof renderedHtml !== 'string') {
        throw new TypeError('renderedHtml must be a string');
    }

    const document = parse(renderedHtml);
    const headingPath: Array<string | null> = Array.from({length: 6}, () => null);
    const fragments: ExtractionFragment[] = [];
    let activeHeadingRank: HeadingRank = 100;
    let activeAnchor: string | null = null;

    visitElements(document, element => {
        const headingState = getHeadingState(element.tagName);
        if (headingState !== null) {
            activeHeadingRank = headingState.rank;
            headingPath[headingState.index] = getTextContent(element);
            headingPath.fill(null, headingState.index + 1);

            const headingAnchor = getAnchor(element);
            if (headingAnchor !== null) {
                activeAnchor = headingAnchor;
            }
            return;
        }

        if (!isExtractedTagName(element.tagName)) {
            return;
        }

        const text = getTextContent(element);
        if (text.length === 0) {
            return;
        }

        const fragment: ExtractionFragment = Object.freeze({
            html: serializeOuter(element).trim(),
            text,
            headingPath: Object.freeze(headingPath.filter(isPresentHeading)),
            anchor: activeAnchor,
            position: fragments.length,
            headingRank: activeHeadingRank,
            sourceTag: element.tagName
        });
        fragments.push(fragment);
    });

    return Object.freeze(fragments);
}

export type ElementFragmentSource = Readonly<{
    kind: 'element';
    tagName: string;
    selection: 'content' | 'card-heading-fallback';
}>;

export type AttributeFragmentSource = Readonly<{
    kind: 'attribute';
    tagName: 'img';
    attributeName: 'alt';
}>;

export type FragmentSource = ElementFragmentSource | AttributeFragmentSource;

export type RichExtractionFragment = Readonly<
    Omit<ExtractionFragment, 'sourceTag'> & {source: FragmentSource}
>;

const RICH_TAGS: ReadonlySet<string> = new Set(['th', 'figcaption', 'cite', 'blockquote']);

const classes = (element: Element): readonly string[] =>
    (getAttribute(element, 'class') ?? '').split(/\s+/u);

const CARD_ROLES: Readonly<Record<string, readonly string[]>> = {
    'kg-button-card': ['kg-btn'],
    'kg-callout-card': ['kg-callout-text'],
    'kg-file-card': ['kg-file-card-title', 'kg-file-card-caption'],
    'kg-header-card': ['kg-header-card-button'],
    'kg-toggle-card': ['kg-toggle-content'],
    'kg-product-card': ['kg-product-card-description', 'kg-product-card-button'],
    'kg-audio-card': ['kg-audio-title'],
    'kg-video-card': [],
    'kg-signup-card': []
};

const CARD_HEADING_ROLES: Readonly<Record<string, readonly string[]>> = {
    'kg-header-card': ['kg-header-card-header', 'kg-header-card-subheader'],
    'kg-toggle-card': ['kg-toggle-heading-text'],
    'kg-product-card': ['kg-product-card-title'],
    'kg-signup-card': ['kg-signup-card-heading']
};

const isCardHeading = (element: Element, card: Element): boolean =>
    classes(card).some(
        name =>
            Object.hasOwn(CARD_HEADING_ROLES, name) &&
            (CARD_HEADING_ROLES[name]?.some(role => classes(element).includes(role)) ?? false)
    );

const closestCard = (element: Element): Element | null => {
    let current: Node | null = element.parentNode;
    while (current !== null) {
        if (isElement(current) && classes(current).includes('kg-card')) {
            return current;
        }
        current = 'parentNode' in current ? current.parentNode : null;
    }
    return null;
};

const cardRoles = (card: Element): readonly string[] | undefined => {
    const cardClass = classes(card).find(name => Object.hasOwn(CARD_ROLES, name));
    return cardClass === undefined ? undefined : CARD_ROLES[cardClass];
};

const isCardRole = (element: Element): boolean => {
    const card = closestCard(element);
    return (
        card !== null && (cardRoles(card)?.some(role => classes(element).includes(role)) ?? false)
    );
};

const CHROME_CLASSES: ReadonlySet<string> = new Set([
    'kg-audio-thumbnail',
    'kg-audio-player',
    'kg-video-player-container',
    'kg-video-overlay',
    'kg-file-card-metadata',
    'kg-file-card-icon',
    'kg-product-card-rating',
    'kg-callout-emoji',
    'kg-signup-card-form',
    'kg-bookmark-container'
]);

const NON_SEMANTIC_TAGS: ReadonlySet<string> = new Set([
    'script',
    'style',
    'template',
    'noscript',
    'svg',
    'button',
    'input',
    'select',
    'textarea',
    'option'
]);

const isExcluded = (element: Element): boolean => {
    if (
        element.tagName === 'img' &&
        ['none', 'presentation'].includes(getAttribute(element, 'role')?.toLowerCase() ?? '')
    ) {
        return true;
    }
    let withinCaption = false;
    let current: Node | null = element;
    while (current !== null) {
        if (isElement(current)) {
            withinCaption ||= current.tagName === 'figcaption';
            if (
                !withinCaption &&
                classes(current).some(name => ['kg-embed-card', 'kg-nft-card'].includes(name))
            ) {
                return true;
            }
        }
        if (
            isElement(current) &&
            (NON_SEMANTIC_TAGS.has(current.tagName) ||
                classes(current).some(name => CHROME_CLASSES.has(name)) ||
                getAttribute(current, 'hidden') !== null ||
                getAttribute(current, 'inert') !== null ||
                getAttribute(current, 'aria-hidden')?.toLowerCase() === 'true')
        ) {
            return true;
        }
        current = 'parentNode' in current ? current.parentNode : null;
    }
    return false;
};

const copyRichElement = (element: Element): Element => {
    const copy: Element = {...element, parentNode: null, childNodes: []};
    for (const child of element.childNodes) {
        if (isElement(child) && isExcluded(child)) {
            continue;
        }
        const childCopy = isElement(child) ? copyRichElement(child) : {...child};
        childCopy.parentNode = copy;
        copy.childNodes.push(childCopy);
    }
    return copy;
};

const isQualifyingElement = (element: Element): boolean => {
    if (isExtractedTagName(element.tagName)) {
        return getTextContent(element).length > 0;
    }
    const alternative = element.tagName === 'img' ? getAttribute(element, 'alt') : null;
    if (
        (!RICH_TAGS.has(element.tagName) && !isCardRole(element) && alternative === null) ||
        isExcluded(element)
    ) {
        return false;
    }
    const text = alternative ?? getTextContent(copyRichElement(element));
    return text.trim().length > 0;
};

const isRepresentedByDescendants = (element: Element): boolean => {
    let hasQualifyingDescendant = false;
    const unrepresentedText = (node: Node): string => {
        if (isElement(node)) {
            if (isQualifyingElement(node)) {
                hasQualifyingDescendant = true;
                return '';
            }
            if (isExcluded(node)) {
                return '';
            }
        }
        if ('value' in node) {
            return node.value;
        }
        return 'childNodes' in node ? node.childNodes.map(unrepresentedText).join('') : '';
    };
    const remainingText = element.childNodes.map(unrepresentedText).join('');
    return hasQualifyingDescendant && remainingText.trim().length === 0;
};

type RichCandidate = Readonly<{
    element: Element;
    compatibility: boolean;
    fragment: RichExtractionFragment;
}>;

const comparisonKey = (text: string): string =>
    text.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase();

const semanticContainer = (element: Element): Element => {
    let current: Node | null = element;
    while (current !== null) {
        if (
            isElement(current) &&
            (['figure', 'blockquote', 'table'].includes(current.tagName) ||
                getAttribute(current, 'class')?.split(/\s+/u).includes('kg-card'))
        ) {
            return current;
        }
        current = 'parentNode' in current ? current.parentNode : null;
    }
    return element;
};

const escapeText = (text: string): string =>
    text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const isHeadingFallback = (candidate: RichCandidate): boolean =>
    candidate.fragment.source.kind === 'element' &&
    candidate.fragment.source.selection === 'card-heading-fallback';

const representedCaptionKeys = (
    candidates: readonly RichCandidate[]
): ReadonlyMap<Element, ReadonlySet<string>> => {
    const captions = new Map<Element, Set<string>>();
    for (const candidate of candidates) {
        if (candidate.fragment.source.kind !== 'element') {
            continue;
        }
        let current: Node | null = candidate.element;
        while (current !== null) {
            if (isElement(current) && current.tagName === 'figcaption' && !isExcluded(current)) {
                const container = semanticContainer(current);
                const keys = captions.get(container) ?? new Set<string>();
                keys.add(comparisonKey(candidate.fragment.text));
                captions.set(container, keys);
                break;
            }
            current = 'parentNode' in current ? current.parentNode : null;
        }
    }
    return captions;
};

const emitCandidates = (
    candidates: readonly RichCandidate[]
): readonly RichExtractionFragment[] => {
    const emitted: RichExtractionFragment[] = [];
    const headingCards = new Set<Element>();
    const cardsWithContent = new Set(
        candidates
            .filter(candidate => !isHeadingFallback(candidate))
            .map(candidate => closestCard(candidate.element))
    );
    const captions = representedCaptionKeys(candidates);
    const seen = new Map<Element, Set<string>>();
    for (const candidate of candidates) {
        if (isHeadingFallback(candidate)) {
            const card = closestCard(candidate.element);
            if (card === null || headingCards.has(card) || cardsWithContent.has(card)) {
                continue;
            }
            headingCards.add(card);
        }
        if (!candidate.compatibility) {
            const container = semanticContainer(candidate.element);
            const key = comparisonKey(candidate.fragment.text);
            let duplicateCaption = false;
            if (candidate.fragment.source.kind === 'attribute') {
                duplicateCaption = captions.get(container)?.has(key) ?? false;
            }
            const keys = seen.get(container) ?? new Set<string>();
            if (duplicateCaption || keys.has(key)) {
                continue;
            }
            keys.add(key);
            seen.set(container, keys);
        }
        emitted.push(Object.freeze({...candidate.fragment, position: emitted.length}));
    }
    return Object.freeze(emitted);
};

/** Returns immutable rich fragments while keeping candidate selection and duplicate handling private. */
export function extractRich(renderedHtml: string): readonly RichExtractionFragment[] {
    if (typeof renderedHtml !== 'string') {
        throw new TypeError('renderedHtml must be a string');
    }
    const document = parse(renderedHtml);
    const headingPath: Array<string | null> = Array.from({length: 6}, () => null);
    const candidates: RichCandidate[] = [];
    let headingRank: HeadingRank = 100;
    let anchor: string | null = null;
    visitElements(document, element => {
        const heading = getHeadingState(element.tagName);
        if (heading !== null) {
            headingRank = heading.rank;
            headingPath[heading.index] = getTextContent(element);
            headingPath.fill(null, heading.index + 1);
            anchor = getAnchor(element) ?? anchor;
            const card = closestCard(element);
            if (card === null || !isCardHeading(element, card) || isExcluded(element)) {
                return;
            }
        }
        const alternative = element.tagName === 'img' ? getAttribute(element, 'alt') : null;
        if (
            !isExtractedTagName(element.tagName) &&
            !RICH_TAGS.has(element.tagName) &&
            alternative === null &&
            !isCardRole(element) &&
            heading === null
        ) {
            return;
        }
        const compatibility = isExtractedTagName(element.tagName);
        if (!compatibility && isExcluded(element)) {
            return;
        }
        const selectedElement = compatibility ? element : copyRichElement(element);
        const text = alternative ?? getTextContent(selectedElement);
        if (
            compatibility
                ? text.length === 0
                : text.trim().length === 0 || isRepresentedByDescendants(element)
        ) {
            return;
        }
        const source: FragmentSource =
            alternative === null
                ? {
                      kind: 'element',
                      tagName: element.tagName,
                      selection: heading === null ? 'content' : 'card-heading-fallback'
                  }
                : {kind: 'attribute', tagName: 'img', attributeName: 'alt'};
        candidates.push({
            element,
            compatibility,
            fragment: Object.freeze({
                html:
                    alternative === null
                        ? serializeOuter(selectedElement).trim()
                        : escapeText(text),
                text,
                headingPath: Object.freeze(headingPath.filter(isPresentHeading)),
                anchor,
                position: candidates.length,
                headingRank,
                source: Object.freeze(source)
            })
        });
    });
    return emitCandidates(candidates);
}
