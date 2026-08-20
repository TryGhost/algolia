import {spawnSync, type SpawnSyncReturns} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

import {afterEach, describe, expect, it} from 'vitest';

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.join(packageDirectory, 'smoke', 'cli.mts');
const preloadPath = path.join(
    packageDirectory,
    'test',
    'helpers',
    'live-ghost-content-smoke-preload.mts'
);
const fakeContentApiKey = 'test-content-api-key';
const temporaryDirectories: string[] = [];

type LoggedRequest = Readonly<{
    url: string;
    method: string;
    acceptVersion: string;
    redirect: string;
    signalIsAbortSignal: boolean;
    timeoutMilliseconds: number;
}>;

type SmokeCliRun = Readonly<{
    result: SpawnSyncReturns<string>;
    requestLogPath: string;
    summaryPath: string;
}>;

const createTemporaryDirectory = async (): Promise<string> => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'algolia-live-smoke-'));
    temporaryDirectories.push(directory);
    return directory;
};

const createChildEnvironment = (
    requestLogPath: string,
    summaryPath: string | undefined
): NodeJS.ProcessEnv => {
    const environment: NodeJS.ProcessEnv = {
        PATH: process.env.PATH,
        GHOST_URL: 'https://main.ghost.is',
        GHOST_API_VERSION: 'v6.0',
        MAIN_GHOST_CONTENT_API_KEY: fakeContentApiKey,
        LIVE_GHOST_SMOKE_REQUEST_LOG: requestLogPath,
        // Vitest's V8 converter cannot parse raw Node coverage for .mts subprocesses.
        NODE_V8_COVERAGE: '',
        VITEST_SUBPROCESS_COVERAGE_DIR: ''
    };
    if (summaryPath !== undefined) {
        environment.GITHUB_STEP_SUMMARY = summaryPath;
    }
    return environment;
};

const runSmokeCli = async (
    summaryPathOption: 'file' | 'missing' | 'unwritable'
): Promise<SmokeCliRun> => {
    const temporaryDirectory = await createTemporaryDirectory();
    const requestLogPath = path.join(temporaryDirectory, 'requests.jsonl');
    const summaryPath =
        summaryPathOption === 'unwritable'
            ? path.join(temporaryDirectory, 'missing', 'summary.md')
            : path.join(temporaryDirectory, 'summary.md');
    await writeFile(requestLogPath, '', {mode: 0o600});
    if (summaryPathOption !== 'unwritable') {
        await writeFile(summaryPath, '', {mode: 0o600});
    }

    const result = spawnSync(
        process.execPath,
        ['--import', pathToFileURL(preloadPath).href, cliPath],
        {
            encoding: 'utf8',
            env: createChildEnvironment(
                requestLogPath,
                summaryPathOption === 'missing' ? undefined : summaryPath
            ),
            timeout: 5000,
            maxBuffer: 1024 * 1024
        }
    );

    return {result, requestLogPath, summaryPath};
};

const readLoggedRequests = async (requestLogPath: string): Promise<readonly LoggedRequest[]> => {
    const contents = await readFile(requestLogPath, 'utf8');
    if (contents === '') {
        return [];
    }
    return contents
        .trim()
        .split('\n')
        .map(line => JSON.parse(line) as LoggedRequest);
};

afterEach(async () => {
    await Promise.all(
        temporaryDirectories
            .splice(0)
            .map(directory => rm(directory, {recursive: true, force: true}))
    );
});

describe('live Ghost content smoke CLI', () => {
    it('maps the workflow environment to bounded offline requests and a safe summary', async () => {
        const {result, requestLogPath, summaryPath} = await runSmokeCli('file');

        expect(result.error).toBeUndefined();
        expect(result.signal).toBeNull();
        expect(result.status).toBe(0);
        expect(result.stdout).toBe('Live Ghost content smoke: ok\n');
        expect(result.stderr).toBe('');
        expect(await readLoggedRequests(requestLogPath)).toEqual([
            {
                url: `https://main.ghost.is/ghost/api/content/posts/?key=${fakeContentApiKey}&fields=html&formats=html&limit=100&page=1`,
                method: 'GET',
                acceptVersion: 'v6.0',
                redirect: 'error',
                signalIsAbortSignal: true,
                timeoutMilliseconds: 30_000
            },
            {
                url: `https://main.ghost.is/ghost/api/content/pages/?key=${fakeContentApiKey}&fields=html&formats=html&limit=100&page=1`,
                method: 'GET',
                acceptVersion: 'v6.0',
                redirect: 'error',
                signalIsAbortSignal: true,
                timeoutMilliseconds: 30_000
            }
        ]);

        const summary = await readFile(summaryPath, 'utf8');
        expect(summary).toContain('Result: ok');
        expect(summary).toContain('| posts | 1 | 1 | 0 |');
        expect(summary).toContain('| pages | 1 | 0 | 0 |');
        expect(summary).not.toMatch(/Private fixture prose|test-content-api-key/i);
    });

    it('fails before requesting content when the summary path is missing', async () => {
        const {result, requestLogPath, summaryPath} = await runSmokeCli('missing');

        expect(result.error).toBeUndefined();
        expect(result.signal).toBeNull();
        expect(result.status).toBe(1);
        expect(result.stdout).toBe('');
        expect(result.stderr).toBe('Live Ghost content smoke failed: operational-failure\n');
        expect(await readLoggedRequests(requestLogPath)).toEqual([]);
        expect(await readFile(summaryPath, 'utf8')).toBe('');
    });

    it('reports a safe failure when the summary cannot be written', async () => {
        const {result, requestLogPath} = await runSmokeCli('unwritable');

        expect(result.error).toBeUndefined();
        expect(result.signal).toBeNull();
        expect(result.status).toBe(1);
        expect(result.stdout).toBe('');
        expect(result.stderr).toBe('Live Ghost content smoke failed: operational-failure\n');
        expect(await readLoggedRequests(requestLogPath)).toHaveLength(2);
        expect(`${result.stdout}${result.stderr}`).not.toMatch(
            /Private fixture prose|test-content-api-key/i
        );
    });
});
