import {realpath} from 'node:fs/promises';
import {findPackageJSON} from 'node:module';
import {dirname} from 'node:path';
import {pathToFileURL} from 'node:url';

// Frozen installs do not populate pnpm's registry metadata cache. Resolve the
// parser's installed dependency chain so packed-package tests work offline.
export const parserDependencyOverrides = async (): Promise<Record<string, string>> => {
    const overrides: Record<string, string> = {};
    let parent = new URL('../../package.json', import.meta.url);
    for (const name of ['parse5', 'entities']) {
        const manifest = findPackageJSON(name, parent);
        if (!manifest) {
            throw new Error(`Cannot locate the installed ${name} package.`);
        }
        const installedManifest = await realpath(manifest);
        overrides[name] = `file:${dirname(installedManifest)}`;
        parent = pathToFileURL(installedManifest);
    }
    return overrides;
};
