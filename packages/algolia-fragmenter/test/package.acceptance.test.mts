import {execFile} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

import {afterEach, describe, expect, it} from 'vitest';

const execFileAsync = promisify(execFile);
const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceDirectory = path.resolve(packageDirectory, '../..');
const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(
        temporaryDirectories
            .splice(0)
            .map(directory => rm(directory, {recursive: true, force: true}))
    );
});

const packPackage = async (
    name: string,
    destination: string
): Promise<{filename: string; files: Array<{path: string}>}> => {
    const result = await execFileAsync(
        'pnpm',
        ['--filter', name, 'pack', '--json', '--pack-destination', destination],
        {cwd: workspaceDirectory}
    );
    return JSON.parse(result.stdout) as {filename: string; files: Array<{path: string}>};
};

describe('@tryghost/algolia-fragmenter packed artifact', () => {
    it('ships an ESM-only runtime with strict TypeScript declarations', async () => {
        const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'algolia-fragmenter-'));
        temporaryDirectories.push(temporaryDirectory);

        const packedExtractor = await packPackage(
            '@tryghost/algolia-html-extractor',
            temporaryDirectory
        );
        const packedFragmenter = await packPackage(
            '@tryghost/algolia-fragmenter',
            temporaryDirectory
        );
        await writeFile(
            path.join(temporaryDirectory, 'package.json'),
            JSON.stringify({
                private: true,
                dependencies: {
                    '@tryghost/algolia-fragmenter': `file:./${path.basename(packedFragmenter.filename)}`
                }
            })
        );
        await writeFile(
            path.join(temporaryDirectory, 'pnpm-workspace.yaml'),
            `packages: []\noverrides:\n  '@tryghost/algolia-html-extractor': 'file:./${path.basename(packedExtractor.filename)}'\n`
        );
        await execFileAsync('pnpm', [
            '--dir',
            temporaryDirectory,
            'install',
            '--offline',
            '--ignore-scripts'
        ]);

        const installedPackage = path.join(
            temporaryDirectory,
            'node_modules/@tryghost/algolia-fragmenter'
        );
        const manifest = JSON.parse(
            await readFile(path.join(installedPackage, 'package.json'), 'utf8')
        ) as {
            dependencies: Record<string, string>;
            type: string;
            types: string;
            exports: unknown;
            main?: unknown;
            module?: unknown;
        };
        expect(manifest.dependencies).toEqual({
            '@tryghost/algolia-html-extractor': '^0.1.0'
        });
        expect(manifest.type).toBe('module');
        expect(manifest.main).toBeUndefined();
        expect(manifest.module).toBeUndefined();
        expect({types: manifest.types, exports: manifest.exports}).toEqual({
            types: './lib/index.d.mts',
            exports: {
                '.': {
                    types: './lib/index.d.mts',
                    import: './lib/index.mjs'
                }
            }
        });
        expect(packedFragmenter.files.map(file => file.path).sort()).toEqual([
            'LICENSE',
            'README.md',
            'lib/index.d.mts',
            'lib/index.d.mts.map',
            'lib/index.mjs',
            'lib/index.mjs.map',
            'package.json'
        ]);

        const runtimeInput = {
            id: 'packed',
            slug: 'packed',
            url: 'https://fixture.invalid/packed/',
            html: '<h2 id="packed-heading">Packed</h2><p>Ready.</p>',
            feature_image: null,
            title: 'Packed consumer',
            tags: [],
            authors: []
        };
        const esmConsumer = path.join(temporaryDirectory, 'consumer.mjs');
        await writeFile(
            esmConsumer,
            `
                import * as fragmenter from '@tryghost/algolia-fragmenter';
                import transforms from '@tryghost/algolia-fragmenter';
                import {
                    fragmentTransformer,
                    transformToAlgoliaObject
                } from '@tryghost/algolia-fragmenter';
                const records = transformToAlgoliaObject([${JSON.stringify(runtimeInput)}])
                    .reduce(fragmentTransformer, []);
                console.log(JSON.stringify({
                    exports: Object.keys(fragmenter).sort(),
                    defaultExports: Object.keys(transforms).sort(),
                    records,
                    synchronous: !(records instanceof Promise)
                }));
            `
        );

        const esmResult = await execFileAsync(process.execPath, [esmConsumer], {
            cwd: temporaryDirectory
        });
        const expectedRecords = [
            {
                objectID: 'packed_0',
                slug: 'packed',
                url: 'https://fixture.invalid/packed/#packed-heading',
                html: '<p>Ready.</p>',
                image: null,
                title: 'Packed consumer',
                tags: [],
                authors: [],
                headings: ['Packed'],
                anchor: 'packed-heading',
                customRanking: {position: 0, heading: 80}
            }
        ];
        expect(JSON.parse(esmResult.stdout)).toEqual({
            exports: ['default', 'fragmentTransformer', 'transformToAlgoliaObject'],
            defaultExports: ['fragmentTransformer', 'transformToAlgoliaObject'],
            records: expectedRecords,
            synchronous: true
        });

        const commonJsConsumer = path.join(temporaryDirectory, 'consumer.cjs');
        await writeFile(commonJsConsumer, `require('@tryghost/algolia-fragmenter');\n`);
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
                import fragmenter from '@tryghost/algolia-fragmenter';
                import {
                    fragmentTransformer,
                    transformToAlgoliaObject
                } from '@tryghost/algolia-fragmenter';
                const transformed = transformToAlgoliaObject([${JSON.stringify(runtimeInput)}]);
                transformed.reduce(fragmentTransformer, []);
                fragmenter.transformToAlgoliaObject([]).reduce(fragmenter.fragmentTransformer, []);
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
            sources: string[];
            sourcesContent?: string[];
        };
        for (const mapName of ['index.mjs.map', 'index.d.mts.map']) {
            const sourceMap = JSON.parse(
                await readFile(path.join(installedPackage, 'lib', mapName), 'utf8')
            ) as SourceMap;
            expect(sourceMap.sources).toEqual(['../src/index.mts']);
            expect(sourceMap.sourcesContent?.join('\n') ?? '').not.toContain(workspaceDirectory);
        }

        const declarations = await readFile(path.join(installedPackage, 'lib/index.d.mts'), 'utf8');
        expect(declarations.match(/@deprecated/g)).toHaveLength(2);
    }, 30000);
});
