import {rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

await Promise.all([
    rm(path.join(packageDirectory, 'dist/functions/utils/algolia.d.mts'), {force: true}),
    rm(path.join(packageDirectory, 'dist/functions/utils/webhook.d.ts'), {force: true}),
    rm(path.join(packageDirectory, 'dist/types'), {recursive: true, force: true})
]);
