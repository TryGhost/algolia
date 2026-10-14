import {execFileSync, spawnSync} from 'node:child_process';
import {
    mkdtempSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
    symlinkSync,
    rmSync,
    existsSync,
    chmodSync
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, expect, it} from 'vitest';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directories = [];
/** Creates an isolated Git workspace and bare remote for exercising the release command. */
function fixture(plans = {one: {'@test/one': 'patch'}}, withDependent = false, environment = {}) {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'algolia-ship-'));
    directories.push(directory);
    const root = path.join(directory, 'workspace');
    mkdirSync(root);
    const git = (...args) =>
        execFileSync('git', args, {
            cwd: root,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe']
        }).trim();
    const write = (name, value) => {
        mkdirSync(path.dirname(path.join(root, name)), {recursive: true});
        writeFileSync(
            path.join(root, name),
            typeof value === 'string' ? value : JSON.stringify(value, null, 2)
        );
    };
    write('package.json', {
        private: true,
        workspaces: ['packages/*'],
        scripts: {test: 'node verify-release.cjs'}
    });
    write(
        'verify-release.cjs',
        `
        const fs = require('node:fs');
        const version = JSON.parse(fs.readFileSync('packages/one/package.json', 'utf8')).version;
        if (process.env.FAIL_VERSIONED_TEST === 'true' && version !== '1.0.0') {
            throw new Error('Versioned package verification failed');
        }
    `
    );
    const config = JSON.parse(readFileSync(path.join(repository, 'nx.json'), 'utf8'));
    config.release.version.versionActionsOptions = {skipLockFileUpdate: true};
    write('nx.json', config);
    write('.gitignore', 'node_modules\n.nx/*\n!.nx/version-plans/\n');
    for (const name of ['one', 'two']) {
        write(`packages/${name}/package.json`, {
            name: `@test/${name}`,
            version: '1.0.0',
            ...(withDependent && name === 'two' ? {dependencies: {'@test/one': '^1.0.0'}} : {}),
            scripts: {
                prepublishOnly:
                    "node -e \"require('fs').writeFileSync('PUBLISHED', 'bad'); process.exit(99)\""
            }
        });
    }
    symlinkSync(path.join(repository, 'node_modules'), path.join(root, 'node_modules'));
    git('init', '-b', 'main');
    git('config', 'user.name', 'Release test');
    git('config', 'user.email', 'release@example.test');
    git('config', 'commit.gpgsign', 'false');
    git('config', 'tag.gpgsign', 'false');
    git('add', '.');
    git('commit', '-m', 'Initial packages');
    for (const name of ['one', 'two']) {
        git('tag', '-a', `@test/${name}@1.0.0`, '-m', 'Initial version');
    }
    for (const [name, packages] of Object.entries(plans)) {
        write(
            `.nx/version-plans/${name}.md`,
            `---\n${Object.entries(packages)
                .map(([project, bump]) => `'${project}': ${bump}`)
                .join('\n')}\n---\n\nPreserved existing search records.\n`
        );
    }
    git('add', '.');
    if (Object.keys(plans).length) {
        git('commit', '-m', 'Added release plans');
    }
    const remote = path.join(directory, 'remote.git');
    execFileSync('git', ['init', '--bare', remote], {stdio: 'ignore'});
    git('remote', 'add', 'origin', remote);
    git('push', '--follow-tags', '-u', 'origin', 'main');
    const initial = git('rev-parse', 'HEAD');
    const ship = (...args) => {
        const result = spawnSync(
            process.execPath,
            [path.join(repository, 'scripts/ship.mts'), ...args],
            {
                cwd: root,
                encoding: 'utf8',
                timeout: 90000,
                env: {
                    ...process.env,
                    NX_DAEMON: 'false',
                    NX_ISOLATE_PLUGINS: 'false',
                    NX_WORKSPACE_ROOT_PATH: root,
                    NX_INTERACTIVE: 'false',
                    CI: 'true',
                    npm_config_registry: 'http://127.0.0.1:1',
                    GHOST_UPSTREAM: 'origin',
                    ...environment
                }
            }
        );
        return {...result, output: `${result.stdout}\n${result.stderr}`};
    };
    const read = name => readFileSync(path.join(root, name), 'utf8');
    return {root, git, ship, read, initial, remote};
}
afterEach(() => {
    for (const directory of directories.splice(0)) {
        rmSync(directory, {recursive: true, force: true});
    }
});

it('ships the planned package and its changelog together without publishing locally', () => {
    const site = fixture();
    const result = site.ship('--projects=@test/one');
    expect(result.status).toBe(0);
    expect(JSON.parse(site.read('packages/one/package.json')).version).toBe('1.0.1');
    expect(site.read('packages/one/CHANGELOG.md')).toContain('Preserved existing search records.');
    expect(site.git('rev-list', '--count', `${site.initial}..HEAD`)).toBe('1');
    expect(site.git('show', '--format=', '--name-only', 'HEAD')).toContain(
        'packages/one/CHANGELOG.md'
    );
    expect(site.git('rev-parse', '@test/one@1.0.1^{}')).toBe(site.git('rev-parse', 'HEAD'));
    expect(site.git('rev-parse', 'origin/main')).toBe(site.git('rev-parse', 'HEAD'));
    expect(existsSync(path.join(site.root, '.nx/version-plans/one.md'))).toBe(false);
    expect(existsSync(path.join(site.root, 'packages/one/PUBLISHED'))).toBe(false);
    const released = site.git('rev-parse', 'HEAD');
    const rerun = site.ship('--projects=@test/one');
    expect(rerun.status).toBe(0);
    expect(site.git('rev-parse', 'HEAD')).toBe(released);
    expect(site.git('rev-parse', 'origin/main')).toBe(released);
    expect(site.git('status', '--porcelain')).toBe('');
}, 120000);

it('previews planned changes without consuming plans or changing files, commits, or tags', () => {
    const site = fixture();
    const result = site.ship('--projects=@test/one', '--dry-run');
    expect(result.status).toBe(0);
    expect(site.git('status', '--porcelain')).toBe('');
    expect(site.git('rev-parse', 'HEAD')).toBe(site.initial);
    expect(site.git('rev-parse', 'origin/main')).toBe(site.initial);
    expect(site.git('tag', '--list', '@test/one@1.0.1')).toBe('');
    expect(existsSync(path.join(site.root, '.nx/version-plans/one.md'))).toBe(true);
}, 120000);

it('prepares an isolated prerelease while retaining stable release plans', () => {
    const site = fixture();
    const plan = site.read('.nx/version-plans/one.md');
    const result = site.ship('1.0.1-pr.42.1', '--projects=@test/one');
    expect(result.status).toBe(0);
    expect(JSON.parse(site.read('packages/one/package.json')).version).toBe('1.0.1-pr.42.1');
    expect(site.read('.nx/version-plans/one.md')).toBe(plan);
    expect(site.git('rev-parse', '@test/one@1.0.1-pr.42.1^{}')).toBe(site.git('rev-parse', 'HEAD'));
    expect(existsSync(path.join(site.root, 'packages/one/CHANGELOG.md'))).toBe(false);
}, 120000);

it('leaves unrelated package plans available for their next release', () => {
    const site = fixture({one: {'@test/one': 'patch'}, two: {'@test/two': 'minor'}});
    const result = site.ship('--projects=@test/one');
    expect(result.status).toBe(0);
    expect(JSON.parse(site.read('packages/two/package.json')).version).toBe('1.0.0');
    expect(existsSync(path.join(site.root, '.nx/version-plans/two.md'))).toBe(true);
    expect(existsSync(path.join(site.root, 'packages/two/CHANGELOG.md'))).toBe(false);
}, 120000);

it('rejects partial release of a shared plan before changing anything', () => {
    const site = fixture({shared: {'@test/one': 'patch', '@test/two': 'minor'}});
    const result = site.ship('--projects=@test/one');
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('not included in the release filter');
    expect(site.git('status', '--porcelain')).toBe('');
    expect(site.git('rev-parse', 'HEAD')).toBe(site.initial);
    expect(site.git('rev-parse', 'origin/main')).toBe(site.initial);
}, 120000);

it('does nothing when no package has a pending plan', () => {
    const site = fixture({}, false, {GHOST_UPSTREAM: undefined});
    const result = site.ship();
    expect(result.status).toBe(0);
    expect(site.git('status', '--porcelain')).toBe('');
    expect(site.git('rev-parse', 'HEAD')).toBe(site.initial);
    expect(site.git('rev-parse', 'origin/main')).toBe(site.initial);
}, 120000);

it('keeps explicit stable releases available when no plans are pending', () => {
    const site = fixture({});
    const result = site.ship('patch', '--projects=@test/one');
    expect(result.status).toBe(0);
    expect(JSON.parse(site.read('packages/one/package.json')).version).toBe('1.0.1');
    expect(site.read('packages/one/CHANGELOG.md')).toContain('1.0.1');
}, 120000);

it('pushes to the requested remote and supports verbose release previews', () => {
    const site = fixture();
    site.git('remote', 'rename', 'origin', 'upstream');
    const result = site.ship('--projects=@test/one', '--git-remote=upstream', '--verbose');
    expect(result.status).toBe(0);
    expect(site.git('rev-parse', 'upstream/main')).toBe(site.git('rev-parse', 'HEAD'));
}, 120000);

it.each([
    ['--skip-publish=false'],
    ['--yes'],
    ['--projects='],
    ['--git-remote=--mirror'],
    ['not-a-version'],
    ['patch', 'minor']
])(
    'rejects unsafe or invalid arguments before changing release files: %s',
    (...args) => {
        const site = fixture();
        const result = site.ship(...args);
        expect(result.status).not.toBe(0);
        expect(site.git('status', '--porcelain')).toBe('');
        expect(site.git('rev-parse', 'HEAD')).toBe(site.initial);
        expect(site.git('rev-parse', 'origin/main')).toBe(site.initial);
    },
    120000
);

it('requires a version plan for package code changes while allowing documentation-only changes', () => {
    const site = fixture({});
    const check = () =>
        spawnSync(
            process.execPath,
            [
                path.join(repository, 'node_modules/nx/dist/bin/nx.js'),
                'release',
                'plan:check',
                `--base=${site.initial}`,
                '--head=HEAD'
            ],
            {
                cwd: site.root,
                encoding: 'utf8',
                timeout: 90000,
                env: {
                    ...process.env,
                    NX_DAEMON: 'false',
                    NX_ISOLATE_PLUGINS: 'false',
                    NX_WORKSPACE_ROOT_PATH: site.root,
                    NX_INTERACTIVE: 'false',
                    CI: 'true'
                }
            }
        );
    writeFileSync(path.join(site.root, 'packages/one/README.md'), 'Run the search importer.\n');
    site.git('add', '.');
    site.git('commit', '-m', 'Documented usage');
    const docs = check();
    expect(docs.status).toBe(0);
    mkdirSync(path.join(site.root, 'packages/one/test'), {recursive: true});
    writeFileSync(
        path.join(site.root, 'packages/one/test/search.test.js'),
        'export const expected = true;\n'
    );
    site.git('add', '.');
    site.git('commit', '-m', 'Checked existing search');
    const tests = check();
    expect(tests.status).toBe(0);
    writeFileSync(path.join(site.root, 'packages/one/index.js'), 'export const updated = true;\n');
    site.git('add', '.');
    site.git('commit', '-m', 'Updated search');
    const missing = check();
    expect(missing.status).not.toBe(0);
    mkdirSync(path.join(site.root, '.nx/version-plans'), {recursive: true});
    writeFileSync(
        path.join(site.root, '.nx/version-plans/one.md'),
        "---\n'@test/one': patch\n---\n\nUpdated search records.\n"
    );
    site.git('add', '.');
    site.git('commit', '-m', 'Added release plan');
    const planned = check();
    expect(planned.status).toBe(0);
}, 120000);

it('includes dependent package versions and changelogs when Nx expands the release scope', () => {
    const site = fixture({one: {'@test/one': 'patch'}}, true);
    const result = site.ship('--projects=@test/one');
    expect(result.status).toBe(0);
    expect(JSON.parse(site.read('packages/two/package.json')).version).toBe('1.0.1');
    expect(site.read('packages/two/CHANGELOG.md')).toContain('1.0.1');
    expect(site.git('rev-parse', '@test/two@1.0.1^{}')).toBe(site.git('rev-parse', 'HEAD'));
}, 120000);

it('rejects explicit stable bumps while plans are pending', () => {
    const site = fixture();
    const result = site.ship('patch', '--projects=@test/two');
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('specifier option cannot be provided');
    expect(site.git('status', '--porcelain')).toBe('');
    expect(site.git('rev-parse', 'HEAD')).toBe(site.initial);
}, 120000);

it('keeps a rejected push recoverable without preparing another release', () => {
    const site = fixture();
    const hook = path.join(site.remote, 'hooks/pre-receive');
    writeFileSync(hook, '#!/bin/sh\nexit 1\n');
    chmodSync(hook, 0o755);
    const result = site.ship('--projects=@test/one');
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('commit and tags are ready locally');
    expect(result.output).toContain('git push --atomic --follow-tags');
    const prepared = site.git('rev-parse', 'HEAD');
    expect(prepared).not.toBe(site.initial);
    expect(site.git('rev-parse', 'origin/main')).toBe(site.initial);
    expect(site.git('status', '--porcelain')).toBe('');
    rmSync(hook);
    site.git('push', '--atomic', '--follow-tags', 'origin');
    expect(site.git('rev-parse', 'origin/main')).toBe(prepared);
    expect(site.git('rev-list', '--count', `${site.initial}..HEAD`)).toBe('1');
    expect(JSON.parse(site.read('packages/one/package.json')).version).toBe('1.0.1');
}, 120000);

it('uses the upstream remote configured in the environment', () => {
    const site = fixture(undefined, false, {GHOST_UPSTREAM: 'upstream'});
    site.git('remote', 'rename', 'origin', 'upstream');
    const result = site.ship('--projects=@test/one');
    expect(result.status).toBe(0);
    expect(site.git('rev-parse', 'upstream/main')).toBe(site.git('rev-parse', 'HEAD'));
}, 120000);

it('keeps the prepared release local when tests fail after versioning', () => {
    const site = fixture(undefined, false, {FAIL_VERSIONED_TEST: 'true'});
    const result = site.ship('--projects=@test/one');
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('Versioned package verification failed');
    expect(result.output).toContain('Do not run pnpm ship again');
    expect(JSON.parse(site.read('packages/one/package.json')).version).toBe('1.0.1');
    expect(site.git('rev-parse', 'origin/main')).toBe(site.initial);
    expect(site.git('ls-remote', '--tags', 'origin', '@test/one@1.0.1')).toBe('');
    expect(site.git('rev-parse', '@test/one@1.0.1^{}')).toBe(site.git('rev-parse', 'HEAD'));
}, 120000);
