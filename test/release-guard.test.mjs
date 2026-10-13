import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

const workspaceDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('Release guard', () => {
    it('keeps routine release aliases scoped through Nx configuration', async () => {
        const manifest = JSON.parse(
            await readFile(path.join(workspaceDirectory, 'package.json'), 'utf8')
        );
        const nxConfiguration = JSON.parse(
            await readFile(path.join(workspaceDirectory, 'nx.json'), 'utf8')
        );

        expect(manifest.scripts['ship:patch']).toBe('pnpm ship patch');
        expect(manifest.scripts['ship:minor']).toBe('pnpm ship minor');
        expect(manifest.scripts['ship:major']).toBe('pnpm ship major');
        expect(nxConfiguration.release.projects).toEqual(['packages/*']);
    });

    it('builds and scans every package before publishing unpublished versions', async () => {
        const workflow = await readFile(
            path.join(workspaceDirectory, '.github/workflows/publish.yml'),
            'utf8'
        );
        const verifyNpm = workflow.indexOf('- name: Verify npm supports trusted publishing');
        const install = workflow.indexOf('- name: Install dependencies');
        const preflight = workflow.indexOf('- name: Run release preflight');
        const build = workflow.indexOf('- name: Build releasable packages');
        const configureRegistry = workflow.indexOf('- name: Configure npm registry');
        const determinePackages = workflow.indexOf('- name: Determine packages to publish');
        const packageScan = workflow.indexOf(
            'for manifest in packages/*/package.json; do',
            determinePackages
        );
        const exactVersionLookup = workflow.indexOf(
            'npm view "$name@$version" version',
            packageScan
        );
        const publishPackages = workflow.indexOf('- name: Publish to npm', determinePackages);
        const buildBlock = workflow.slice(build, configureRegistry);
        const registryBlock = workflow.slice(configureRegistry, determinePackages);
        const publishBlock = workflow.slice(publishPackages);

        expect(workflow).toContain('persist-credentials: false');
        expect(workflow).not.toContain('fetch-depth: 2');
        expect(workflow).not.toContain('GITHUB_SHA');
        expect(workflow).not.toContain('expected_package_names');
        expect(workflow).not.toContain('first-release checkpoint');
        expect(workflow).not.toContain('- name: Validate package artifacts');
        expect(workflow).not.toContain('prepack');
        expect(verifyNpm).toBeGreaterThan(-1);
        expect(install).toBeGreaterThan(verifyNpm);
        expect(preflight).toBeGreaterThan(install);
        expect(build).toBeGreaterThan(preflight);
        expect(buildBlock).toContain('run: pnpm nx run-many -t build');
        expect(configureRegistry).toBeGreaterThan(build);
        expect(registryBlock).toContain('registry=https://registry.npmjs.org/');
        expect(registryBlock).toContain('@tryghost:registry=https://registry.npmjs.org/');
        expect(determinePackages).toBeGreaterThan(configureRegistry);
        expect(packageScan).toBeGreaterThan(determinePackages);
        expect(exactVersionLookup).toBeGreaterThan(packageScan);
        expect(workflow).toContain('to_publish+=("$name")');
        expect(publishPackages).toBeGreaterThan(exactVersionLookup);
        expect(publishBlock).toContain("if: steps.packages.outputs.projects != ''");
        expect(publishBlock).toContain('PROJECTS: ${{ steps.packages.outputs.projects }}');
        expect(publishBlock).toContain(
            "DRY_RUN: ${{ github.event_name == 'workflow_dispatch' && inputs['dry-run'] || false }}"
        );
        expect(publishBlock).toContain('args=(release publish "--projects=$PROJECTS")');
        expect(publishBlock).toContain('args+=(--dry-run)');
        expect(publishBlock).toContain('pnpm nx "${args[@]}"');
    });
    it('promotes Netlify releases only after successful non-dry-run npm publication', async () => {
        const workflow = await readFile(
            path.join(workspaceDirectory, '.github/workflows/publish.yml'),
            'utf8'
        );
        const promotion = workflow.slice(workflow.indexOf('  promote-netlify:'));
        expect(promotion).toContain('needs: publish');
        expect(promotion).toContain(
            "github.event_name != 'workflow_dispatch' || !inputs['dry-run']"
        );
        expect(promotion).toContain('contents: write');
        expect(promotion).not.toContain('id-token: write');
        expect(promotion).toContain('fetch-depth: 0');
        expect(promotion).toContain('persist-credentials: false');
        expect(promotion).toContain('GH_TOKEN: ${{ github.token }}');
        expect(promotion).toContain('run: node scripts/promote-netlify-release.mts');
        expect(workflow.slice(0, workflow.indexOf('  promote-netlify:'))).toContain(
            'contents: read'
        );
    });
    it('isolates branch prereleases and validates every queued version before publishing', async () => {
        const workflow = await readFile(
            path.join(workspaceDirectory, '.github/workflows/publish.yml'),
            'utf8'
        );
        expect(workflow).toContain('prerelease-tag:');
        expect(workflow).toContain(
            "github.event_name == 'workflow_dispatch' && inputs['prerelease-tag'] != ''"
        );
        expect(workflow).toContain(
            "PRERELEASE_TAG: ${{ github.event_name == 'workflow_dispatch' && inputs['prerelease-tag'] || '' }}"
        );
        const channelValidation = workflow.indexOf('run: node scripts/release-channel.mts');
        const packageValidation = workflow.indexOf('node scripts/release-channel.mts "$version"');
        const queue = workflow.indexOf('to_publish+=("$name")');
        const publish = workflow.indexOf('pnpm nx "${args[@]}"');
        expect(channelValidation).toBeGreaterThan(-1);
        expect(packageValidation).toBeGreaterThan(channelValidation);
        expect(queue).toBeGreaterThan(packageValidation);
        expect(workflow).toContain(
            'elif grep -q \'E404\' "$registry_error"; then\n              node scripts/release-channel.mts "$version"'
        );
        expect(publish).toBeGreaterThan(queue);
        expect(workflow).toContain('args+=("--tag=$PRERELEASE_TAG")');
    });
});
