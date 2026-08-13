import {execFile} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import {promisify} from 'node:util';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {afterEach, describe, expect, it} from 'vitest';

const execFileAsync = promisify(execFile);
const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceDirectory = path.resolve(packageDirectory, '../..');
const ghostFixtureDirectory = path.resolve(packageDirectory, '../algolia/test/fixtures/ghost-v6');
const temporaryDirectories = [];

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map(directory => (
        rm(directory, {recursive: true, force: true})
    )));
});

describe('@tryghost/algolia-netlify package', () => {
    it('exports both native Request/Response handlers from its packed artifact', async () => {
        const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'algolia-netlify-package-'));
        temporaryDirectories.push(temporaryDirectory);

        const packPackage = async name => {
            const result = await execFileAsync('pnpm', [
                '--filter',
                name,
                'pack',
                '--json',
                '--pack-destination',
                temporaryDirectory
            ], {cwd: workspaceDirectory});
            return JSON.parse(result.stdout);
        };
        const [packedFragmenter, packedIndexer, packed] = await Promise.all([
            packPackage('@tryghost/algolia-fragmenter'),
            packPackage('@tryghost/algolia-indexer'),
            packPackage('@tryghost/algolia-netlify')
        ]);
        await writeFile(path.join(temporaryDirectory, 'package.json'), JSON.stringify({
            private: true,
            dependencies: {
                '@tryghost/algolia-netlify': `file:./${path.basename(packed.filename)}`
            }
        }, null, 2));
        await writeFile(path.join(temporaryDirectory, 'pnpm-workspace.yaml'), `
packages: []
overrides:
  '@tryghost/algolia-fragmenter': 'file:./${path.basename(packedFragmenter.filename)}'
  '@tryghost/algolia-indexer': 'file:./${path.basename(packedIndexer.filename)}'
        `.trimStart());
        await execFileAsync('pnpm', [
            '--dir',
            temporaryDirectory,
            'install',
            '--prefer-offline',
            '--ignore-scripts'
        ]);
        const installedPackage = path.join(temporaryDirectory, 'node_modules/@tryghost/algolia-netlify');

        const manifest = JSON.parse(await readFile(path.join(installedPackage, 'package.json'), 'utf8'));
        expect(Object.keys(manifest.dependencies).sort()).toEqual([
            '@tryghost/algolia-fragmenter',
            '@tryghost/algolia-indexer',
            'algolia-html-extractor',
            'algoliasearch'
        ]);
        expect(manifest.exports).toEqual({
            '.': {
                types: './dist/index.d.mts',
                import: './dist/index.mjs'
            },
            './post-published': {
                types: './dist/functions/post-published.d.mts',
                import: './dist/functions/post-published.mjs'
            },
            './post-unpublished': {
                types: './dist/functions/post-unpublished.d.mts',
                import: './dist/functions/post-unpublished.mjs'
            }
        });
        expect(packed.files.map(file => file.path).sort()).toEqual([
            'LICENSE',
            'README.md',
            'dist/functions/post-published.d.mts',
            'dist/functions/post-published.mjs',
            'dist/functions/post-unpublished.d.mts',
            'dist/functions/post-unpublished.mjs',
            'dist/index.d.mts',
            'dist/index.mjs',
            'package.json'
        ]);

        const postsPage = JSON.parse(await readFile(path.join(ghostFixtureDirectory, 'posts-page-1.json'), 'utf8'));
        const richPost = postsPage.posts.find(post => post.slug === 'ghost-6-rendered-content-contract');
        const requesterHelper = path.join(packageDirectory, 'test/helpers/algolia-requester-register.cjs');
        const consumer = path.join(temporaryDirectory, 'consumer.mjs');
        await writeFile(consumer, `
            import {createRequire} from 'node:module';

            const require = createRequire(import.meta.url);
            const requesterMock = require(${JSON.stringify(requesterHelper)});
            requesterMock.install();
            try {
                const [{postPublished, postUnpublished}, {default: publishedDefault}, {default: unpublishedDefault}] = await Promise.all([
                    import('@tryghost/algolia-netlify'),
                    import('@tryghost/algolia-netlify/post-published'),
                    import('@tryghost/algolia-netlify/post-unpublished')
                ]);

                Object.assign(process.env, {
                    ALGOLIA_ACTIVE: 'TRUE',
                    ALGOLIA_APP_ID: 'packed-consumer-app',
                    ALGOLIA_API_KEY: 'packed-consumer-key',
                    ALGOLIA_INDEX: 'ghost-content',
                    NETLIFY_KEY: 'packed-webhook-key'
                });
                requesterMock.reset();
                const headers = {
                    'content-type': 'application/json',
                    'user-agent': 'Ghost/6.57.1 (https://github.com/TryGhost/Ghost)'
                };
                const post = ${JSON.stringify(richPost)};
                const published = await postPublished(new Request(
                    'https://example.invalid/.netlify/functions/post-published?key=packed-webhook-key',
                    {method: 'POST', headers, body: JSON.stringify({post: {current: post, previous: {}}})}
                ));
                const unpublished = await postUnpublished(new Request(
                    'https://example.invalid/.netlify/functions/post-unpublished?key=packed-webhook-key',
                    {method: 'POST', headers, body: JSON.stringify({post: {current: post, previous: {}}})}
                ));
                const requests = requesterMock.requests();
                console.log(JSON.stringify({
                    rootMatchesSubpaths: postPublished === publishedDefault && postUnpublished === unpublishedDefault,
                    responses: await Promise.all([published, unpublished].map(async response => ({
                        status: response.status,
                        body: await response.text()
                    }))),
                    requests: requests.map(request => [request.method, new URL(request.url).pathname])
                }));
            } finally {
                requesterMock.restore();
            }
        `);
        const consumerResult = await execFileAsync(process.execPath, [consumer], {
            cwd: temporaryDirectory,
            env: {...process.env}
        });

        expect(JSON.parse(consumerResult.stdout.trim().split('\n').at(-1))).toEqual({
            rootMatchesSubpaths: true,
            responses: [
                {
                    status: 200,
                    body: 'Post "Ghost 6 rendered content contract" has been added to the index.'
                },
                {
                    status: 200,
                    body: 'Post "ghost-6-rendered-content-contract" has been removed from the index.'
                }
            ],
            requests: [
                ['PUT', '/1/indexes/ghost-content/settings'],
                ['GET', '/1/indexes/ghost-content/settings'],
                ['POST', '/1/indexes/ghost-content/batch'],
                ['POST', '/1/indexes/ghost-content/deleteByQuery']
            ]
        });

        const typeConsumer = path.join(temporaryDirectory, 'consumer.mts');
        await writeFile(typeConsumer, `
            import {postPublished, postUnpublished} from '@tryghost/algolia-netlify';
            import publishedDefault from '@tryghost/algolia-netlify/post-published';
            import unpublishedDefault from '@tryghost/algolia-netlify/post-unpublished';

            const handlers: Array<(request: Request) => Promise<Response>> = [
                postPublished,
                postUnpublished,
                publishedDefault,
                unpublishedDefault
            ];
            void handlers;
        `);
        await execFileAsync(path.join(packageDirectory, 'node_modules/.bin/tsc'), [
            '--noEmit',
            '--strict',
            '--target',
            'ES2023',
            '--module',
            'NodeNext',
            '--moduleResolution',
            'NodeNext',
            '--lib',
            'ES2023,DOM',
            typeConsumer
        ], {cwd: temporaryDirectory});
    }, 30000);
});
