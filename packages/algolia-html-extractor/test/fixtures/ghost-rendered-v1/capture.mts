import {execFile} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

import {controlledFamilies} from './controlled-source.mts';

const execFileAsync = promisify(execFile);
const image = 'ghost@sha256:6e37900accfb12e16fbc15bf94500e09829cb17e6448b3051e9c76446b4fbf53';
const imageTag = 'ghost:6.57.1-alpine';
const imageId = 'sha256:1984dc765a374721616ed6bd43819fec66f70b97c365b0aee57a217a4e2b28c6';
const platform = 'linux/arm64';
const fixtureDirectory = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.join(fixtureDirectory, 'controlled-capture.json');
const rendererPath = path.join(fixtureDirectory, 'renderer.mts');

const families = [];
for (const family of controlledFamilies) {
    const {stdout} = await execFileAsync('docker', [
        'run',
        '--rm',
        '--network',
        'none',
        '--platform',
        platform,
        '--volume',
        `${rendererPath}:/capture/renderer.mts:ro`,
        '--workdir',
        '/var/lib/ghost/current',
        image,
        'node',
        '/capture/renderer.mts',
        family.sourceHtml
    ]);
    const rendered = JSON.parse(stdout) as {
        lexical: unknown;
        html: string;
        versions: Record<string, string>;
    };
    families.push({...family, ...rendered});
}

const capture = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    runtime: {
        ghostVersion: '6.57.1',
        imageTag,
        image,
        imageId,
        platform,
        nodeVersion: '22.23.2'
    },
    request: {
        method: 'in-process Ghost renderer invocation',
        sourceFormat: 'synthetic HTML converted to Lexical',
        target: 'html',
        siteUrl: 'https://fixture.invalid/',
        networkAccess: false
    },
    families
};

await writeFile(outputPath, `${JSON.stringify(capture, null, 2)}\n`);
