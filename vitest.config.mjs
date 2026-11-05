import {configDefaults, defineConfig} from 'vitest/config';

// This file deletes packages/algolia-html-extractor/dist to simulate a fresh Netlify
// clone. Every test that starts a new Node process resolves that dist through the
// fragmenter, so the deletion window must never overlap the rest of the suite.
const deployBuildSimulationFile =
    'packages/algolia-netlify/test/function-tracing.acceptance.test.mjs';

export default defineConfig({
    test: {
        // The loader also runs in native Node subprocesses. Keep the same source offsets
        // in both contexts so V8 coverage does not merge native and transformed ranges.
        server: {deps: {external: [/\/deployment\/.*\.mts$/]}},
        projects: [
            {
                extends: true,
                test: {
                    name: 'workspace',
                    sequence: {groupOrder: 0},
                    include: [
                        'packages/*/test/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}',
                        'test/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}'
                    ],
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
        ],
        coverage: {
            provider: 'v8',
            autoAttachSubprocess: true,
            reporter: ['text', 'json-summary', 'lcov'],
            thresholds: {
                statements: 93,
                branches: 90,
                functions: 96,
                lines: 93
            },
            include: [
                'deployment/*.mts',
                'scripts/*.mts',
                'packages/*/index.js',
                'packages/*/lib/**/*.js',
                'packages/algolia/bin/**/*.js',
                'packages/algolia-fragmenter/src/**/*.mts',
                'packages/algolia-indexer/dist/**/*.cjs',
                'packages/algolia-html-extractor/index.mts',
                'packages/algolia-html-extractor/smoke/live-ghost-content-smoke.mts',
                'packages/algolia-netlify/functions/**/*.{ts,mts}'
            ],
            exclude: [
                '**/test/**',
                '**/tests/**',
                '**/fixtures/**',
                '**/build/**',
                '**/coverage/**',
                '**/*.config.{js,mjs,cjs}'
            ]
        }
    }
});
