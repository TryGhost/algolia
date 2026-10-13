import {execFile} from 'node:child_process';
import {access, copyFile, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {stripTypeScriptTypes} from 'node:module';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

import {DEFAULT_RELEASE, discoverRelease, selectRelease, validateSelection} from './releases.mts';

const exec = promisify(execFile);
const HANDLERS = ['post-published', 'post-unpublished'] as const;
const REPOSITORY = 'https://github.com/TryGhost/algolia.git';
const PACKAGE_MANAGER_ERRORS = [
    'ERR_PNPM_OUTDATED_LOCKFILE',
    'ERR_PNPM_BAD_PM_VERSION',
    'ERR_PNPM_UNSUPPORTED_ENGINE',
    'ERR_PNPM_NO_LOCKFILE',
    'ERR_PNPM_NO_OFFLINE_TARBALL',
    'ERR_PNPM_FETCH_404',
    'ERR_PNPM_FETCH_401',
    'ERR_PNPM_FETCH_403'
] as const;

export type DeploymentOptions = {
    directory: string;
    version?: string;
    context?: string;
    siteUrl?: string;
    repository?: string;
    releases?: Readonly<Record<string, string>>;
    offline?: boolean;
    releasesUrl?: string;
};

const buildEnvironment = (): NodeJS.ProcessEnv => {
    const environment: NodeJS.ProcessEnv = {CI: 'true'};
    for (const name of ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'SystemRoot']) {
        if (process.env[name] !== undefined) {
            environment[name] = process.env[name];
        }
    }
    return environment;
};

/** Build an isolated, selected integration snapshot without contacting Algolia. */
export const buildDeployment = async (options: DeploymentOptions): Promise<void> => {
    const selection = options.version ?? DEFAULT_RELEASE;
    validateSelection(selection);
    const {version, commit} =
        options.releases === undefined
            ? await discoverRelease(selection, options.releasesUrl)
            : selectRelease(selection, options.releases);

    const runtime = path.join(options.directory, 'runtime');
    // Keep generated entrypoints beside the selected package's dependencies. Netlify
    // hoists bare imports while compiling native handlers, then traces from this location.
    const functions = path.join(runtime, 'packages/algolia-netlify/deployment-functions');
    await rm(functions, {recursive: true, force: true});
    await rm(runtime, {recursive: true, force: true});
    await mkdir(runtime, {recursive: true});
    const run = async (stage: string, command: string, args: string[]): Promise<string> => {
        const environment = buildEnvironment();
        if (command === 'git') {
            // Fetch public release source without host credential helpers or URL rewrites.
            environment.GIT_CONFIG_GLOBAL = '/dev/null';
            environment.GIT_CONFIG_NOSYSTEM = '1';
        }
        try {
            const result = await exec(command, args, {
                cwd: runtime,
                env: environment,
                maxBuffer: 8 * 1024 * 1024
            });
            return result.stdout.trim();
        } catch (cause) {
            const details: string[] = [];
            if (cause instanceof Error) {
                if ('code' in cause && typeof cause.code === 'number') {
                    details.push(`exit ${cause.code}`);
                }
                const code = PACKAGE_MANAGER_ERRORS.find(value =>
                    new RegExp(`\\b${value}\\b`).test(cause.message)
                );
                if (code) {
                    details.push(code);
                }
            }
            throw new Error(
                `Integration ${stage} failed${details.length ? ` (${details.join('; ')})` : ''}.`,
                {cause}
            );
        }
    };
    await run('source initialization', 'git', ['init', '--quiet']);
    await run('source download', 'git', [
        'fetch',
        '--quiet',
        '--depth=1',
        options.repository ?? REPOSITORY,
        commit
    ]);
    await run('source checkout', 'git', [
        '-c',
        'core.hooksPath=/dev/null',
        'checkout',
        '--quiet',
        '--detach',
        'FETCH_HEAD'
    ]);
    if ((await run('source verification', 'git', ['rev-parse', 'HEAD'])) !== commit) {
        throw new Error('Integration source commit verification failed.');
    }
    const manifest = JSON.parse(await readFile(path.join(runtime, 'package.json'), 'utf8')) as {
        packageManager?: string;
    };
    const manager = /^pnpm@(\d+\.\d+\.\d+)(?:\+sha512\.[a-f0-9]+)?$/.exec(
        manifest.packageManager ?? ''
    );
    if (
        !manager ||
        (await run('package manager verification', 'pnpm', ['--version'])) !== manager[1]
    ) {
        throw new Error('Use the exact pnpm version declared by the integration release.');
    }
    await run('dependency installation', 'pnpm', [
        'install',
        '--frozen-lockfile',
        '--ignore-scripts',
        ...(options.offline ? ['--offline'] : [])
    ]);
    await run('workspace build', 'pnpm', ['run', 'build']);
    await run('function build', 'pnpm', ['--filter', '@tryghost/algolia-netlify', 'build:package']);

    const publicDirectory = path.join(options.directory, 'public');
    await mkdir(publicDirectory, {recursive: true});
    await writeFile(
        path.join(publicDirectory, 'setup.js'),
        stripTypeScriptTypes(await readFile(new URL('./setup.mts', import.meta.url), 'utf8')) +
            `\ninitializeSetup(${JSON.stringify({production: options.context === 'production', siteUrl: options.siteUrl})});\n`
    );

    await copyFile(
        new URL('./guard.mts', import.meta.url),
        path.join(runtime, 'deployment-guard.mts')
    );
    await mkdir(functions, {recursive: true});
    for (const name of HANDLERS) {
        await access(path.join(runtime, 'packages/algolia-netlify/dist/functions', `${name}.mjs`));
        await writeFile(
            path.join(functions, `${name}.mts`),
            `import {authorizeDeployment} from '../../../deployment-guard.mts';
export default async function handler(request: Request): Promise<Response> {
    if (${JSON.stringify(options.context !== 'production')}) return new Response('Indexing is disabled outside production', {status: 403});
    const denied = authorizeDeployment(request);
    if (denied) return denied;
    const {default: selected} = await import('../dist/functions/${name}.mjs');
    return selected(request);
}
`
        );
    }
    await writeFile(
        path.join(options.directory, 'release.json'),
        JSON.stringify({selection, version, commit}, null, 2) + '\n'
    );
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        await buildDeployment({
            directory: fileURLToPath(new URL('.', import.meta.url)),
            version: process.env.ALGOLIA_INTEGRATION_VERSION,
            context: process.env.CONTEXT,
            siteUrl: process.env.URL
        });
        const release = JSON.parse(
            await readFile(new URL('./release.json', import.meta.url), 'utf8')
        ) as {version: string; commit: string};
        process.stdout.write(
            `Prepared Algolia integration ${release.version} (${release.commit}).\n`
        );
    } catch (error) {
        process.stderr.write(
            (error instanceof Error && !('cmd' in error)
                ? error.message
                : 'Integration build failed. Check release availability and the pinned build tools.') +
                '\n'
        );
        process.exitCode = 1;
    }
}
