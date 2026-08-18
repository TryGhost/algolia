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
