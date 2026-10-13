import {execFile} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';

import {validateReleaseVersion} from './release-channel.mts';

const exec = promisify(execFile);
const REPOSITORY = 'TryGhost/algolia';
const PACKAGE = '@tryghost/algolia-netlify';
const ASSET = 'netlify-release.json';

type Release = {
    draft: boolean;
    prerelease: boolean;
    tag_name: string;
    assets: {id: number; name: string}[];
};

const run = async (command: string, args: string[]): Promise<string> => {
    const {stdout} = await exec(command, args, {maxBuffer: 1024 * 1024});
    return stdout.trim();
};

const promote = async (): Promise<void> => {
    const manifest = JSON.parse(
        await readFile('packages/algolia-netlify/package.json', 'utf8')
    ) as {version: string};
    const {version} = manifest;
    const prerelease = validateReleaseVersion(version, process.env.PRERELEASE_TAG ?? '');
    const tag = `${PACKAGE}@${version}`;
    const commit = await run('git', ['rev-parse', 'HEAD']);
    const tagCommit = await run('git', ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`]);
    if (commit !== process.env.GITHUB_SHA) {
        throw new Error('The checkout does not match the workflow commit.');
    }
    if (tagCommit !== commit) {
        process.stdout.write(`Netlify integration ${version} is unchanged; skipping promotion.\n`);
        return;
    }
    const published: unknown = JSON.parse(
        await run('npm', [
            'view',
            `${PACKAGE}@${version}`,
            'version',
            '--json',
            '--prefer-online',
            '--registry=https://registry.npmjs.org'
        ])
    );
    if (published !== version) {
        throw new Error('The expected Netlify package version is not published on npm.');
    }
    const pages = JSON.parse(
        await run('gh', [
            'api',
            `repos/${REPOSITORY}/releases?per_page=100`,
            '--paginate',
            '--slurp'
        ])
    ) as Release[][];
    const matches = pages.flat().filter(candidate => candidate.tag_name === tag);
    if (matches.length > 1) {
        throw new Error('Multiple GitHub releases use this Netlify version.');
    }
    const release = matches[0];
    if (
        release &&
        (release.tag_name !== tag ||
            release.prerelease !== prerelease ||
            typeof release.draft !== 'boolean')
    ) {
        throw new Error('The existing GitHub release does not match this source release.');
    }
    const existingAsset = release?.assets.find(asset => asset.name === ASSET);
    if (existingAsset) {
        const contents = JSON.parse(
            await run('gh', [
                'api',
                `repos/${REPOSITORY}/releases/assets/${existingAsset.id}`,
                '-H',
                'Accept: application/octet-stream'
            ])
        ) as {version?: string; commit?: string};
        if (contents.version !== version || contents.commit !== commit) {
            throw new Error('The existing Netlify release manifest conflicts with this release.');
        }
    }
    if (release && !release.draft) {
        if (!existingAsset) {
            throw new Error('The published Netlify release has no source manifest.');
        }
        process.stdout.write(`Netlify integration ${version} is already promoted.\n`);
        return;
    }
    const directory = await mkdtemp(path.join(os.tmpdir(), 'algolia-netlify-release-'));
    try {
        const asset = path.join(directory, ASSET);
        await writeFile(asset, JSON.stringify({version, commit}, null, 2) + '\n');
        if (!release) {
            await run('gh', [
                'release',
                'create',
                tag,
                '--repo',
                REPOSITORY,
                '--verify-tag',
                '--target',
                commit,
                '--draft',
                ...(prerelease ? ['--prerelease'] : []),
                '--title',
                `Netlify integration ${version}`,
                '--notes',
                `Deploys ${PACKAGE}@${version} from commit ${commit}.`
            ]);
        }
        if (!existingAsset) {
            await run('gh', ['release', 'upload', tag, asset, '--repo', REPOSITORY]);
        }
        await run('gh', [
            'release',
            'edit',
            tag,
            '--repo',
            REPOSITORY,
            '--draft=false',
            '--latest=false'
        ]);
        process.stdout.write(`Promoted Netlify integration ${version} (${commit}).\n`);
    } finally {
        await rm(directory, {recursive: true, force: true});
    }
};

try {
    await promote();
} catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
}
