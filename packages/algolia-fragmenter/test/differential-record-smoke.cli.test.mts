import {spawnSync, type SpawnSyncReturns} from 'node:child_process';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
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
    'differential-record-smoke-preload.mts'
);
const workspaceEntryUrl = pathToFileURL(path.join(packageDirectory, 'lib', 'index.mjs')).href;
const fakeContentApiKey = 'test-content-api-key';
const temporaryDirectories: string[] = [];

type PublishedFixture =
    | 'reexport'
    | 'drifting'
    | 'broken'
    | 'no-entry'
    | 'bad-version'
    | 'escaping-entry'
    | 'not-a-function';

type SmokeCliRun = Readonly<{
    result: SpawnSyncReturns<string>;
    requestLogPath: string;
    summaryPath: string;
    keyProbePath: string;
}>;

const createTemporaryDirectory = async (): Promise<string> => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'algolia-differential-smoke-'));
    temporaryDirectories.push(directory);
    return directory;
};

const createPublishedFixture = async (fixture: PublishedFixture): Promise<string> => {
    const directory = path.join(await createTemporaryDirectory(), 'published');
    await mkdir(path.join(directory, 'lib'), {recursive: true});

    if (fixture !== 'broken') {
        await writeFile(
            path.join(directory, 'package.json'),
            JSON.stringify({
                name: '@tryghost/algolia-fragmenter',
                version: fixture === 'bad-version' ? 9 : '9.9.9',
                type: 'module',
                exports:
                    fixture === 'no-entry'
                        ? {}
                        : {
                              '.': {
                                  import:
                                      fixture === 'escaping-entry'
                                          ? '../escape.mjs'
                                          : './lib/index.mjs'
                              }
                          }
            }),
            'utf8'
        );
    }

    // The import-time probe records whether third-party module code can still see the
    // content API key when it loads.
    const probeSource = [
        "import {appendFileSync} from 'node:fs';",
        'if (process.env.KEY_PROBE_FILE) {',
        '    appendFileSync(',
        '        process.env.KEY_PROBE_FILE,',
        '        JSON.stringify(process.env.MAIN_GHOST_CONTENT_API_KEY ?? null),',
        "        'utf8'",
        '    );',
        '}',
        ''
    ].join('\n');
    const exportSource =
        fixture === 'drifting'
            ? [
                  `import {createAlgoliaRecords as buildReal} from '${workspaceEntryUrl}';`,
                  'export const createAlgoliaRecords = (contents, options) =>',
                  '    buildReal(contents, options).map(record => ({...record, driftMarker: true}));',
                  ''
              ].join('\n')
            : fixture === 'not-a-function'
              ? 'export const createAlgoliaRecords = 42;\n'
              : `export {createAlgoliaRecords} from '${workspaceEntryUrl}';\n`;
    await writeFile(path.join(directory, 'lib', 'index.mjs'), probeSource + exportSource, 'utf8');

    return directory;
};

type RunOverrides = Readonly<{
    summary?: 'file' | 'missing';
    publishedDirectory?: string | 'missing';
    expectedDriftFile?: string;
}>;

const runSmokeCli = async (overrides: RunOverrides = {}): Promise<SmokeCliRun> => {
    const temporaryDirectory = await createTemporaryDirectory();
    const requestLogPath = path.join(temporaryDirectory, 'requests.jsonl');
    const summaryPath = path.join(temporaryDirectory, 'summary.md');
    const keyProbePath = path.join(temporaryDirectory, 'key-probe.json');
    await writeFile(requestLogPath, '', {mode: 0o600});
    await writeFile(summaryPath, '', {mode: 0o600});

    const environment: NodeJS.ProcessEnv = {
        PATH: process.env.PATH,
        GHOST_URL: 'https://main.ghost.is',
        GHOST_API_VERSION: 'v6.0',
        MAIN_GHOST_CONTENT_API_KEY: fakeContentApiKey,
        DIFFERENTIAL_SMOKE_REQUEST_LOG: requestLogPath,
        KEY_PROBE_FILE: keyProbePath,
        // Vitest's V8 converter cannot parse raw Node coverage for .mts subprocesses.
        NODE_V8_COVERAGE: ''
    };
    if (overrides.summary !== 'missing') {
        environment.GITHUB_STEP_SUMMARY = summaryPath;
    }
    if (overrides.publishedDirectory !== 'missing') {
        environment.PUBLISHED_FRAGMENTER_DIR =
            overrides.publishedDirectory ?? (await createPublishedFixture('reexport'));
    }
    if (overrides.expectedDriftFile !== undefined) {
        environment.EXPECTED_DRIFT_FILE = overrides.expectedDriftFile;
    }

    const result = spawnSync(
        process.execPath,
        ['--import', pathToFileURL(preloadPath).href, cliPath],
        {
            encoding: 'utf8',
            env: environment,
            timeout: 15_000,
            maxBuffer: 1024 * 1024
        }
    );

    return {result, requestLogPath, summaryPath, keyProbePath};
};

const readLoggedRequests = async (requestLogPath: string): Promise<readonly unknown[]> => {
    const contents = await readFile(requestLogPath, 'utf8');
    if (contents === '') {
        return [];
    }
    return contents
        .trim()
        .split('\n')
        .map(line => JSON.parse(line) as unknown);
};

afterEach(async () => {
    await Promise.all(
        temporaryDirectories
            .splice(0)
            .map(directory => rm(directory, {recursive: true, force: true}))
    );
});

describe('differential record smoke CLI', () => {
    it('compares workspace and published records over bounded offline requests', async () => {
        const {result, requestLogPath, summaryPath, keyProbePath} = await runSmokeCli();

        expect(result.error).toBeUndefined();
        expect(result.signal).toBeNull();
        expect(result.stderr).toBe('');
        expect(result.stdout).toBe('Differential record smoke: ok\n');
        expect(result.status).toBe(0);
        expect(await readLoggedRequests(requestLogPath)).toEqual([
            {
                url: `https://main.ghost.is/ghost/api/content/posts/?key=${fakeContentApiKey}&fields=${encodeURIComponent('id,slug,url,title,html')}&formats=html&limit=100&page=1`,
                method: 'GET',
                acceptVersion: 'v6.0',
                redirect: 'error',
                signalIsAbortSignal: true,
                timeoutMilliseconds: 30_000
            }
        ]);

        const summary = await readFile(summaryPath, 'utf8');
        expect(summary).toContain('Result: ok');
        expect(summary).toContain('Published fragmenter: 9.9.9');
        expect(summary).toContain('| 1 | 1 | 0 |');
        expect(summary).not.toMatch(
            /private-fixture|Private fixture|68f1a2b3|test-content-api-key/iu
        );
        // The published module imports before the run; the key must already be gone.
        expect(await readFile(keyProbePath, 'utf8')).toBe('null');
    });

    it('fails with record drift when the published package builds different records', async () => {
        const publishedDirectory = await createPublishedFixture('drifting');
        const {result, summaryPath} = await runSmokeCli({publishedDirectory});

        expect(result.status).toBe(1);
        expect(result.stdout).toBe('Differential record smoke: record-drift\n');
        expect(result.stderr).toBe('');
        expect(await readFile(summaryPath, 'utf8')).toContain('Result: record-drift');
    });

    it('accepts declared drift for the installed published version', async () => {
        const publishedDirectory = await createPublishedFixture('drifting');
        const declarationPath = path.join(await createTemporaryDirectory(), 'declaration.json');
        await writeFile(
            declarationPath,
            JSON.stringify({publishedVersion: '9.9.9', reason: 'Fixture drift declaration.'}),
            'utf8'
        );
        const {result, summaryPath} = await runSmokeCli({
            publishedDirectory,
            expectedDriftFile: declarationPath
        });

        expect(result.status).toBe(0);
        expect(result.stdout).toBe('Differential record smoke: expected-drift\n');
        const summary = await readFile(summaryPath, 'utf8');
        expect(summary).toContain('Result: expected-drift');
        expect(summary).toContain('Expected drift declaration: applied');
    });

    it('rejects an unparsable drift declaration as schema drift', async () => {
        const declarationPath = path.join(await createTemporaryDirectory(), 'declaration.json');
        await writeFile(declarationPath, 'not json', 'utf8');
        const {result} = await runSmokeCli({expectedDriftFile: declarationPath});

        expect(result.status).toBe(1);
        expect(result.stderr).toBe('Differential record smoke failed: schema-drift\n');
    });

    it('fails before requesting content when the summary path is missing', async () => {
        const {result, requestLogPath} = await runSmokeCli({summary: 'missing'});

        expect(result.status).toBe(1);
        expect(result.stdout).toBe('');
        expect(result.stderr).toBe('Differential record smoke failed: operational-failure\n');
        expect(await readLoggedRequests(requestLogPath)).toEqual([]);
    });

    it('fails before requesting content when the published package is missing', async () => {
        const {result, requestLogPath} = await runSmokeCli({publishedDirectory: 'missing'});

        expect(result.status).toBe(1);
        expect(result.stderr).toBe('Differential record smoke failed: operational-failure\n');
        expect(await readLoggedRequests(requestLogPath)).toEqual([]);
    });

    it.each([
        ['has no package manifest', 'broken'],
        ['declares no import entry', 'no-entry'],
        ['declares a non-string version', 'bad-version'],
        ['points its entry outside the package', 'escaping-entry'],
        ['exports no record builder', 'not-a-function']
    ] as const)(
        'fails before requesting content when the published package %s',
        async (_name, fixture) => {
            const publishedDirectory = await createPublishedFixture(fixture);
            const {result, requestLogPath} = await runSmokeCli({publishedDirectory});

            expect(result.status).toBe(1);
            expect(result.stderr).toBe('Differential record smoke failed: operational-failure\n');
            expect(await readLoggedRequests(requestLogPath)).toEqual([]);
        }
    );
});
