import {createServer} from 'node:http';
import {once} from 'node:events';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {access, mkdtemp, readdir, rm, writeFile, readFile, symlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, expect, it, vi} from 'vitest';

import {buildDeployment} from '../deployment/build.mts';

const exec = promisify(execFile);
const pnpmVersion = (await exec('pnpm', ['--version'])).stdout.trim();
const directories: string[] = [];
const functionsDirectory = (directory: string) =>
    path.join(directory, 'runtime/packages/algolia-netlify/deployment-functions');
const temporaryDirectory = async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'algolia-deployment-'));
    directories.push(directory);
    return directory;
};
const createReleaseRepository = async (nestedDependency = false) => {
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
            nestedDependency
                ? `import value from 'deployment-runtime-fixture';\nexport default async () => new Response(value);`
                : `import {readFile} from 'node:fs/promises';
export default async () => new Response(JSON.parse(await readFile(new URL('./response.json', import.meta.url), 'utf8')));`
        );
        await writeFile(
            path.join(repository, 'build.mts'),
            `
            import {mkdir, copyFile, writeFile} from 'node:fs/promises';
            if (process.env.ALGOLIA_API_KEY || process.env.NETLIFY_KEY) throw new Error('Credentials reached build');
            const directory = 'packages/algolia-netlify/dist/functions';
            await mkdir(directory, {recursive: true});
            for (const name of ['post-published', 'post-unpublished']) {
                await copyFile('handler.mjs', directory + '/' + name + '.mjs');
            }
            await copyFile('response.json', directory + '/response.json');
            if (${nestedDependency}) {
                const dependency = 'packages/algolia-netlify/node_modules/deployment-runtime-fixture';
                await mkdir(dependency, {recursive: true});
                await writeFile(dependency + '/package.json', JSON.stringify({name: 'deployment-runtime-fixture', type: 'module', exports: './index.mjs'}));
                await writeFile(dependency + '/index.mjs', ${JSON.stringify(`export default ${JSON.stringify(value)};`)});
            }
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
    const entry = pathToFileURL(path.join(functionsDirectory(directory), `${name}.mts`)).href;
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
    vi.unstubAllEnvs();
    await Promise.all(
        directories.splice(0).map(directory => rm(directory, {recursive: true, force: true}))
    );
});

it.each(['latest', '', 'main', '__proto__', '../runtime', '^1', '1.0', '1.0.0-01', '01'])(
    'rejects unsupported selection %j before creating output',
    async version => {
        const directory = await mkdtemp(path.join(os.tmpdir(), 'algolia-deployment-'));
        directories.push(directory);
        await expect(buildDeployment({directory, version})).rejects.toThrow(
            'Choose an integration major or exact version.'
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
        releases: {
            '0.0.0': first,
            '0.0.2': first,
            '0.0.10': second,
            '0.9.0-rc.1': first,
            '1.0.0-rc.1': first,
            '1.0.0': first
        },
        context: 'production'
    });
    expect(await invoke(directory)).toEqual({status: 200, body: 'new release'});
    expect(JSON.parse(await readFile(path.join(directory, 'release.json'), 'utf8'))).toEqual({
        selection: '0',
        version: '0.0.10',
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
    ).rejects.toThrow(
        'Integration dependency installation failed (exit 1; ERR_PNPM_OUTDATED_LOCKFILE).'
    );
    await expect(access(functionsDirectory(directory))).rejects.toMatchObject({code: 'ENOENT'});
}, 30000);

it('reports an invalid CLI selection without echoing configuration', async () => {
    const script = new URL('../deployment/build.mts', import.meta.url);
    await expect(
        exec(process.execPath, [script.pathname], {
            env: {...process.env, ALGOLIA_INTEGRATION_VERSION: 'private-invalid-selection'}
        })
    ).rejects.toMatchObject({
        code: 1,
        stderr: 'Choose an integration major or exact version.\n'
    });
});

it('identifies source download failures without exposing subprocess arguments', async () => {
    const directory = await temporaryDirectory();
    await expect(
        buildDeployment({
            directory,
            repository: path.join(directory, 'private-repository-secret'),
            releases: {'1.0.0': 'a'.repeat(40)},
            version: '1.0.0'
        })
    ).rejects.toThrow(/^Integration source download failed \(exit 128\)\.$/);
});

it('fetches the selected source without inheriting host Git URL rewrites', async () => {
    const {repository, commit} = await createReleaseRepository();
    const revision = await commit('explicit source');
    const directory = await temporaryDirectory();
    const home = await temporaryDirectory();
    const bin = await temporaryDirectory();
    // Use the installed executable so the isolated home needs no Corepack download.
    const executable = (
        await exec('pnpm', ['exec', 'node', '-p', 'process.env.npm_execpath'])
    ).stdout.trim();
    await symlink(executable, path.join(bin, 'pnpm'));
    const config = `[url "${path.join(home, 'missing-private-repository')}"]\n\tinsteadOf = ${repository}\n`;
    await writeFile(path.join(home, '.gitconfig'), config);
    vi.stubEnv('HOME', home);
    vi.stubEnv('PATH', `${bin}${path.delimiter}${process.env.PATH}`);

    await buildDeployment({
        directory,
        repository,
        releases: {'1.0.0': revision},
        version: '1.0.0',
        context: 'production',
        offline: true
    });

    expect(await invoke(directory)).toEqual({status: 200, body: 'explicit source'});
    expect(await readFile(path.join(home, '.gitconfig'), 'utf8')).toBe(config);
}, 30000);

it.each([
    {selection: '0', version: '0.5.0', prerelease: false},
    {selection: '0.4.7-pr.333.1', version: '0.4.7-pr.333.1', prerelease: true}
])(
    'discovers the published package release for $selection and verifies its manifest',
    async ({selection, version, prerelease}) => {
        const {repository, commit} = await createReleaseRepository();
        const revision = await commit('released runtime');
        const directory = await temporaryDirectory();
        const requests: string[] = [];
        const tag = `@tryghost/algolia-netlify@${version}`;
        const assetPath = `/TryGhost/algolia/releases/download/${encodeURIComponent(tag).replaceAll('%40', '@')}/netlify-release.json`;
        const server = createServer((request, response) => {
            requests.push(request.url ?? '');
            response.setHeader('content-type', 'application/json');
            if (request.url === `/repos/TryGhost/algolia/commits/${encodeURIComponent(tag)}`) {
                response.end(JSON.stringify({sha: revision}));
                return;
            }
            if (request.url === assetPath) {
                response.end(JSON.stringify({version, commit: revision}));
                return;
            }
            const page = new URL(request.url ?? '', 'http://localhost').searchParams.get('page');
            if (page === '1') {
                response.setHeader('link', `<${origin}/releases?per_page=100&page=2>; rel="next"`);
                response.end(
                    JSON.stringify([{tag_name: 'unrelated', draft: false, prerelease: false}])
                );
            } else {
                response.end(
                    JSON.stringify([
                        {tag_name: '@tryghost/algolia-netlify@9.0.0', draft: true},
                        {
                            tag_name: '@tryghost/algolia-netlify@0.9.0-rc.1',
                            draft: false,
                            prerelease: true
                        },
                        {
                            tag_name: '@tryghost/algolia-netlify@9.0.0-rc.1',
                            draft: false,
                            prerelease: true
                        },
                        {
                            tag_name: '@tryghost/algolia-netlify@0.9.0',
                            draft: false,
                            prerelease: true
                        },
                        {
                            tag_name: tag,
                            target_commitish: 'main',
                            draft: false,
                            prerelease,
                            assets: [
                                {
                                    name: 'netlify-release.json',
                                    browser_download_url: origin + assetPath
                                }
                            ]
                        }
                    ])
                );
            }
        });
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const address = server.address();
        if (!address || typeof address === 'string') {
            throw new Error('Missing server address');
        }
        const origin = `http://127.0.0.1:${address.port}`;
        try {
            await buildDeployment({
                directory,
                version: selection,
                repository,
                releasesUrl: origin + '/releases',
                offline: true,
                context: 'production'
            });
            expect(await invoke(directory)).toEqual({status: 200, body: 'released runtime'});
            expect(
                JSON.parse(await readFile(path.join(directory, 'release.json'), 'utf8'))
            ).toEqual({
                selection,
                version,
                commit: revision
            });
            expect(requests).toEqual([
                '/releases?per_page=100&page=1',
                '/releases?per_page=100&page=2',
                `/repos/TryGhost/algolia/commits/${encodeURIComponent(tag)}`,
                assetPath
            ]);
        } finally {
            server.closeAllConnections();
            await new Promise<void>(resolve => {
                server.close(() => resolve());
            });
        }
    },
    30000
);

it.each([
    {version: '0.4.7-pr.333.1', draft: true, prerelease: true},
    {version: '0.4.7-pr.333.1', draft: false, prerelease: false},
    {version: '0.4.7-pr.333.1', draft: false, prerelease: undefined},
    {version: '0.5.0', draft: false, prerelease: true}
])(
    'rejects an exact $version release with draft=$draft and prerelease=$prerelease',
    async ({version, draft, prerelease}) => {
        const requests: string[] = [];
        const server = createServer((request, response) => {
            requests.push(request.url ?? '');
            response.setHeader('content-type', 'application/json');
            response.end(
                JSON.stringify([
                    {tag_name: `@tryghost/algolia-netlify@${version}`, draft, prerelease}
                ])
            );
        });
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const address = server.address();
        if (!address || typeof address === 'string') {
            throw new Error('Missing server address');
        }
        const directory = await temporaryDirectory();
        try {
            await expect(
                buildDeployment({
                    directory,
                    version,
                    releasesUrl: `http://127.0.0.1:${address.port}/releases`
                })
            ).rejects.toThrow('Unknown integration release.');
            expect(requests).toEqual(['/releases?per_page=100&page=1']);
            expect(await readdir(directory)).toEqual([]);
        } finally {
            server.closeAllConnections();
            await new Promise<void>(resolve => {
                server.close(() => resolve());
            });
        }
    }
);

it.each([
    {status: 503, body: '{}', error: 'Could not load'},
    {status: 200, body: 'invalid json', error: 'Could not load'},
    {status: 200, body: 'null', error: 'Invalid GitHub'},
    {status: 200, body: '{}', error: 'Invalid GitHub'},
    {status: 200, body: '[]', error: 'Unknown integration release'}
])('fails closed on unusable release discovery: $body / $status', async ({status, body, error}) => {
    const server = createServer((_request, response) => response.writeHead(status).end(body));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') {
        throw new Error('Missing server address');
    }
    const directory = await temporaryDirectory();
    // An old local catalog must never bypass published release verification.
    await writeFile(
        path.join(directory, 'releases.json'),
        JSON.stringify({'0.5.0': 'a'.repeat(40)})
    );
    try {
        await expect(
            buildDeployment({
                directory,
                version: '0.5.0',
                releasesUrl: `http://127.0.0.1:${address.port}`
            })
        ).rejects.toThrow(error);
        expect(await readdir(directory)).toEqual(['releases.json']);
    } finally {
        server.closeAllConnections();
        await new Promise<void>(resolve => {
            server.close(() => resolve());
        });
    }
});

it.each([
    'missing asset',
    'wrong origin',
    'wrong tag path',
    'invalid tag commit',
    'mismatched version',
    'mismatched commit',
    'malformed manifest'
])('rejects the latest selected release with %s without downgrading', async failure => {
    const requests: string[] = [];
    const revision = 'a'.repeat(40);
    const tag = '@tryghost/algolia-netlify@0.5.0';
    const assetPath = `/TryGhost/algolia/releases/download/${encodeURIComponent(tag)}/netlify-release.json`;
    const server = createServer((request, response) => {
        requests.push(request.url ?? '');
        response.setHeader('content-type', 'application/json');
        if (request.url === `/repos/TryGhost/algolia/commits/${encodeURIComponent(tag)}`) {
            response.end(
                JSON.stringify({sha: failure === 'invalid tag commit' ? 'main' : revision})
            );
            return;
        }
        if (request.url === assetPath) {
            response.end(
                failure === 'malformed manifest'
                    ? '{'
                    : JSON.stringify({
                          version: failure === 'mismatched version' ? '0.4.0' : '0.5.0',
                          commit: failure === 'mismatched commit' ? 'b'.repeat(40) : revision
                      })
            );
            return;
        }
        response.end(
            JSON.stringify([
                {
                    tag_name: '@tryghost/algolia-netlify@0.4.0',
                    draft: false,
                    prerelease: false,
                    target_commitish: revision,
                    assets: []
                },
                {
                    tag_name: tag,
                    draft: false,
                    prerelease: false,
                    target_commitish: failure === 'invalid tag commit' ? 'main' : revision,
                    assets:
                        failure === 'missing asset'
                            ? []
                            : [
                                  {
                                      name: 'netlify-release.json',
                                      browser_download_url:
                                          failure === 'wrong origin'
                                              ? 'https://example.invalid' + assetPath
                                              : origin +
                                                (failure === 'wrong tag path'
                                                    ? assetPath.replace('0.5.0', '0.4.0')
                                                    : assetPath)
                                  }
                              ]
                }
            ])
        );
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') {
        throw new Error('Missing server address');
    }
    const origin = `http://127.0.0.1:${address.port}`;
    const directory = await temporaryDirectory();
    try {
        await expect(
            buildDeployment({directory, releasesUrl: origin + '/releases'})
        ).rejects.toThrow(/integration release manifest/);
        expect(await readdir(directory)).toEqual([]);
        expect(requests).toEqual(
            ['mismatched version', 'mismatched commit', 'malformed manifest'].includes(failure)
                ? [
                      '/releases?per_page=100&page=1',
                      `/repos/TryGhost/algolia/commits/${encodeURIComponent(tag)}`,
                      assetPath
                  ]
                : failure === 'invalid tag commit'
                  ? [
                        '/releases?per_page=100&page=1',
                        `/repos/TryGhost/algolia/commits/${encodeURIComponent(tag)}`
                    ]
                  : ['/releases?per_page=100&page=1']
        );
    } finally {
        server.closeAllConnections();
        await new Promise<void>(resolve => {
            server.close(() => resolve());
        });
    }
});

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
        await expect(access(functionsDirectory(directory))).rejects.toMatchObject({code: 'ENOENT'});
    }
);

it.each(['deploy-preview', 'production'])(
    'packages the selected runtime dependencies into an isolated %s archive',
    async context => {
        const {repository, commit} = await createReleaseRepository(true);
        const revision = await commit('packaged runtime');
        const directory = await temporaryDirectory();
        await buildDeployment({
            directory,
            repository,
            releases: {'1.0.0': revision},
            version: '1.0.0',
            context,
            offline: true
        });
        const netlifyRequire = createRequire(
            new URL(
                '../packages/algolia-netlify/node_modules/netlify-cli/package.json',
                import.meta.url
            )
        );
        const bundler = pathToFileURL(netlifyRequire.resolve('@netlify/zip-it-and-ship-it')).href;
        const archives = await temporaryDirectory();
        await exec(process.execPath, [
            '--input-type=module',
            '-e',
            `
            const {zipFunctions} = await import(process.argv[1]);
            await zipFunctions(process.argv[2], process.argv[3], {basePath: process.argv[4], repositoryRoot: process.argv[4], config: {'*': {nodeVersion: '24'}}});
        `,
            bundler,
            functionsDirectory(directory),
            archives,
            directory
        ]);
        for (const name of ['post-published', 'post-unpublished']) {
            const extracted = await temporaryDirectory();
            await exec('unzip', ['-q', path.join(archives, name + '.zip'), '-d', extracted]);
            const entry = (await readdir(extracted, {recursive: true})).find(
                file => path.basename(file) === name + '.mjs'
            );
            if (!entry) {
                throw new Error('Missing packaged handler');
            }
            const result = await exec(
                process.execPath,
                [
                    '--input-type=module',
                    '-e',
                    `
                const {default: handler} = await import(process.argv[1]);
                const responses = [];
                for (const key of [undefined, 'test-key']) {
                    if (key === undefined) delete process.env.NETLIFY_KEY;
                    else process.env.NETLIFY_KEY = key;
                    for (const query of ['', '?key=test-key']) {
                        const response = await handler(new Request('https://example.invalid/' + query));
                        responses.push({status: response.status, body: await response.text()});
                    }
                }
                console.log(JSON.stringify(responses));
            `,
                    pathToFileURL(path.join(extracted, entry)).href
                ],
                {cwd: extracted}
            );
            expect(JSON.parse(result.stdout)).toEqual(
                context === 'production'
                    ? [
                          {status: 503, body: 'Webhook authentication is not configured'},
                          {status: 503, body: 'Webhook authentication is not configured'},
                          {status: 401, body: 'Unauthorized'},
                          {status: 200, body: 'packaged runtime'}
                      ]
                    : Array.from({length: 4}, () => ({
                          status: 403,
                          body: 'Indexing is disabled outside production'
                      }))
            );
        }
    },
    30000
);
