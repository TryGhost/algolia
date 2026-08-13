import {afterEach, describe, expect, it} from 'vitest';

import {fork, spawnSync} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {stopOwnedServer} from './helpers/replay-server-lifecycle.js';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(testDirectory, '..', 'bin', 'cli.js');
const replayServerPath = path.join(testDirectory, 'helpers', 'ghost-v6-replay-server.js');
const requesterPreloadPath = path.join(testDirectory, 'helpers', 'algolia-requester-preload.js');
const networkDenialProbePath = path.join(testDirectory, 'helpers', 'network-denial-probe.js');
const fixtureDirectory = path.join(testDirectory, 'fixtures', 'ghost-v6');
const fixtureVerifierPath = path.join(fixtureDirectory, 'verify-fixture.mjs');
const contentApiKey = '00000000000000000000000000';
const expectedRecords = JSON.parse(await readFile(path.join(fixtureDirectory, 'expected-algolia-records.json'), 'utf8'));
const expectedSettings = JSON.parse(await readFile(path.join(fixtureDirectory, 'expected-index-settings.json'), 'utf8'));
const ownedDirectories = new Set();
const ownedServers = new Set();

const createTemporaryDirectory = async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'algolia-ghost-v6-'));
    ownedDirectories.add(directory);
    return directory;
};

const stopServer = server => stopOwnedServer(server, ownedServers);

const startReplayServer = (requestLogPath, replayMode) => {
    const server = fork(replayServerPath, [], {
        env: {
            PATH: process.env.PATH,
            GHOST_REPLAY_FIXTURE_DIRECTORY: fixtureDirectory,
            GHOST_REPLAY_REQUEST_LOG: requestLogPath,
            GHOST_REPLAY_CONTENT_API_KEY: contentApiKey,
            GHOST_REPLAY_MODE: replayMode
        },
        silent: true
    });
    ownedServers.add(server);

    return new Promise((resolve, reject) => {
        const stderr = [];
        let ready = false;
        const timeout = setTimeout(() => {
            reject(new Error('Ghost replay server did not become ready within 5 seconds.'));
        }, 5000);
        server.stderr.on('data', chunk => stderr.push(chunk));
        server.once('error', (error) => {
            clearTimeout(timeout);
            reject(error);
        });
        server.once('exit', (code, signal) => {
            if (!ready) {
                clearTimeout(timeout);
                reject(new Error(`Ghost replay server exited before readiness (${code ?? signal}).\n${Buffer.concat(stderr).toString('utf8')}`));
            }
        });
        server.on('message', (message) => {
            if (message.type === 'ready') {
                ready = true;
                clearTimeout(timeout);
                resolve({server, port: message.port});
            } else if (message.type === 'error') {
                clearTimeout(timeout);
                reject(new Error(`${message.message}\n${Buffer.concat(stderr).toString('utf8')}`));
            }
        });
    });
};

const readJsonLines = async (logPath) => {
    const contents = await readFile(logPath, 'utf8');
    return contents.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
};

const runCliAgainstReplay = async ({args = [], replayMode = 'automatic'} = {}) => {
    const temporaryDirectory = await createTemporaryDirectory();
    const ghostRequestLog = path.join(temporaryDirectory, 'ghost-requests.jsonl');
    const algoliaRequestLog = path.join(temporaryDirectory, 'algolia-requests.jsonl');
    const configPath = path.join(temporaryDirectory, 'config.json');
    await Promise.all([
        writeFile(ghostRequestLog, '', {mode: 0o600}),
        writeFile(algoliaRequestLog, '', {mode: 0o600})
    ]);

    const {server, port} = await startReplayServer(ghostRequestLog, replayMode);
    await writeFile(configPath, JSON.stringify({
        ghost: {
            apiUrl: `http://127.0.0.1:${port}`,
            apiKey: contentApiKey
        },
        algolia: {
            appId: 'acceptance-app',
            apiKey: 'acceptance-admin-key',
            index: 'ghost-content'
        },
        ignore_slugs: ['ignored-by-config']
    }), {mode: 0o600});

    const env = {
        PATH: process.env.PATH,
        NODE_ENV: 'testing',
        NODE_OPTIONS: `--require=${requesterPreloadPath}`,
        ALGOLIA_ACCEPTANCE_REQUEST_LOG: algoliaRequestLog,
        GHOST_REPLAY_ORIGIN: `http://127.0.0.1:${port}`
    };
    for (const name of ['NODE_V8_COVERAGE', 'VITEST_SUBPROCESS_COVERAGE_DIR']) {
        if (process.env[name]) {
            env[name] = process.env[name];
        }
    }

    const result = spawnSync(process.execPath, [cliPath, 'index', configPath, ...args], {
        encoding: 'utf8',
        env,
        timeout: 15000,
        maxBuffer: 10 * 1024 * 1024
    });
    await stopServer(server);

    return {
        result,
        ghostRequests: await readJsonLines(ghostRequestLog),
        algoliaRequests: await readJsonLines(algoliaRequestLog)
    };
};

describe('Ghost 6 CLI acceptance', function () {
    afterEach(async () => {
        await Promise.all([...ownedServers].map(stopServer));
        await Promise.all([...ownedDirectories].map(async (directory) => {
            ownedDirectories.delete(directory);
            await rm(directory, {recursive: true});
        }));
    });

    it('keeps captured Ghost responses and reviewed goldens byte-exact', function () {
        const result = spawnSync(process.execPath, [fixtureVerifierPath], {
            encoding: 'utf8',
            env: {PATH: process.env.PATH},
            timeout: 5000,
            maxBuffer: 1024 * 1024
        });

        expect(result.error).toBeUndefined();
        expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
        expect(result.stdout).toBe('Verified 8 Ghost 6 fixture files.\n');
    });

    it('denies non-loopback HTTP transports while allowing the Ghost replay origin', {timeout: 10000}, async function () {
        const parentHttpRequest = http.request;
        const temporaryDirectory = await createTemporaryDirectory();
        const ghostRequestLog = path.join(temporaryDirectory, 'ghost-requests.jsonl');
        const algoliaRequestLog = path.join(temporaryDirectory, 'algolia-requests.jsonl');
        await Promise.all([
            writeFile(ghostRequestLog, '', {mode: 0o600}),
            writeFile(algoliaRequestLog, '', {mode: 0o600})
        ]);
        const {server, port} = await startReplayServer(ghostRequestLog, 'network-probe');
        const replayOrigin = `http://127.0.0.1:${port}`;

        const result = spawnSync(process.execPath, [networkDenialProbePath], {
            encoding: 'utf8',
            env: {
                PATH: process.env.PATH,
                NODE_OPTIONS: `--require=${requesterPreloadPath}`,
                ALGOLIA_ACCEPTANCE_REQUEST_LOG: algoliaRequestLog,
                GHOST_REPLAY_ORIGIN: replayOrigin,
                GHOST_REPLAY_CONTENT_API_KEY: contentApiKey
            },
            timeout: 5000,
            maxBuffer: 1024 * 1024
        });
        await stopServer(server);

        expect(result.error).toBeUndefined();
        expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual({
            httpResult: {status: 200, posts: 1},
            fetchResult: {status: 200, posts: 1},
            netResult: {status: 200, posts: 1},
            denied: [
                'http.request',
                'http.get',
                'http.get URL',
                'http.request options',
                'http.get hostname override',
                'http.get port override',
                'http.get protocol override',
                'https.request',
                'https.get',
                'https.get URL',
                'https.request options',
                'fetch',
                'fetch Request',
                'net.connect',
                'net.createConnection',
                'net.Socket.connect',
                'net.Socket.connect path',
                'tls.connect',
                'tls.TLSSocket.connect'
            ]
        });
        expect(await readJsonLines(ghostRequestLog)).toHaveLength(3);
        expect(await readFile(algoliaRequestLog, 'utf8')).toBe('');
        expect(http.request).toBe(parentHttpRequest);
    });

    it('indexes captured Ghost 6 content through the public CLI', {timeout: 20000}, async function () {
        const {result, ghostRequests, algoliaRequests} = await runCliAgainstReplay({args: ['--skipjsonslugs']});

        expect(ghostRequests).toEqual([
            {
                method: 'GET',
                pathname: '/ghost/api/content/posts/',
                query: {
                    key: contentApiKey,
                    include: 'tags,authors',
                    limit: '100',
                    page: '1'
                },
                acceptVersion: 'v6.0',
                userAgent: 'GhostContentSDK/1.12.10'
            },
            {
                method: 'GET',
                pathname: '/ghost/api/content/posts/',
                query: {
                    key: contentApiKey,
                    include: 'tags,authors',
                    limit: '100',
                    page: '2'
                },
                acceptVersion: 'v6.0',
                userAgent: 'GhostContentSDK/1.12.10'
            }
        ]);

        const [settingsPut, settingsGet, recordsBatch] = algoliaRequests;
        const expectedAlgoliaHeaders = {
            accept: 'application/json',
            'x-algolia-api-key': 'acceptance-admin-key',
            'x-algolia-application-id': 'acceptance-app',
            'content-type': 'text/plain'
        };
        const normalizeRequest = (request) => {
            const url = new URL(request.url);
            return {
                method: request.method,
                origin: url.origin,
                pathname: url.pathname,
                query: Object.fromEntries(url.searchParams),
                headers: request.headers
            };
        };

        expect(algoliaRequests).toHaveLength(3);
        const algoliaAgent = normalizeRequest(settingsPut).query['x-algolia-agent'];
        expect(algoliaAgent).toMatch(/^Algolia for JavaScript \(5\.\d+\.\d+\); Search \(5\.\d+\.\d+\); Node\.js \(.+\)$/);
        expect(algoliaAgent).toContain(`Node.js (${process.versions.node})`);
        expect(normalizeRequest(settingsPut)).toEqual({
            method: 'PUT',
            origin: 'https://acceptance-app.algolia.net',
            pathname: '/1/indexes/ghost-content/settings',
            query: {'x-algolia-agent': algoliaAgent},
            headers: expectedAlgoliaHeaders
        });
        expect(JSON.parse(settingsPut.data)).toEqual(expectedSettings);
        expect(normalizeRequest(settingsGet)).toEqual({
            method: 'GET',
            origin: 'https://acceptance-app-dsn.algolia.net',
            pathname: '/1/indexes/ghost-content/settings',
            query: {'x-algolia-agent': algoliaAgent},
            headers: expectedAlgoliaHeaders
        });
        expect(settingsGet).not.toHaveProperty('data');
        expect(normalizeRequest(recordsBatch)).toEqual({
            method: 'POST',
            origin: 'https://acceptance-app.algolia.net',
            pathname: '/1/indexes/ghost-content/batch',
            query: {'x-algolia-agent': algoliaAgent},
            headers: expectedAlgoliaHeaders
        });

        const batch = JSON.parse(recordsBatch.data);
        expect(batch.requests).toHaveLength(101);
        expect(batch.requests.map(request => request.action)).toEqual(Array(101).fill('addObject'));
        expect(batch.requests.map(request => request.body)).toEqual(expectedRecords);
        expect(batch.requests.at(-1).body.slug).toBe('synthetic-ghost-post-001');
        expect(batch.requests.some(request => request.body.slug === 'ignored-by-config')).toBe(false);

        const richRecords = batch.requests
            .map(request => request.body)
            .filter(record => record.slug === 'ghost-6-rendered-content-contract');
        expect(richRecords).toEqual(expectedRecords.slice(0, 2));
        expect(richRecords.map(record => record.url)).toEqual([
            'http://127.0.0.1:23689/ghost-6-rendered-content-contract/#fixture-overview',
            'http://127.0.0.1:23689/ghost-6-rendered-content-contract/#structured-blocks'
        ]);
        expect(richRecords[0]).toMatchObject({
            html: '<p>Rendered by Ghost 6 from synthetic source HTML with an <a href="http://127.0.0.1:23689/internal-destination/">internal link</a>.</p>',
            tags: [
                {name: 'Ghost 6', slug: 'ghost-6'},
                {name: 'Acceptance', slug: 'acceptance'}
            ],
            authors: [{name: 'Algolia Fixture Author', slug: 'algolia'}]
        });
        for (const record of batch.requests.map(request => request.body)) {
            expect(Object.keys(record).sort()).toEqual([
                'anchor',
                'authors',
                'customRanking',
                'headings',
                'html',
                'image',
                'objectID',
                'slug',
                'tags',
                'title',
                'url'
            ]);
            expect(record).not.toHaveProperty('uuid');
            expect(record).not.toHaveProperty('excerpt');
            expect(record).not.toHaveProperty('primary_author');
            expect(record).not.toHaveProperty('primary_tag');
            expect(record).not.toHaveProperty('codeinjection_head');
        }

        expect(result.error).toBeUndefined();
        expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
        expect(result.signal).toBeNull();
        expect(`${result.stdout}${result.stderr}`).toMatch(/101 Fragments successfully saved/);
        expect(`${result.stdout}${result.stderr}`).toMatch(/Successfully indexed all the things/);
    });

    it('forwards an explicit limit without enabling automatic pagination', {timeout: 20000}, async function () {
        const {result, ghostRequests, algoliaRequests} = await runCliAgainstReplay({
            args: ['--limit', '1'],
            replayMode: 'limit-one'
        });

        expect(result.error).toBeUndefined();
        expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
        expect(ghostRequests).toEqual([{
            method: 'GET',
            pathname: '/ghost/api/content/posts/',
            query: {
                key: contentApiKey,
                include: 'tags,authors',
                limit: '1'
            },
            acceptVersion: 'v6.0',
            userAgent: 'GhostContentSDK/1.12.10'
        }]);
        expect(algoliaRequests).toHaveLength(3);
        expect(JSON.parse(algoliaRequests[2].data).requests).toHaveLength(2);
        expect(`${result.stdout}${result.stderr}`).toMatch(/2 Fragments successfully saved/);
    });

    it('forwards an explicit page and fetches only that page', {timeout: 20000}, async function () {
        const {result, ghostRequests, algoliaRequests} = await runCliAgainstReplay({
            args: ['--limit', '100', '--page', '2'],
            replayMode: 'page-two'
        });

        expect(result.error).toBeUndefined();
        expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
        expect(ghostRequests).toEqual([{
            method: 'GET',
            pathname: '/ghost/api/content/posts/',
            query: {
                key: contentApiKey,
                include: 'tags,authors',
                limit: '100',
                page: '2'
            },
            acceptVersion: 'v6.0',
            userAgent: 'GhostContentSDK/1.12.10'
        }]);
        expect(algoliaRequests).toHaveLength(3);
        const requests = JSON.parse(algoliaRequests[2].data).requests;
        expect(requests).toHaveLength(1);
        expect(requests[0].body).toEqual(expectedRecords.at(-1));
        expect(`${result.stdout}${result.stderr}`).toMatch(/1 Fragments successfully saved/);
    });
});
