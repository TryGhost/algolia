import {describe, expect, it} from 'vitest';

import transforms from '../index.js';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));

const readFixture = (fileName) => {
    return fs.readFileSync(path.join(testDirectory, `fixtures`, `${fileName}.html`), {encoding: `utf8`});
};

describe('Algolia Transforms', function () {
    it('Can reduce fragments under headings correctly', function () {
        let fragments = [
            {
                html: '<p>Before getting started, you\'ll need these global packages to be installed:</p>',
                content: 'Before getting started, you\'ll need these global packages to be installed:',
                headings: ['Pre-requisites'],
                anchor: 'pre-requisites',
                customRanking: {position: 1, heading: 80},
                objectID: '931c35eda23999b8124728b4bf4979eb'
            },
            {
                html: '<li><strong>A <a href="https://docs.ghost.org/faq/node-versions/">supported version</a> of <a href="https://nodejs.org" target="_blank" rel="nofollow noopener noreferrer">Node.js</a></strong> - Ideally installed via <a href="https://github.com/creationix/nvm#install-script" target="_blank" rel="nofollow noopener noreferrer">nvm</a></li>',
                content: 'A supported version of Node.js - Ideally installed via nvm',
                headings: ['Pre-requisites'],
                anchor: 'pre-requisites',

                customRanking: {position: 2, heading: 80},
                objectID: 'dcbe237f62a97a33e1a9d8880c577933'
            },
            {
                html: '<li><strong><a href="https://yarnpkg.com/en/docs/install#alternatives-tab" target="_blank" rel="nofollow noopener noreferrer">Yarn</a></strong> - to manage all the packages</li>',
                content: 'Yarn - to manage all the packages',
                headings: ['Pre-requisites'],
                anchor: 'pre-requisites',

                customRanking: {position: 3, heading: 80},
                objectID: '49e23962e997062e388a060735442633'
            },
            {
                html: '<pre class="language-bash"><code class="language-bash">yarn global add knex-migrator grunt-cli ember-cli bower</code></pre>',
                content: 'yarn global add knex-migrator grunt-cli ember-cli bower',
                headings: ['Pre-requisites', 'The install these global packages'],
                anchor: 'the-install-these-global-packages',

                customRanking: {position: 4, heading: 60},
                objectID: 'b1a9a06228097949e1b9f0cfcb7fe352'
            }
        ];

        let reducedFragments = fragments.reduce(transforms._testReduceFragmentsUnderHeadings, []);

        // We start with 4 elements, and end up with 2
        expect(reducedFragments).toHaveLength(2);
        // The content gets merged to contain all 3 strings
        expect(reducedFragments[0].content).toMatch(/getting started/);
        expect(reducedFragments[0].content).toMatch(/supported version/);
        expect(reducedFragments[0].content).toMatch(/manage all the packages/);
    });

    it('Processes minimal example correctly', function () {
        const fakeNode = {
            objectID: `abc`,
            title: `Install from Source`,
            url: `/install/source/`,
            html: readFixture(`minimal-example`)
        };
        let reducedFragments = transforms.fragmentTransformer([], fakeNode);

        expect(reducedFragments).toHaveLength(4);
        expect(reducedFragments[1].url).toBe('/install/source/#pre-requisites');
    });

    it('merges multiple nodes correctly', function () {
        const fakeNodes = [{
            objectID: `abc`,
            title: `Install from Source`,
            url: `/install/source/`,
            html: readFixture(`minimal-example`)
        }, {
            objectID: `def`,
            title: `Install Test`,
            url: `/install/test/`,
            html: `<p>I am a test</p><h2 id="testing">Testing</h1><p>I am a subtest</p>`
        }];

        let reducedFragments = fakeNodes.reduce(transforms.fragmentTransformer, []);

        expect(reducedFragments).toHaveLength(6);
        expect(reducedFragments[0].url).toBe('/install/source/');
        expect(reducedFragments[1].url).toBe('/install/source/#pre-requisites');
        expect(reducedFragments[4].url).toBe('/install/test/');
        expect(reducedFragments[5].url).toBe('/install/test/#testing');
    });

    it('Processes massive example correctly', function () {
        const fakeNode = {
            objectID: `abc`,
            title: `Install from Source`,
            url: `/install/source/`,
            html: readFixture(`massive-example`)
        };

        let reducedFragments = [fakeNode].reduce(transforms.fragmentTransformer, []);

        reducedFragments.forEach((fragment) => {
            expect(JSON.stringify(fragment).length).toBeLessThan(10000);
        });
    });
});
