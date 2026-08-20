import {execFile} from 'node:child_process';
import {readdir, stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

import {describe, expect, it} from 'vitest';

const execFileAsync = promisify(execFile);
const workspaceDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildOutputDirectories = [
    'packages/algolia-html-extractor/dist',
    'packages/algolia-fragmenter/lib'
];

const snapshotBuildOutputs = async () => {
    const snapshot = {};
    for (const directory of buildOutputDirectories) {
        const absoluteDirectory = path.join(workspaceDirectory, directory);
        for (const filename of (await readdir(absoluteDirectory)).sort()) {
            const stats = await stat(path.join(absoluteDirectory, filename), {bigint: true});
            snapshot[`${directory}/${filename}`] = {
                size: stats.size,
                mtimeNs: stats.mtimeNs,
                ino: stats.ino
            };
        }
    }
    return snapshot;
};

describe('Build output stability', () => {
    it(
        'leaves up-to-date build outputs untouched when the build runs again',
        {timeout: 120000},
        async () => {
            // Package acceptance tests run `pnpm pack` mid-suite, whose prepack
            // scripts rebuild dist/ and lib/ while parallel tests import those
            // files; rewriting an up-to-date file in place opens a truncation
            // window that intermittently breaks the concurrent ESM imports.
            await execFileAsync('pnpm', ['build'], {cwd: workspaceDirectory});
            const before = await snapshotBuildOutputs();
            await execFileAsync('pnpm', ['build'], {cwd: workspaceDirectory});

            expect(await snapshotBuildOutputs()).toEqual(before);
        }
    );
});
