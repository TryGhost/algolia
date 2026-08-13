import {defineConfig} from 'vitest/config';

export default defineConfig({
    test: {
        coverage: {
            provider: 'custom',
            customProviderModule: './test/coverage-provider.mjs',
            reporter: ['text', 'json-summary', 'lcov'],
            thresholds: {
                statements: 93,
                branches: 90,
                functions: 96,
                lines: 93
            },
            include: [
                'packages/*/index.js',
                'packages/*/lib/**/*.js',
                'packages/algolia/bin/**/*.js',
                'packages/algolia-netlify/functions/**/*.{ts,mts}'
            ],
            exclude: [
                '**/test/**',
                '**/tests/**',
                '**/fixtures/**',
                '**/build/**',
                '**/coverage/**',
                '**/*.config.{js,mjs,cjs}',
                '**/.eslintrc.js'
            ]
        }
    }
});
