import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

const workspaceDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const establishedProjects = [
    '@tryghost/algolia',
    '@tryghost/algolia-fragmenter',
    '@tryghost/algolia-indexer',
    '@tryghost/algolia-netlify'
].join(',');

describe('HTML extractor first-release guard', () => {
    it('keeps routine release aliases scoped to established packages', async () => {
        const manifest = JSON.parse(
            await readFile(path.join(workspaceDirectory, 'package.json'), 'utf8')
        );

        expect(manifest.scripts['ship:patch']).toBe(
            `pnpm ship patch --projects=${establishedProjects}`
        );
        expect(manifest.scripts['ship:minor']).toBe(
            `pnpm ship minor --projects=${establishedProjects}`
        );
        expect(manifest.scripts['ship:major']).toBe(
            `pnpm ship major --projects=${establishedProjects}`
        );
    });

    it('skips every extractor version until the package exists on npm', async () => {
        const workflow = await readFile(
            path.join(workspaceDirectory, '.github/workflows/publish.yml'),
            'utf8'
        );
        const sentinelGuard = workflow.indexOf(
            'if [[ "$name" == "@tryghost/algolia-html-extractor" && "$version" == "0.0.0" ]]'
        );
        const extractorGuard = workflow.indexOf(
            'if [[ "$name" == "@tryghost/algolia-html-extractor" ]]; then'
        );
        const packageLookup = workflow.indexOf('npm view "$name" version', extractorGuard);
        const checkpointSkip = workflow.indexOf(
            'Skipping $name@$version until its first-release checkpoint',
            packageLookup
        );
        const versionLookup = workflow.indexOf('npm view "$name@$version" version', packageLookup);
        const sentinelGuardBlock = workflow.slice(sentinelGuard, extractorGuard);
        const extractorGuardBlock = workflow.slice(extractorGuard, versionLookup);

        expect(sentinelGuard).toBeGreaterThan(-1);
        expect(sentinelGuardBlock).toMatch(/\bcontinue\b/);
        expect(extractorGuard).toBeGreaterThan(-1);
        expect(packageLookup).toBeGreaterThan(extractorGuard);
        expect(checkpointSkip).toBeGreaterThan(packageLookup);
        expect(extractorGuardBlock).toMatch(
            /elif grep -q 'E404' "\$registry_error"; then[\s\S]*\bcontinue\b[\s\S]*else[\s\S]*\bexit 1\b/
        );
        expect(versionLookup).toBeGreaterThan(checkpointSkip);
    });

    it('limits the first-release bootstrap to the extractor prerelease', async () => {
        const workflow = await readFile(
            path.join(workspaceDirectory, '.github/workflows/publish.yml'),
            'utf8'
        );

        expect(workflow).toContain('bootstrap-html-extractor:');
        expect(workflow).toContain('environment: npm-bootstrap');
        expect(workflow).toContain("BOOTSTRAP_PACKAGE: '@tryghost/algolia-html-extractor'");
        expect(workflow).toContain("BOOTSTRAP_VERSION: '0.0.1-0'");
        expect(workflow).toMatch(
            /^\s+run: pnpm nx release publish --projects="\$BOOTSTRAP_PACKAGE" --first-release --tag=next --dry-run$/m
        );
        expect(workflow).toContain(
            'NODE_AUTH_TOKEN: ${{ secrets.NPM_HTML_EXTRACTOR_BOOTSTRAP_TOKEN }}'
        );
        expect(workflow).toMatch(
            /^\s+pnpm nx release publish --projects="\$BOOTSTRAP_PACKAGE" --first-release --tag=next$/m
        );
    });
});
