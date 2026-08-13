import {rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {build} from 'esbuild';

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(packageDirectory, 'dist');

await rm(outputDirectory, {recursive: true, force: true});

await build({
    absWorkingDir: packageDirectory,
    entryPoints: [
        'functions/post-published.mts',
        'functions/post-unpublished.mts'
    ],
    outdir: outputDirectory,
    outbase: '.',
    outExtension: {'.js': '.mjs'},
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    target: 'node24',
    logLevel: 'info'
});

await build({
    absWorkingDir: packageDirectory,
    entryPoints: ['index.mts'],
    outdir: outputDirectory,
    outExtension: {'.js': '.mjs'},
    bundle: false,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    logLevel: 'info'
});
