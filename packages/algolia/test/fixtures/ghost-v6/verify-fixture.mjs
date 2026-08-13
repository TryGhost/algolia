import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const fixtureDirectory = dirname(fileURLToPath(import.meta.url));
const expectedHashes = {
    'generate-import.mjs': '796eb6a79e5342c2b3f2917c723b09421ad6d0b3a60f8f706489a8bcd613a76b',
    'synthetic-import.json': 'f103591138ad14c229b5386b9cf210900824d4c6fa5c7142ac99dd66aa5be14d',
    'validate-fixture.mjs': '3089aafd2275ac01c37c0efa451e7692462ee8c0d434969ded475d4441ae67a7',
    'posts-page-1.json': '73044a66fad131f06b3fcf1707008c130a355077f2f63e07c2ab5aaab8cf6750',
    'posts-page-2.json': 'd54736bef9403db3ddf8dec0bbd2c5c70f3cc11aef7cef9a505309b4376619a7',
    'ghost-renderer-proof.json': '9a244eb05c432e2e3d4ec1a4821364f94d025f8e3419e2cb1c3e456a552ccc95',
    'expected-algolia-records.json': 'ea8f562606161641b54ccb4d52f2fe382cbe00942ea58564fba9cd9e9b5ca31a',
    'expected-index-settings.json': 'ed515127d16fa025e3f4b13e9f9d360273e18a750162c0bdf7d217c7de8c1a08'
};

for (const [fileName, expectedHash] of Object.entries(expectedHashes)) {
    const contents = await readFile(join(fixtureDirectory, fileName));
    const actualHash = createHash('sha256').update(contents).digest('hex');
    assert.equal(actualHash, expectedHash, `${fileName} does not match its reviewed SHA-256.`);
}

console.log(`Verified ${Object.keys(expectedHashes).length} Ghost 6 fixture files.`); // eslint-disable-line no-console
