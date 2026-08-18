import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

const execFileAsync = promisify(execFile);
const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceDirectory = path.resolve(packageDirectory, '../..');

describe('Netlify function dependency tracing', () => {
    it('packages the compatibility extractor through the ESM fragmenter', async () => {
        await execFileAsync('pnpm', ['--filter', '@tryghost/algolia-netlify', 'build'], {
            cwd: workspaceDirectory
        });

        for (const functionName of ['post-published', 'post-unpublished']) {
            const archive = await readFile(
                path.join(packageDirectory, `.netlify/functions/${functionName}.zip`)
            );
            const archiveIndex = archive.toString('latin1');

            expect(archiveIndex).toContain('packages/algolia-fragmenter/lib/index.mjs');
            expect(archiveIndex).toContain('packages/algolia-html-extractor/dist/index.mjs');
            expect(archiveIndex).toContain(
                'node_modules/.pnpm/parse5@8.0.1/node_modules/parse5/dist/index.js'
            );
            expect(archiveIndex).not.toContain('algolia-html-extractor@0.0.1');
            expect(archiveIndex).not.toContain(workspaceDirectory);
        }
    }, 30000);
});
