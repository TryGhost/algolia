import {execFile} from 'node:child_process';
import {access, copyFile, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

import {DEFAULT_RELEASE, RELEASES} from './releases.mts';

const exec = promisify(execFile);
const HANDLERS = ['post-published', 'post-unpublished'] as const;
const REPOSITORY = 'https://github.com/TryGhost/algolia.git';

export type DeploymentOptions = {
    directory: string;
    version?: string;
    context?: string;
    repository?: string;
    releases?: Readonly<Record<string, string>>;
    offline?: boolean;
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
    const version = options.version ?? DEFAULT_RELEASE;
    const releases = options.releases ?? RELEASES;
    if (!Object.hasOwn(releases, version)) {
        throw new Error(
            'Unknown integration release. Choose a release listed in deployment/releases.mts.'
        );
    }
    const commit = releases[version];
    if (!/^[a-f0-9]{40}$/.test(commit)) {
        throw new Error('Integration release must select a full commit ID.');
    }

    const runtime = path.join(options.directory, 'runtime');
    const functions = path.join(options.directory, 'functions');
    await rm(functions, {recursive: true, force: true});
    await rm(runtime, {recursive: true, force: true});
    await mkdir(runtime, {recursive: true});
    const run = async (command: string, args: string[]): Promise<string> => {
        const result = await exec(command, args, {
            cwd: runtime,
            env: buildEnvironment(),
            maxBuffer: 8 * 1024 * 1024
        });
        return result.stdout.trim();
    };
    await run('git', ['init', '--quiet']);
    await run('git', ['fetch', '--quiet', '--depth=1', options.repository ?? REPOSITORY, commit]);
    await run('git', [
        '-c',
        'core.hooksPath=/dev/null',
        'checkout',
        '--quiet',
        '--detach',
        'FETCH_HEAD'
    ]);
    if ((await run('git', ['rev-parse', 'HEAD'])) !== commit) {
        throw new Error('Integration source commit verification failed.');
    }
    const manifest = JSON.parse(await readFile(path.join(runtime, 'package.json'), 'utf8')) as {
        packageManager?: string;
    };
    const manager = /^pnpm@(\d+\.\d+\.\d+)(?:\+sha512\.[a-f0-9]+)?$/.exec(
        manifest.packageManager ?? ''
    );
    if (!manager || (await run('pnpm', ['--version'])) !== manager[1]) {
        throw new Error('Use the exact pnpm version declared by the integration release.');
    }
    await run('pnpm', [
        'install',
        '--frozen-lockfile',
        '--ignore-scripts',
        ...(options.offline ? ['--offline'] : [])
    ]);
    await run('pnpm', ['run', 'build']);
    await run('pnpm', ['--filter', '@tryghost/algolia-netlify', 'build:package']);

    await copyFile(
        new URL('./guard.mts', import.meta.url),
        path.join(runtime, 'deployment-guard.mts')
    );
    await mkdir(functions, {recursive: true});
    for (const name of HANDLERS) {
        await access(path.join(runtime, 'packages/algolia-netlify/dist/functions', `${name}.mjs`));
        await writeFile(
            path.join(functions, `${name}.mts`),
            `import {authorizeDeployment} from '../runtime/deployment-guard.mts';
export default async function handler(request: Request): Promise<Response> {
    if (${JSON.stringify(options.context !== 'production')}) return new Response('Indexing is disabled outside production', {status: 403});
    const denied = authorizeDeployment(request);
    if (denied) return denied;
    const {default: selected} = await import('../runtime/packages/algolia-netlify/dist/functions/${name}.mjs');
    return selected(request);
}
`
        );
    }
    await writeFile(
        path.join(options.directory, 'release.json'),
        JSON.stringify({version, commit}, null, 2) + '\n'
    );
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        await buildDeployment({
            directory: fileURLToPath(new URL('.', import.meta.url)),
            version: process.env.ALGOLIA_INTEGRATION_VERSION,
            context: process.env.CONTEXT
        });
        process.stdout.write(
            `Prepared Algolia integration ${process.env.ALGOLIA_INTEGRATION_VERSION ?? DEFAULT_RELEASE}.\n`
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
