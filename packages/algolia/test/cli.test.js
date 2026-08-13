import {describe, expect, it} from 'vitest';

import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.join(testDirectory, '..', 'bin', 'cli.js');
const MISSING_CONFIG_PATH = path.join(testDirectory, 'missing-config.json');
const INVALID_LIMITS = ['not-a-number', '0', '-1', '1.5', '101'];
const INVALID_PAGES = ['not-a-number', '0', '-1', '1.5'];

const runCli = (args) => {
    return spawnSync(process.execPath, [CLI_PATH, ...args], {
        encoding: 'utf8',
        env: process.env
    });
};

const getOutput = (result) => {
    return `${result.stdout}${result.stderr}`;
};

describe('algolia CLI', {timeout: 15000}, function () {
    it('rejects page without limit before loading config', function () {
        const result = runCli(['index', MISSING_CONFIG_PATH, '--page', '2']);
        const output = getOutput(result);

        expect(result.status).not.toBe(0);
        expect(output).toMatch(/--page requires --limit/);
        expect(output).not.toMatch(/--page must be a positive integer/);
        expect(output).not.toMatch(/Failed loading JSON config file/);
    });

    for (const limit of INVALID_LIMITS) {
        it(`rejects limit ${limit} before loading config`, function () {
            const result = runCli(['index', MISSING_CONFIG_PATH, '--limit', limit]);
            const output = getOutput(result);

            expect(result.status).not.toBe(0);
            expect(output).toMatch(/--limit must be an integer from 1 to 100/);
            expect(output).not.toMatch(/Failed loading JSON config file/);
        });
    }

    for (const page of INVALID_PAGES) {
        it(`rejects page ${page} before loading config`, function () {
            const result = runCli(['index', MISSING_CONFIG_PATH, '--limit', '100', '--page', page]);
            const output = getOutput(result);

            expect(result.status).not.toBe(0);
            expect(output).toMatch(/--page must be a positive integer/);
            expect(output).not.toMatch(/Failed loading JSON config file/);
            expect(output).not.toMatch(/GHOST_CLIENT|GHOST_BROWSE/);
        });
    }

    it('accepts the inclusive limit bounds and a positive page', function () {
        const firstPost = getOutput(runCli(['index', MISSING_CONFIG_PATH, '--limit', '1']));
        const requestedPage = getOutput(runCli(['index', MISSING_CONFIG_PATH, '--limit', '100', '--page', '3']));

        for (const output of [firstPost, requestedPage]) {
            expect(output).toMatch(/Failed loading JSON config file/);
            expect(output).not.toMatch(/--limit must be an integer from 1 to 100/);
            expect(output).not.toMatch(/--page requires --limit/);
            expect(output).not.toMatch(/--page must be a positive integer/);
        }
    });
});
