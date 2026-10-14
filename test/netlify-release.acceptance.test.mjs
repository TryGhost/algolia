import {execFile} from 'node:child_process';
import {chmod, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

import {afterEach, describe, expect, it} from 'vitest';

const exec = promisify(execFile);
const script = fileURLToPath(new URL('../scripts/promote-netlify-release.mts', import.meta.url));
const channelScript = fileURLToPath(new URL('../scripts/release-channel.mts', import.meta.url));
const commit = '1234567890abcdef1234567890abcdef12345678';
const version = '0.4.7';
const tag = `@tryghost/algolia-netlify@${version}`;
const directories = [];

const externalCommands = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const statePath = process.env.RELEASE_TEST_STATE;
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
state.calls.push({command, args});
const save = () => fs.writeFileSync(statePath, JSON.stringify(state));
const fail = message => { save(); process.stderr.write(message); process.exit(1); };
let result;
if (command === 'git') {
    result = args.some(arg => arg.startsWith('refs/tags/')) ? state.tagCommit : state.commit;
} else if (command === 'npm') {
    if (state.npmFailure) fail('Registry request failed');
    result = JSON.stringify(state.version);
} else if (args[0] === 'api') {
    if (state.githubFailure) fail('gh: Service unavailable (HTTP 503)');
    if (args[1].includes('/releases/assets/')) {
        result = JSON.stringify(state.asset);
    } else {
        result = JSON.stringify(state.pages ?? (state.release ? [[state.release]] : [[]]));
    }
} else if (args[0] === 'release' && args[1] === 'create') {
    state.release = {body: args.includes('--notes-file') ? fs.readFileSync(args[args.indexOf('--notes-file') + 1], 'utf8') : args[args.indexOf('--notes') + 1], id: 1, tag_name: state.tag, draft: true, prerelease: args.includes('--prerelease'), target_commitish: state.commit, assets: []};
} else if (args[0] === 'release' && args[1] === 'upload') {
    if (state.uploadFailure) { state.uploadFailure = false; fail('Asset upload failed'); }
    state.asset = JSON.parse(fs.readFileSync(args[3], 'utf8'));
    state.release.assets = [{id: 2, name: 'netlify-release.json'}];
} else if (args[0] === 'release' && args[1] === 'edit') {
    if (args.includes('--notes-file')) state.release.body = fs.readFileSync(args[args.indexOf('--notes-file') + 1], 'utf8');
    state.release.draft = false;
} else {
    fail('Unexpected external command: ' + command + ' ' + args.join(' '));
}
save();
if (result !== undefined) process.stdout.write(result);
`;

const createRelease = async (overrides = {}) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'algolia-release-'));
    directories.push(directory);
    const bin = path.join(directory, 'bin');
    await mkdir(bin);
    await mkdir(path.join(directory, 'packages/algolia-netlify'), {recursive: true});
    await writeFile(
        path.join(directory, 'packages/algolia-netlify/package.json'),
        JSON.stringify({
            name: '@tryghost/algolia-netlify',
            version: overrides.manifestVersion ?? version
        })
    );
    if (overrides.changelog !== null) {
        await writeFile(
            path.join(directory, 'packages/algolia-netlify/CHANGELOG.md'),
            overrides.changelog ??
                `## ${overrides.manifestVersion ?? version} (2026-10-14)\n\n### Fixes\n\n- Preserved existing webhook configuration.\n\n## 0.4.6 (2026-10-01)\n\n- Previous release.\n`
        );
    }
    for (const command of ['gh', 'git', 'npm']) {
        const filename = path.join(bin, command);
        await writeFile(filename, externalCommands);
        await chmod(filename, 0o755);
    }
    const stateFile = path.join(directory, 'state.json');
    await writeFile(
        stateFile,
        JSON.stringify({commit, tagCommit: commit, version, tag, calls: [], ...overrides})
    );
    return {
        run: () =>
            exec(process.execPath, [script], {
                cwd: directory,
                env: {
                    ...process.env,
                    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
                    GITHUB_SHA: commit,
                    PRERELEASE_TAG: overrides.prereleaseTag ?? '',
                    GITHUB_REPOSITORY: 'TryGhost/algolia',
                    RELEASE_TEST_STATE: stateFile
                }
            }),
        state: async () => JSON.parse(await readFile(stateFile, 'utf8'))
    };
};

afterEach(async () => {
    await Promise.all(
        directories.splice(0).map(directory => rm(directory, {recursive: true, force: true}))
    );
});

describe('Netlify release promotion command', () => {
    it('uses only the matching package changelog entry as release notes', async () => {
        const release = await createRelease();
        await release.run();
        expect((await release.state()).release.body).toBe(
            '### Fixes\n\n- Preserved existing webhook configuration.\n'
        );
    });
    it('refreshes an unpublished draft from the matching changelog entry', async () => {
        const release = await createRelease({
            release: {
                tag_name: tag,
                draft: true,
                prerelease: false,
                body: 'Old draft notes',
                assets: []
            }
        });
        await release.run();
        expect((await release.state()).release.body).toBe(
            '### Fixes\n\n- Preserved existing webhook configuration.\n'
        );
    });
    it('keeps major release notes separate from older minor releases', async () => {
        const release = await createRelease({
            manifestVersion: '1.0.0',
            version: '1.0.0',
            tag: '@tryghost/algolia-netlify@1.0.0',
            changelog:
                '# 1.0.0 (2026-10-14)\n\n### Features\n\n- New setup.\n\n## 0.4.7 (2026-10-01)\n\n- Previous release.\n'
        });
        await release.run();
        expect((await release.state()).release.body).toBe('### Features\n\n- New setup.\n');
    });
    it.each([null, '## 0.4.7 (2026-10-14)\n\n- Stable notes.\n'])(
        'promotes isolated candidates without a generated changelog entry',
        async changelog => {
            const candidate = '0.4.7-pr.333.1';
            const release = await createRelease({
                manifestVersion: candidate,
                version: candidate,
                tag: `@tryghost/algolia-netlify@${candidate}`,
                prereleaseTag: 'pr-333',
                changelog
            });
            await release.run();
            expect((await release.state()).release.body).toBe(
                `Deploys @tryghost/algolia-netlify@${candidate} from commit ${commit}.\n`
            );
        }
    );
    it.each([
        null,
        '## 0.4.70 (2026-10-14)\n\n- Different version.\n',
        '## 0.4.7-pr.333.1 (2026-10-14)\n\n- Candidate only.\n',
        '## 0.4.7 (2026-10-14)\n'
    ])('does not publish a stable release without its notes', async changelog => {
        const release = await createRelease({changelog});
        await expect(release.run()).rejects.toThrow(/CHANGELOG|changelog/);
        expect((await release.state()).calls.some(call => call.args[0] === 'release')).toBe(false);
    });
    it.each(['Migration', '0.4.6'])(
        'preserves authored heading %s inside the released notes',
        async heading => {
            const release = await createRelease({
                changelog: `## 0.4.7 (2026-10-14)\n\n## ${heading}\n\nKeep the existing index.\n\n## 0.4.6 (2026-10-01)\n\n- Previous release.\n`
            });
            await release.run();
            expect((await release.state()).release.body).toBe(
                `## ${heading}\n\nKeep the existing index.\n`
            );
        }
    );
    it('publishes a source manifest only after verifying the npm version and release tag', async () => {
        const release = await createRelease();
        await release.run();
        const state = await release.state();
        expect(state.asset).toEqual({
            version: '0.4.7',
            commit: '1234567890abcdef1234567890abcdef12345678'
        });
        expect(state.release.draft).toBe(false);
        expect(state.calls.map(call => call.command)).toEqual([
            'git',
            'git',
            'npm',
            'gh',
            'gh',
            'gh',
            'gh'
        ]);
        expect(
            state.calls.filter(call => call.command === 'gh').map(call => call.args.slice(0, 2))
        ).toEqual([
            ['api', 'repos/TryGhost/algolia/releases?per_page=100'],
            ['release', 'create'],
            ['release', 'upload'],
            ['release', 'edit']
        ]);
    });
    it('leaves an already published matching release unchanged on a rerun', async () => {
        const release = await createRelease({
            changelog: null,
            release: {
                id: 1,
                tag_name: tag,
                draft: false,
                prerelease: false,
                target_commitish: commit,
                assets: [{id: 2, name: 'netlify-release.json'}]
            },
            asset: {version, commit}
        });
        await release.run();
        const state = await release.state();
        expect(state.asset).toEqual({version, commit});
        expect(
            state.calls.filter(call => call.command === 'gh').every(call => call.args[0] === 'api')
        ).toBe(true);
    });

    it('skips the unchanged Netlify version when another package ships', async () => {
        const release = await createRelease({
            tagCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
        });
        await release.run();
        const state = await release.state();
        expect(state.release).toBeUndefined();
        expect(state.calls.map(call => call.command)).toEqual(['git', 'git']);
    });

    it.each([
        {draft: false, prerelease: true, target_commitish: commit},
        {draft: 'unknown', prerelease: false}
    ])('rejects a release with conflicting identity: %j', async identity => {
        const release = await createRelease({
            release: {
                id: 1,
                tag_name: tag,
                ...identity,
                assets: [{id: 2, name: 'netlify-release.json'}]
            },
            asset: {version, commit}
        });
        await expect(release.run()).rejects.toThrow('existing GitHub release');
        expect((await release.state()).calls.some(call => call.args[0] === 'release')).toBe(false);
    });

    it.each(['0.4.7-beta.1', 'latest', '01.2.3'])(
        'rejects unsupported package version %s before external calls',
        async manifestVersion => {
            const release = await createRelease({manifestVersion});
            await expect(release.run()).rejects.toThrow('stable package version');
            expect((await release.state()).calls).toEqual([]);
        }
    );

    it.each([
        [{npmFailure: true}, 'Registry request failed'],
        [{version: '0.4.6'}, 'not published on npm'],
        [{githubFailure: true}, 'Service unavailable'],
        [{commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'}, 'checkout does not match'],
        [
            {release: {id: 1, tag_name: tag, draft: false, prerelease: false, assets: []}},
            'has no source manifest'
        ],
        [
            {
                release: {
                    id: 1,
                    tag_name: tag,
                    draft: false,
                    prerelease: false,
                    assets: [{id: 2, name: 'netlify-release.json'}]
                },
                asset: {version, commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'}
            },
            'manifest conflicts'
        ]
    ])('does not promote after a failed prerequisite: %j', async (overrides, message) => {
        const release = await createRelease(overrides);
        await expect(release.run()).rejects.toThrow(message);
        expect((await release.state()).calls.some(call => call.args[0] === 'release')).toBe(false);
    });

    it.each([false, true])(
        'resumes an unpublished draft safely (manifest uploaded: %s)',
        async uploaded => {
            const release = await createRelease({
                release: {
                    id: 1,
                    tag_name: tag,
                    draft: true,
                    prerelease: false,
                    assets: uploaded ? [{id: 2, name: 'netlify-release.json'}] : []
                },
                asset: uploaded ? {version, commit} : undefined
            });
            await release.run();
            const state = await release.state();
            expect(state.release.draft).toBe(false);
            expect(state.asset).toEqual({version, commit});
            expect(
                state.calls.filter(call => call.args[0] === 'release').map(call => call.args[1])
            ).toEqual(uploaded ? ['edit'] : ['upload', 'edit']);
        }
    );
    it('reuses the draft after an asset upload failure', async () => {
        const release = await createRelease({uploadFailure: true});
        await expect(release.run()).rejects.toThrow('Asset upload failed');
        const failed = await release.state();
        expect(failed.release.draft).toBe(true);
        expect(
            failed.calls.some(call => call.args[0] === 'release' && call.args[1] === 'edit')
        ).toBe(false);
        await release.run();
        const retried = await release.state();
        expect(retried.release.draft).toBe(false);
        expect(retried.asset).toEqual({version, commit});
        expect(
            retried.calls.filter(call => call.args[0] === 'release' && call.args[1] === 'create')
        ).toHaveLength(1);
    });

    it('rejects duplicate release identities without modifying either release', async () => {
        const identity = {tag_name: tag, draft: false, prerelease: false, assets: []};
        const release = await createRelease({pages: [[identity], [identity]]});
        await expect(release.run()).rejects.toThrow('Multiple GitHub releases');
        expect((await release.state()).calls.some(call => call.args[0] === 'release')).toBe(false);
    });
    it('promotes a matching isolated PR candidate as a GitHub prerelease', async () => {
        const candidate = '0.4.7-pr.333.1';
        const release = await createRelease({
            version: candidate,
            manifestVersion: candidate,
            tag: `@tryghost/algolia-netlify@${candidate}`,
            prereleaseTag: 'pr-333'
        });
        await release.run();
        const state = await release.state();
        expect(state.asset).toEqual({version: candidate, commit});
        expect(state.release.draft).toBe(false);
        expect(state.release.prerelease).toBe(true);
        expect(
            state.calls.find(call => call.args[0] === 'release' && call.args[1] === 'create').args
        ).toContain('--prerelease');
    });

    it.each([
        ['latest', '0.4.7-pr.333.1'],
        ['pr-0', '0.4.7-pr.0.1'],
        ['pr-333', '0.4.7'],
        ['pr-333', '0.4.7-pr.334.1'],
        ['pr-333', '0.4.7-beta.1'],
        ['pr-333', '0.4.7-pr.333.01'],
        ['pr-333', '0.4.7-pr.333.1-extra']
    ])(
        'rejects candidate %s / %s before external promotion calls',
        async (prereleaseTag, manifestVersion) => {
            const release = await createRelease({prereleaseTag, manifestVersion});
            await expect(release.run()).rejects.toThrow(
                /Prerelease tag|matching prerelease version|stable package version/
            );
            expect((await release.state()).calls).toEqual([]);
        }
    );

    it('reuses an already published matching prerelease without changing its channel', async () => {
        const candidate = '0.4.7-pr.333.1';
        const candidateTag = `@tryghost/algolia-netlify@${candidate}`;
        const release = await createRelease({
            version: candidate,
            manifestVersion: candidate,
            tag: candidateTag,
            prereleaseTag: 'pr-333',
            release: {
                tag_name: candidateTag,
                draft: false,
                prerelease: true,
                assets: [{id: 2, name: 'netlify-release.json'}]
            },
            asset: {version: candidate, commit}
        });
        await release.run();
        const state = await release.state();
        expect(state.release.prerelease).toBe(true);
        expect(state.calls.some(call => call.args[0] === 'release')).toBe(false);
    });
});

describe('Prerelease publication gate', () => {
    it.each(['', 'pr-333'])('accepts valid channel %s before scanning packages', async channel => {
        const result = await exec(process.execPath, [channelScript], {
            env: {...process.env, PRERELEASE_TAG: channel}
        });
        expect(result.stdout).toBe('');
    });

    it('accepts a queued package matching the explicit PR channel', async () => {
        const result = await exec(process.execPath, [channelScript, '0.4.7-pr.333.1'], {
            env: {...process.env, PRERELEASE_TAG: 'pr-333'}
        });
        expect(result.stdout).toBe('');
    });

    it.each([
        ['latest', undefined],
        ['', '0.4.7-pr.333.1'],
        ['pr-333', '0.4.7'],
        ['pr-333', '0.4.7-pr.334.1']
    ])(
        'fails channel %s and queued version %s before npm publication',
        async (channel, queuedVersion) => {
            await expect(
                exec(
                    process.execPath,
                    [channelScript, ...(queuedVersion === undefined ? [] : [queuedVersion])],
                    {env: {...process.env, PRERELEASE_TAG: channel}}
                )
            ).rejects.toThrow(/Prerelease tag|matching prerelease version|stable package version/);
        }
    );
});
