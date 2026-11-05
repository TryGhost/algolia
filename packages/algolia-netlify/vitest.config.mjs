import {configDefaults, defineConfig} from 'vitest/config';

// This file deletes packages/algolia-html-extractor/dist to simulate a fresh Netlify
// clone, and the other acceptance tests in this package import the extractor through
// the fragmenter or pack it, so the deletion window must never overlap them.
const deployBuildSimulationFile = 'test/function-tracing.acceptance.test.mjs';

export default defineConfig({
    test: {
        projects: [
            {
                extends: true,
                test: {
                    name: 'netlify',
                    sequence: {groupOrder: 0},
                    include: ['test/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}'],
                    exclude: [...configDefaults.exclude, deployBuildSimulationFile]
                }
            },
            {
                extends: true,
                test: {
                    name: 'deploy-build-simulation',
                    sequence: {groupOrder: 1},
                    include: [deployBuildSimulationFile]
                }
            }
        ]
    }
});
