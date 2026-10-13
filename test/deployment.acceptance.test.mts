import {createServer} from 'node:http';
import {once} from 'node:events';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {mkdtemp, readdir, rm, writeFile, readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, expect, it} from 'vitest';

import {buildDeployment} from '../deployment/build.mts';

const exec = promisify(execFile);
const pnpmVersion = (await exec('pnpm', ['--version'])).stdout.trim();
const directories: string[] = [];
const temporaryDirectory = async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'algolia-deployment-'));
    directories.push(directory);
    return directory;
};
const createReleaseRepository = async () => {
    const repository = await temporaryDirectory();
    await writeFile(
        path.join(repository, 'package.json'),
        JSON.stringify({
            name: '@tryghost/algolia-netlify',
            private: true,
            packageManager: `pnpm@${pnpmVersion}`,
            scripts: {
                build: 'node build.mts',
                'build:package': 'node build.mts',
                preinstall: 'node -e "process.exit(42)"'
            }
        })
    );
    await writeFile(
        path.join(repository, 'pnpm-workspace.yaml'),
        'packages: []\npmOnFail: ignore\n'
    );
    await exec('pnpm', ['install', '--lockfile-only', '--offline', '--ignore-scripts'], {
        cwd: repository,
        env: {...process.env, PNPM_CONFIG_CACHE_DIR: await temporaryDirectory()}
    });
    await exec('git', ['init', '--quiet'], {cwd: repository});
    const commit = async (value: string) => {
        await writeFile(path.join(repository, 'response.json'), JSON.stringify(value));
        await writeFile(
            path.join(repository, 'handler.mjs'),
            `import {readFile} from 'node:fs/promises';
export default async () => new Response(JSON.parse(await readFile(new URL('./response.json', import.meta.url), 'utf8')));`
        );
        await writeFile(
            path.join(repository, 'build.mts'),
            `
            import {mkdir, copyFile} from 'node:fs/promises';
            if (process.env.ALGOLIA_API_KEY || process.env.NETLIFY_KEY) throw new Error('Credentials reached build');
            const directory = 'packages/algolia-netlify/dist/functions';
            await mkdir(directory, {recursive: true});
            for (const name of ['post-published', 'post-unpublished']) {
                await copyFile('handler.mjs', directory + '/' + name + '.mjs');
            }
            await copyFile('response.json', directory + '/response.json');
        `
        );
        await exec('git', ['add', '.'], {cwd: repository});
        await exec(
            'git',
            [
                '-c',
                'user.name=Fixture',
                '-c',
                'user.email=fixture@example.invalid',
                '-c',
                'commit.gpgsign=false',
                'commit',
                '-qm',
                value
            ],
            {cwd: repository}
        );
        return (await exec('git', ['rev-parse', 'HEAD'], {cwd: repository})).stdout.trim();
    };
    return {repository, commit};
};
const invoke = async (
    directory: string,
    key = '?key=test-key',
    configuredKey: string | null = 'test-key',
    name: 'post-published' | 'post-unpublished' = 'post-published'
) => {
    const entry = pathToFileURL(path.join(directory, `functions/${name}.mts`)).href;
    const environment: NodeJS.ProcessEnv = {...process.env, CONTEXT: 'production'};
    if (configuredKey === null) {
        delete environment.NETLIFY_KEY;
    } else {
        environment.NETLIFY_KEY = configuredKey;
    }
    const result = await exec(
        process.execPath,
        [
            '--input-type=module',
            '-e',
            `
        const {default: handler} = await import(process.argv[1]);
        const response = await handler(new Request(process.argv[2]));
        console.log(JSON.stringify({status: response.status, body: await response.text()}));
    `,
            entry,
            `https://example.invalid/.netlify/functions/${name}${key}`
        ],
        {env: environment}
    );
    return JSON.parse(result.stdout) as {status: number; body: string};
};
afterEach(async () => {
    await Promise.all(
        directories.splice(0).map(directory => rm(directory, {recursive: true, force: true}))
    );
});

it.each(['latest', '', 'main', '__proto__', '../runtime', '^1', '1.0', '1.0.0-rc.1', '01'])(
    'rejects unsupported selection %j before creating output',
    async version => {
        const directory = await mkdtemp(path.join(os.tmpdir(), 'algolia-deployment-'));
        directories.push(directory);
        await expect(buildDeployment({directory, version})).rejects.toThrow(
            'Choose an integration major or exact stable version.'
        );
        expect(await readdir(directory)).toEqual([]);
    }
);

it('pins source across upstream changes and supports explicit upgrade and rollback', async () => {
    const {repository, commit} = await createReleaseRepository();
    const first = await commit('first release');
    const second = await commit('second release');
    const directory = await temporaryDirectory();
    const releases = {'1.0.0': first, '1.1.0': second};
    const options = {directory, repository, releases, offline: true, context: 'production'};
    await buildDeployment({...options, version: '1.0.0'});
    await exec(process.execPath, ['--check', path.join(directory, 'public/setup.js')]);
    expect(await invoke(directory)).toEqual({status: 200, body: 'first release'});
    expect(await invoke(directory, '?key=test-key', 'test-key', 'post-unpublished')).toEqual({
        status: 200,
        body: 'first release'
    });
    expect(await readFile(path.join(directory, 'release.json'), 'utf8')).toContain(first);
    await buildDeployment({...options, version: '1.1.0'});
    expect(await invoke(directory)).toEqual({status: 200, body: 'second release'});
    await buildDeployment({...options, version: '1.0.0'});
    expect(await invoke(directory)).toEqual({status: 200, body: 'first release'});
    expect(await invoke(directory, '?key=test-key', 'test-key', 'post-unpublished')).toEqual({
        status: 200,
        body: 'first release'
    });
}, 60000);

it('enforces authentication around a historical release that accepts unauthenticated requests', async () => {
    const {repository, commit} = await createReleaseRepository();
    const revision = await commit('historical response');
    const directory = await temporaryDirectory();
    await buildDeployment({
        directory,
        repository,
        releases: {'1.0.0': revision},
        version: '1.0.0',
        context: 'production',
        offline: true
    });
    for (const query of ['', '?key=', '?key=wrong', '?key=test-key&key=test-key']) {
        expect(await invoke(directory, query)).toEqual({status: 401, body: 'Unauthorized'});
    }
    for (const configuredKey of [null, '', '   ']) {
        expect(await invoke(directory, '?key=test-key', configuredKey)).toEqual({
            status: 503,
            body: 'Webhook authentication is not configured'
        });
    }
    expect(await invoke(directory)).toEqual({status: 200, body: 'historical response'});
}, 30000);

it.each(['deploy-preview', 'branch-deploy', undefined, 'unknown'])(
    'bakes isolation into handlers for context %j',
    async context => {
        const {repository, commit} = await createReleaseRepository();
        const revision = await commit('must not run');
        const directory = await temporaryDirectory();
        await buildDeployment({
            directory,
            repository,
            releases: {'1.0.0': revision},
            version: '1.0.0',
            context,
            offline: true
        });
        await rm(path.join(directory, 'runtime/packages/algolia-netlify/dist'), {recursive: true});
        expect(await invoke(directory)).toEqual({
            status: 403,
            body: 'Indexing is disabled outside production'
        });
        expect(await invoke(directory, '?key=test-key', 'test-key', 'post-unpublished')).toEqual({
            status: 403,
            body: 'Indexing is disabled outside production'
        });
    },
    30000
);

it('updates within the default major while leaving major upgrades explicit', async () => {
    const {repository, commit} = await createReleaseRepository();
    const first = await commit('compatibility release');
    const second = await commit('new release');
    const directory = await temporaryDirectory();
    await buildDeployment({
        directory,
        repository,
        releases: {'1.0.0': first, '1.0.2': first, '1.0.10': second, '2.0.0': first},
        context: 'production'
    });
    expect(await invoke(directory)).toEqual({status: 200, body: 'new release'});
    expect(JSON.parse(await readFile(path.join(directory, 'release.json'), 'utf8'))).toEqual({
        selection: '1',
        version: '1.0.10',
        commit: second
    });
}, 30000);

it('rejects a release mapped to a mutable source ref', async () => {
    const directory = await temporaryDirectory();
    await expect(
        buildDeployment({directory, version: '1.0.0', releases: {'1.0.0': 'main'}})
    ).rejects.toThrow('full commit IDs');
    expect(await readdir(directory)).toEqual([]);
});

it('stops on a changed dependency manifest instead of resolving new dependencies', async () => {
    const {repository, commit} = await createReleaseRepository();
    const first = await commit('valid release');
    const directory = await temporaryDirectory();
    await buildDeployment({
        directory,
        repository,
        releases: {'1.0.0': first},
        version: '1.0.0',
        context: 'production',
        offline: true
    });
    const manifest = JSON.parse(
        await readFile(path.join(repository, 'package.json'), 'utf8')
    ) as Record<string, unknown>;
    manifest.dependencies = {'unavailable-deployment-fixture': '1.0.0'};
    await writeFile(path.join(repository, 'package.json'), JSON.stringify(manifest));
    const broken = await commit('inconsistent lockfile');
    await expect(
        buildDeployment({
            directory,
            repository,
            releases: {'1.0.0': broken},
            version: '1.0.0',
            context: 'production',
            offline: true
        })
    ).rejects.toMatchObject({stderr: expect.stringContaining('ERR_PNPM_OUTDATED_LOCKFILE')});
    expect(await readdir(directory)).not.toContain('functions');
}, 30000);

it('reports an invalid CLI selection without echoing configuration', async () => {
    const script = new URL('../deployment/build.mts', import.meta.url);
    await expect(
        exec(process.execPath, [script.pathname], {
            env: {...process.env, ALGOLIA_INTEGRATION_VERSION: 'private-invalid-selection'}
        })
    ).rejects.toMatchObject({
        code: 1,
        stderr: 'Choose an integration major or exact stable version.\n'
    });
});

it('discovers compatible releases from the shared catalog on every rebuild', async () => {
    const {repository, commit} = await createReleaseRepository();
    const first = await commit('first runtime');
    const patch = await commit('patched runtime');
    const minor = await commit('minor runtime');
    const major = await commit('major runtime');
    let catalog: Record<string, string> = {'1.0.0': first};
    const server = createServer((_request, response) => {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify(catalog));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') {
        throw new Error('Missing catalog address');
    }
    const directory = await temporaryDirectory();
    const options = {
        directory,
        repository,
        offline: true,
        context: 'production',
        catalogUrl: `http://127.0.0.1:${address.port}`
    };
    try {
        await buildDeployment({...options, version: '1'});
        expect(await invoke(directory)).toEqual({status: 200, body: 'first runtime'});
        catalog = {...catalog, '1.0.1': patch};
        await buildDeployment({...options, version: '1'});
        expect(await invoke(directory)).toEqual({status: 200, body: 'patched runtime'});
        catalog = {...catalog, '1.1.0': minor, '2.0.0': major};
        await buildDeployment({...options, version: '1'});
        expect(await invoke(directory)).toEqual({status: 200, body: 'minor runtime'});
        await buildDeployment({...options, version: '2'});
        expect(await invoke(directory)).toEqual({status: 200, body: 'major runtime'});
        await buildDeployment({...options, version: '1.0.1'});
        expect(await invoke(directory)).toEqual({status: 200, body: 'patched runtime'});
    } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => {
            server.close(closeError => {
                if (closeError) {
                    reject(closeError);
                } else {
                    resolve();
                }
            });
        });
    }
}, 60000);

it.each([
    {status: 503, body: '{}', error: 'Could not load'},
    {status: 200, body: 'invalid json', error: 'Could not load'},
    {status: 200, body: '[]', error: 'Invalid integration release catalog'},
    {status: 200, body: 'null', error: 'Invalid integration release catalog'},
    {status: 200, body: '{"1.0.0-rc.1":"main"}', error: 'stable versions'},
    {status: 200, body: '{"1.0.0":42}', error: 'full commit IDs'},
    {status: 200, body: '{"1.0.0":"main"}', error: 'full commit IDs'},
    {status: 200, body: '{}', error: 'Unknown integration release'}
])(
    'stops before building when the shared catalog is unusable: $body / $status',
    async ({status, body, error}) => {
        const server = createServer((_request, response) => {
            response.writeHead(status).end(body);
        });
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const address = server.address();
        if (!address || typeof address === 'string') {
            throw new Error('Missing catalog address');
        }
        const directory = await temporaryDirectory();
        try {
            await expect(
                buildDeployment({
                    directory,
                    version: '1',
                    catalogUrl: `http://127.0.0.1:${address.port}`
                })
            ).rejects.toThrow(error);
            expect(await readdir(directory)).toEqual([]);
        } finally {
            server.closeAllConnections();
            await new Promise<void>((resolve, reject) => {
                server.close(closeError => {
                    if (closeError) {
                        reject(closeError);
                    } else {
                        resolve();
                    }
                });
            });
        }
    }
);

it.each([null, 'npm@12.11.0'])(
    'rejects a runtime without a supported package manager pin: %j',
    async packageManager => {
        const {repository, commit} = await createReleaseRepository();
        const manifest = JSON.parse(
            await readFile(path.join(repository, 'package.json'), 'utf8')
        ) as Record<string, unknown>;
        manifest.packageManager = packageManager;
        await writeFile(path.join(repository, 'package.json'), JSON.stringify(manifest));
        const revision = await commit('unsupported toolchain');
        const directory = await temporaryDirectory();
        await expect(
            buildDeployment({
                directory,
                repository,
                releases: {'1.0.0': revision},
                version: '1.0.0',
                offline: true
            })
        ).rejects.toThrow('Use the exact pnpm version');
        expect(await readdir(directory)).not.toContain('functions');
    }
);

it('builds a bundled exact candidate without requiring the shared catalog', async () => {
    const {repository, commit} = await createReleaseRepository();
    const revision = await commit('candidate runtime');
    const directory = await temporaryDirectory();
    await writeFile(path.join(directory, 'releases.json'), JSON.stringify({'1.2.0': revision}));
    await buildDeployment({
        directory,
        repository,
        version: '1.2.0',
        context: 'production',
        offline: true,
        catalogUrl: 'http://127.0.0.1:1'
    });
    expect(await invoke(directory)).toEqual({status: 200, body: 'candidate runtime'});
    expect(JSON.parse(await readFile(path.join(directory, 'release.json'), 'utf8'))).toEqual({
        selection: '1.2.0',
        version: '1.2.0',
        commit: revision
    });
});
