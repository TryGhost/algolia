import {readFileSync} from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';

type RendererOptions = Readonly<{
    target: 'html';
    siteUrl: string;
    imageBaseUrl: string;
    canTransformImage: () => false;
    canTransformImageToFormat: () => false;
    feature: Readonly<{emailUniqueid: false; pictureImageFormats: false}>;
}>;

type Renderer = {
    render(lexicalState: string, options: RendererOptions): Promise<string>;
};

type RendererConstructor = new (options: {
    nodes: readonly unknown[];
    onError: (error: unknown) => never;
}) => Renderer;

const ghostRequire = createRequire('/var/lib/ghost/current/package.json');
const {htmlToLexical} = ghostRequire('@tryghost/kg-html-to-lexical') as {
    htmlToLexical: (sourceHtml: string) => unknown;
};
const {LexicalHTMLRenderer} = ghostRequire('@tryghost/kg-lexical-html-renderer') as {
    LexicalHTMLRenderer: RendererConstructor;
};
const {DEFAULT_NODES} = ghostRequire('@tryghost/kg-default-nodes') as {
    DEFAULT_NODES: readonly unknown[];
};

const packageVersion = (name: string): string => {
    const entry = ghostRequire.resolve(name);
    const manifestPath = path.resolve(path.dirname(entry), '../../package.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {version: string};
    return manifest.version;
};

const sourceHtml = process.argv[2];
if (sourceHtml === undefined) {
    throw new TypeError('A synthetic source HTML argument is required');
}

const lexical = htmlToLexical(sourceHtml);
const renderer = new LexicalHTMLRenderer({
    nodes: DEFAULT_NODES,
    onError: error => {
        throw error instanceof Error ? error : new Error(String(error));
    }
});
const html = await renderer.render(JSON.stringify(lexical), {
    target: 'html',
    siteUrl: 'https://fixture.invalid/',
    imageBaseUrl: '',
    canTransformImage: () => false,
    canTransformImageToFormat: () => false,
    feature: {emailUniqueid: false, pictureImageFormats: false}
});

process.stdout.write(
    JSON.stringify({
        lexical,
        html,
        versions: {
            htmlToLexical: packageVersion('@tryghost/kg-html-to-lexical'),
            lexicalHtmlRenderer: packageVersion('@tryghost/kg-lexical-html-renderer'),
            defaultNodes: packageVersion('@tryghost/kg-default-nodes')
        }
    })
);
