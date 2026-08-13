import {defineConfig} from 'vitest/config';

export default defineConfig({
    test: {
        coverage: {
            provider: 'custom',
            customProviderModule: './test/coverage-provider.mjs',
            reporter: ['text', 'json-summary', 'lcov'],
            include: [
                'packages/*/index.js',
                'packages/*/lib/**/*.js',
                'packages/algolia/bin/**/*.js',
                'packages/algolia-netlify/functions/**/*.js'
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
