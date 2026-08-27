import {fork, spawnSync, type ChildProcess, type SpawnSyncReturns} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {stopOwnedServer, type OwnedServer} from './replay-server-lifecycle.ts';

export type JsonValue =
    | boolean
    | number
    | string
    | null
    | readonly JsonValue[]
    | Readonly<{[key: string]: JsonValue}>;

export type GhostRequest = Readonly<{
    method: string;
    pathname: string;
    query: Readonly<Record<string, string>>;
    acceptVersion: string;
    userAgent: string;
}>;

export type AlgoliaRequest = Readonly<{
    method: string;
    url: string;
    headers: Readonly<Record<string, string>>;
    data?: string;
}>;

export type AlgoliaRecord = Readonly<Record<string, JsonValue>>;

export type ReplayPlanEntry = Readonly<{
    query: Readonly<Record<string, string>>;
    body: JsonValue;
}>;

export type CliConfig = Readonly<{[key: string]: JsonValue}>;

type CliRunOptions = Readonly<{
    args?: readonly string[];
    algoliaStatePath?: string;
    replayMode?: string;
    replayPlan?: readonly ReplayPlanEntry[];
    config?: CliConfig | ((replayOrigin: string) => CliConfig);
}>;

export type CliRun = Readonly<{
    result: SpawnSyncReturns<string>;
    ghostRequests: readonly GhostRequest[];
    algoliaRequests: readonly AlgoliaRequest[];
    algoliaRecords: readonly AlgoliaRecord[];
    algoliaStatePath: string;
}>;

type HarnessOptions = Readonly<{
    contentApiKey?: string;
    fixtureDirectory?: string;
    temporaryDirectoryPrefix?: string;
}>;

const testDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export const cliPath = path.join(testDirectory, '..', 'bin', 'cli.js');
export const replayServerPath = path.join(testDirectory, 'helpers', 'ghost-v6-replay-server.js');
export const requesterPreloadPath = path.join(
    testDirectory,
    'helpers',
    'algolia-requester-preload.js'
);
export const networkDenialProbePath = path.join(
    testDirectory,
    'helpers',
    'network-denial-probe.js'
);
export const defaultFixtureDirectory = path.join(testDirectory, 'fixtures', 'ghost-v6');
export const defaultContentApiKey = '00000000000000000000000000';

const isReadyMessage = (message: unknown): message is Readonly<{type: 'ready'; port: number}> => {
    return (
        typeof message === 'object' &&
        message !== null &&
        'type' in message &&
        message.type === 'ready' &&
        'port' in message &&
        typeof message.port === 'number'
    );
};

const isErrorMessage = (
    message: unknown
): message is Readonly<{type: 'error'; message: string}> => {
    return (
        typeof message === 'object' &&
        message !== null &&
        'type' in message &&
        message.type === 'error' &&
        'message' in message &&
        typeof message.message === 'string'
    );
};

const createDefaultConfig = (replayOrigin: string, contentApiKey: string): CliConfig => ({
    ghost: {
        apiUrl: replayOrigin,
        apiKey: contentApiKey
    },
    algolia: {
        appId: 'acceptance-app',
        apiKey: 'acceptance-admin-key',
        index: 'ghost-content'
    },
    ignore_slugs: ['ignored-by-config']
});

const forwardedCoverageEnvironment = (): NodeJS.ProcessEnv => {
    const environment: NodeJS.ProcessEnv = {};
    for (const name of ['NODE_V8_COVERAGE', 'VITEST_SUBPROCESS_COVERAGE_DIR']) {
        const value = process.env[name];
        if (value !== undefined) {
            environment[name] = value;
        }
    }
    return environment;
};

export const readJsonLines = async <Value>(logPath: string): Promise<readonly Value[]> => {
    const contents = await readFile(logPath, 'utf8');
    if (contents.trim() === '') {
        return [];
    }

    return contents
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line) as Value);
};

export class CliAcceptanceHarness {
    readonly #contentApiKey: string;
    readonly #fixtureDirectory: string;
    readonly #temporaryDirectoryPrefix: string;
    readonly #ownedDirectories = new Set<string>();
    readonly #ownedServers = new Set<OwnedServer>();

    constructor(options: HarnessOptions = {}) {
        this.#contentApiKey = options.contentApiKey ?? defaultContentApiKey;
        this.#fixtureDirectory = options.fixtureDirectory ?? defaultFixtureDirectory;
        this.#temporaryDirectoryPrefix =
            options.temporaryDirectoryPrefix ?? 'algolia-cli-acceptance-';
    }

    async createTemporaryDirectory(): Promise<string> {
        const directory = await mkdtemp(path.join(os.tmpdir(), this.#temporaryDirectoryPrefix));
        this.#ownedDirectories.add(directory);
        return directory;
    }

    async startReplayServer(
        requestLogPath: string,
        replayMode: string,
        replayPlan?: readonly ReplayPlanEntry[]
    ): Promise<Readonly<{server: ChildProcess; port: number}>> {
        const replayPlanPath = path.join(path.dirname(requestLogPath), 'ghost-replay-plan.json');
        if (replayPlan !== undefined) {
            await writeFile(replayPlanPath, JSON.stringify(replayPlan), {mode: 0o600});
        }

        const server = fork(replayServerPath, [], {
            env: {
                PATH: process.env.PATH,
                GHOST_REPLAY_FIXTURE_DIRECTORY: this.#fixtureDirectory,
                GHOST_REPLAY_REQUEST_LOG: requestLogPath,
                GHOST_REPLAY_CONTENT_API_KEY: this.#contentApiKey,
                GHOST_REPLAY_MODE: replayMode,
                ...(replayPlan === undefined ? {} : {GHOST_REPLAY_PLAN_PATH: replayPlanPath})
            },
            silent: true
        });
        this.#ownedServers.add(server);

        return new Promise((resolve, reject) => {
            const stderr: Uint8Array[] = [];
            let ready = false;
            const timeout = setTimeout(() => {
                reject(new Error('Ghost replay server did not become ready within 5 seconds.'));
            }, 5000);
            server.stderr?.on('data', (chunk: Uint8Array) => stderr.push(chunk));
            server.once('error', error => {
                clearTimeout(timeout);
                reject(error);
            });
            server.once('exit', (code, signal) => {
                if (ready) {
                    return;
                }
                clearTimeout(timeout);
                reject(
                    new Error(
                        `Ghost replay server exited before readiness (${code ?? signal}).\n${Buffer.concat(stderr).toString('utf8')}`
                    )
                );
            });
            server.on('message', message => {
                if (isReadyMessage(message)) {
                    ready = true;
                    clearTimeout(timeout);
                    resolve({server, port: message.port});
                    return;
                }
                if (isErrorMessage(message)) {
                    clearTimeout(timeout);
                    reject(
                        new Error(`${message.message}\n${Buffer.concat(stderr).toString('utf8')}`)
                    );
                }
            });
        });
    }

    async stopServer(server: ChildProcess): Promise<void> {
        await stopOwnedServer(server, this.#ownedServers);
    }

    async run(options: CliRunOptions = {}): Promise<CliRun> {
        const temporaryDirectory = await this.createTemporaryDirectory();
        const ghostRequestLog = path.join(temporaryDirectory, 'ghost-requests.jsonl');
        const algoliaRequestLog = path.join(temporaryDirectory, 'algolia-requests.jsonl');
        const algoliaStatePath =
            options.algoliaStatePath ?? path.join(temporaryDirectory, 'algolia-state.json');
        const configPath = path.join(temporaryDirectory, 'config.json');
        await Promise.all([
            writeFile(ghostRequestLog, '', {mode: 0o600}),
            writeFile(algoliaRequestLog, '', {mode: 0o600}),
            ...(options.algoliaStatePath === undefined
                ? [writeFile(algoliaStatePath, '[]', {mode: 0o600})]
                : [])
        ]);

        const {server, port} = await this.startReplayServer(
            ghostRequestLog,
            options.replayMode ?? 'automatic',
            options.replayPlan
        );
        const replayOrigin = `http://127.0.0.1:${port}`;
        const config =
            typeof options.config === 'function'
                ? options.config(replayOrigin)
                : (options.config ?? createDefaultConfig(replayOrigin, this.#contentApiKey));
        await writeFile(configPath, JSON.stringify(config), {mode: 0o600});

        const result = spawnSync(
            process.execPath,
            [cliPath, 'index', configPath, ...(options.args ?? [])],
            {
                encoding: 'utf8',
                env: {
                    PATH: process.env.PATH,
                    NODE_ENV: 'testing',
                    NODE_OPTIONS: `--require=${requesterPreloadPath}`,
                    ALGOLIA_ACCEPTANCE_REQUEST_LOG: algoliaRequestLog,
                    ALGOLIA_ACCEPTANCE_STATE_PATH: algoliaStatePath,
                    GHOST_REPLAY_ORIGIN: replayOrigin,
                    ...forwardedCoverageEnvironment()
                },
                timeout: 15000,
                maxBuffer: 10 * 1024 * 1024
            }
        );
        await this.stopServer(server);

        return {
            result,
            ghostRequests: await readJsonLines<GhostRequest>(ghostRequestLog),
            algoliaRequests: await readJsonLines<AlgoliaRequest>(algoliaRequestLog),
            algoliaRecords: JSON.parse(await readFile(algoliaStatePath, 'utf8')) as AlgoliaRecord[],
            algoliaStatePath
        };
    }

    async cleanup(): Promise<void> {
        await Promise.all(
            [...this.#ownedServers].map(server => stopOwnedServer(server, this.#ownedServers))
        );
        await Promise.all(
            [...this.#ownedDirectories].map(async directory => {
                this.#ownedDirectories.delete(directory);
                await rm(directory, {recursive: true});
            })
        );
    }
}

export const cliOutput = (result: SpawnSyncReturns<string>): string => {
    return `${result.stdout}${result.stderr}`;
};
