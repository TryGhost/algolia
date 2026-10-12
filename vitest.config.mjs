import {defineConfig} from 'vitest/config';

export default defineConfig({
    test: {
        // The loader also runs in native Node subprocesses. Keep the same source offsets
        // in both contexts so V8 coverage does not merge native and transformed ranges.
        server: {deps: {external: [/\/deployment\/.*\.mts$/]}},
        include: [
            'packages/*/test/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}',
            'test/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}'
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
                'packages/*/index.js',
                'packages/*/lib/**/*.js',
                'packages/algolia/bin/**/*.js',
                'packages/algolia-fragmenter/src/**/*.mts',
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
