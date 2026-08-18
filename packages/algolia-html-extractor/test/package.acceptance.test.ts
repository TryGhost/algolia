import {execFile} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

import {afterEach, describe, expect, it} from 'vitest';

const execFileAsync = promisify(execFile);
const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceDirectory = path.resolve(packageDirectory, '../..');
const temporaryDirectories: string[] = [];

const readJson = async (filePath: string): Promise<unknown> => {
    return JSON.parse(await readFile(filePath, 'utf8'));
};

afterEach(async () => {
    await Promise.all(
        temporaryDirectories
            .splice(0)
            .map(directory => rm(directory, {recursive: true, force: true}))
    );
});

describe('@tryghost/algolia-html-extractor packed package', () => {
    it('ships an ESM-only runtime with strict TypeScript declarations', async () => {
        const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'algolia-extractor-'));
        temporaryDirectories.push(temporaryDirectory);

        const packResult = await execFileAsync(
            'pnpm',
            [
                '--filter',
                '@tryghost/algolia-html-extractor',
                'pack',
                '--json',
                '--pack-destination',
                temporaryDirectory
            ],
            {cwd: workspaceDirectory}
        );
        const packed = JSON.parse(packResult.stdout) as {
            filename: string;
            files: Array<{path: string}>;
        };

        await writeFile(
            path.join(temporaryDirectory, 'package.json'),
            JSON.stringify({
                private: true,
                dependencies: {
                    '@tryghost/algolia-html-extractor': `file:./${path.basename(packed.filename)}`
                }
            })
        );
        await writeFile(path.join(temporaryDirectory, 'pnpm-workspace.yaml'), 'packages: []\n');
        await execFileAsync(
            'pnpm',
            ['--dir', temporaryDirectory, 'install', '--offline', '--ignore-scripts'],
            {cwd: workspaceDirectory}
        );

        const installedPackage = path.join(
            temporaryDirectory,
            'node_modules/@tryghost/algolia-html-extractor'
        );
        const sourceManifest = (await readJson(path.join(packageDirectory, 'package.json'))) as {
            version: string;
        };
        const manifest = (await readJson(path.join(installedPackage, 'package.json'))) as {
            version: string;
            dependencies: Record<string, string>;
            exports: unknown;
            main?: unknown;
            module?: unknown;
        };
        expect(manifest.version).toBe(sourceManifest.version);
        expect(Object.keys(manifest.dependencies)).toEqual(['parse5']);
        expect(manifest.dependencies.parse5).toMatch(/^\d+\.\d+\.\d+$/);
        expect(manifest.main).toBeUndefined();
        expect(manifest.module).toBeUndefined();
        expect(manifest.exports).toEqual({
            '.': {
                types: './dist/index.d.mts',
                import: './dist/index.mjs'
            }
        });
        expect(packed.files.map(file => file.path).sort()).toEqual([
            'LICENSE',
            'README.md',
            'dist/index.d.mts',
            'dist/index.d.mts.map',
            'dist/index.mjs',
            'dist/index.mjs.map',
            'package.json'
        ]);

        const runtimeConsumer = path.join(temporaryDirectory, 'consumer.mjs');
        await writeFile(
            runtimeConsumer,
            `
                import * as esm from '@tryghost/algolia-html-extractor';

                const input = '<h2 id="start">Start</h2><p>Ready.</p>';
                const esmResult = esm.extract(input);

                console.log(JSON.stringify({
                    esmKeys: Object.keys(esm),
                    esmResult,
                    synchronous: !(esmResult instanceof Promise)
                }));
            `
        );
        const runtimeResult = await execFileAsync(process.execPath, [runtimeConsumer], {
            cwd: temporaryDirectory
        });
        expect(JSON.parse(runtimeResult.stdout)).toEqual({
            esmKeys: ['extract'],
            esmResult: [
                {
                    html: '<p>Ready.</p>',
                    text: 'Ready.',
                    headingPath: ['Start'],
                    anchor: 'start',
                    position: 0,
                    headingRank: 80,
                    sourceTag: 'p'
                }
            ],
            synchronous: true
        });

        const commonJsConsumer = path.join(temporaryDirectory, 'consumer.cjs');
        await writeFile(commonJsConsumer, `require('@tryghost/algolia-html-extractor');\n`);
        await expect(
            execFileAsync(process.execPath, [commonJsConsumer], {cwd: temporaryDirectory})
        ).rejects.toMatchObject({
            code: 1,
            stderr: expect.stringContaining('ERR_PACKAGE_PATH_NOT_EXPORTED')
        });

        const esmTypeConsumer = path.join(temporaryDirectory, 'consumer.mts');
        await writeFile(
            esmTypeConsumer,
            `
                import {extract, type ExtractionFragment} from '@tryghost/algolia-html-extractor';
                // @ts-expect-error The package deliberately has no default export.
                import extractor from '@tryghost/algolia-html-extractor';

                const fragments: readonly ExtractionFragment[] = extract('<p>Typed.</p>');
                void fragments;
                void extractor;
            `
        );
        const tsc = path.join(packageDirectory, 'node_modules/.bin/tsc');
        await execFileAsync(
            tsc,
            [
                '--noEmit',
                '--strict',
                '--target',
                'ES2023',
                '--module',
                'NodeNext',
                '--moduleResolution',
                'NodeNext',
                esmTypeConsumer
            ],
            {cwd: temporaryDirectory}
        );

        type SourceMap = {
            file: string;
            mappings: string;
            sources: string[];
            sourcesContent?: string[];
        };
        const runtimeSourceMap = (await readJson(
            path.join(installedPackage, 'dist/index.mjs.map')
        )) as SourceMap;
        const declarationSourceMap = (await readJson(
            path.join(installedPackage, 'dist/index.d.mts.map')
        )) as SourceMap;
        for (const [mapName, sourceMap] of [
            ['index.mjs.map', runtimeSourceMap],
            ['index.d.mts.map', declarationSourceMap]
        ] as const) {
            expect(sourceMap.file).toBe(mapName.replace(/\.map$/, ''));
            expect(sourceMap.mappings).not.toBe('');
            expect(sourceMap.sources).toEqual(['../index.mts']);
        }
        expect(runtimeSourceMap.sourcesContent?.[0]).toContain('export function extract');

        expect(await readFile(path.join(installedPackage, 'dist/index.d.mts'), 'utf8')).toContain(
            'sourceMappingURL=index.d.mts.map'
        );
    }, 30_000);
});
