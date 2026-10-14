import {createRequire} from 'node:module';
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve, dirname} from 'node:path';

const manifest = process.argv[2];
if (manifest === undefined) {
    throw new Error(
        'Pass the package.json path of a Ghost checkout with installed renderer dependencies.'
    );
}
const require = createRequire(resolve(manifest));
const version = (name: string): string => {
    const file = resolve(dirname(require.resolve(name)), '../../package.json');
    return (JSON.parse(readFileSync(file, 'utf8')) as {version: string}).version;
};
const versions = {
    lexicalHtmlRenderer: version('@tryghost/kg-lexical-html-renderer'),
    defaultNodes: version('@tryghost/kg-default-nodes')
};
if (versions.lexicalHtmlRenderer !== '1.5.2' || versions.defaultNodes !== '2.2.4') {
    throw new Error('Capture requires the reviewed renderer and node versions.');
}
const {LexicalHTMLRenderer} = require('@tryghost/kg-lexical-html-renderer') as {
    LexicalHTMLRenderer: new (options: {
        nodes: readonly unknown[];
        onError: (error: unknown) => never;
    }) => {
        render(source: string, options: Readonly<Record<string, unknown>>): Promise<string>;
    };
};
const {DEFAULT_NODES} = require('@tryghost/kg-default-nodes') as {
    DEFAULT_NODES: readonly unknown[];
};
const specimens: readonly Readonly<Record<string, unknown>>[] = [
    {type: 'button', buttonText: 'Explore the guide', buttonUrl: 'https://fixture.invalid/guide/'},
    {type: 'callout', calloutText: 'Authored callout', calloutEmoji: '💡'},
    {
        type: 'file',
        src: 'https://fixture.invalid/file.pdf',
        fileTitle: 'Authored file title',
        fileCaption: 'Authored file caption',
        fileName: 'chrome.pdf',
        fileSize: 12345
    },
    {
        type: 'header',
        header: 'Authored header',
        subheader: 'Authored subheader',
        buttonEnabled: true,
        buttonText: 'Explore header',
        buttonUrl: 'https://fixture.invalid/header/'
    },
    {type: 'header', header: 'Heading only'},
    {type: 'toggle', heading: 'Authored toggle heading', content: 'Authored toggle content'},
    {
        type: 'product',
        productTitle: 'Authored product',
        productDescription: 'Authored product description',
        productButtonEnabled: true,
        productButton: 'Explore product',
        productUrl: 'https://fixture.invalid/product/',
        productRatingEnabled: true
    },
    {
        type: 'audio',
        src: 'https://fixture.invalid/audio.mp3',
        title: 'Authored audio title',
        duration: 99,
        thumbnailSrc: 'https://fixture.invalid/thumb.png'
    },
    {
        type: 'video',
        src: 'https://fixture.invalid/video.mp4',
        caption: 'Authored video caption',
        fileName: 'chrome.mp4',
        duration: 99,
        width: 640,
        height: 480
    },
    {
        type: 'signup',
        header: 'Authored signup heading',
        subheader: 'Authored signup introduction',
        disclaimer: 'Authored signup disclaimer',
        buttonText: 'Subscribe control',
        successMessage: 'Generated success state'
    }
];
const renderer = new LexicalHTMLRenderer({
    nodes: DEFAULT_NODES,
    onError: error => {
        throw error;
    }
});
const fixtures = [];
for (const [index, specimen] of specimens.entries()) {
    const lexical = {
        root: {
            type: 'root',
            version: 1,
            children: [{version: 1, ...specimen}],
            direction: null,
            format: '',
            indent: 0
        }
    };
    const html = await renderer.render(JSON.stringify(lexical), {
        target: 'html',
        siteUrl: 'https://fixture.invalid/',
        imageBaseUrl: '',
        canTransformImage: () => false,
        canTransformImageToFormat: () => false,
        feature: {emailUniqueid: false, pictureImageFormats: false}
    });
    fixtures.push({id: `${specimen.type}-${index}`, lexical, html});
}
writeFileSync(
    new URL('./rendered.json', import.meta.url),
    `${JSON.stringify({versions, fixtures}, null, 2)}\n`
);
