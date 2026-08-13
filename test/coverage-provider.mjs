import {randomUUID} from 'node:crypto';
import {existsSync} from 'node:fs';
import {readdir, readFile, rm} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';

import {mergeProcessCovs} from '@bcoe/v8-coverage';
import v8Coverage from '@vitest/coverage-v8';
// Vitest 4 has no composition hook, so this exact-pinned package export is the smallest bridge.
import {V8CoverageProvider} from '@vitest/coverage-v8/dist/provider.js';

export const SUBPROCESS_COVERAGE_ENV = 'VITEST_SUBPROCESS_COVERAGE_DIR';

const subprocessCoverageParent = resolve(process.cwd(), 'coverage', '.subprocess');
const ownedSubprocessCoverageDirectories = new Set();

export const createOwnedSubprocessCoverageDirectory = () => {
    const directory = resolve(subprocessCoverageParent, randomUUID());
    ownedSubprocessCoverageDirectories.add(directory);
    return directory;
};

export const isOwnedSubprocessCoverageDirectory = directory => {
    return (
        ownedSubprocessCoverageDirectories.has(directory) &&
        dirname(directory) === subprocessCoverageParent &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
            directory.slice(subprocessCoverageParent.length + 1)
        )
    );
};

export const consumeOwnedSubprocessCoverage = async (directory, consume) => {
    if (!isOwnedSubprocessCoverageDirectory(directory)) {
        throw new Error('Subprocess coverage directory is not owned by this Vitest controller.');
    }

    try {
        if (existsSync(directory)) {
            const filenames = await readdir(directory);
            const rawCoverages = await Promise.all(
                filenames
                    .filter(filename => filename.endsWith('.json'))
                    .map(async filename =>
                        JSON.parse(await readFile(resolve(directory, filename), 'utf8'))
                    )
            );

            if (rawCoverages.length > 0) {
                await consume(rawCoverages);
            }
        }
    } finally {
        ownedSubprocessCoverageDirectories.delete(directory);
        await rm(directory, {recursive: true, force: true});
    }
};

// Vitest 4 has no subprocess hook, so this exact-version bridge extends its exported V8 provider.
class SubprocessCoverageProvider extends V8CoverageProvider {
    name = 'v8';

    constructor(directory) {
        super();
        this.subprocessCoverageDirectory = directory;
    }

    async generateCoverage(context) {
        await consumeOwnedSubprocessCoverage(
            this.subprocessCoverageDirectory,
            async rawCoverages => {
                const coverage = mergeProcessCovs(rawCoverages);
                coverage.result = coverage.result
                    .filter(
                        entry =>
                            entry.url.startsWith('file://') && !entry.url.includes('/node_modules/')
                    )
                    // Vitest's converter expects a script offset; Node executes these sources without a wrapper.
                    .map(entry => ({...entry, startOffset: 0}));

                this.onAfterSuiteRun({
                    coverage,
                    environment: 'node',
                    projectName: '',
                    testFiles: ['subprocesses']
                });
            }
        );

        return super.generateCoverage(context);
    }
}

export const createControllerCoverageProvider = () => {
    const directory = createOwnedSubprocessCoverageDirectory();
    process.env[SUBPROCESS_COVERAGE_ENV] = directory;
    process.env.NODE_V8_COVERAGE = directory;
    return new SubprocessCoverageProvider(directory);
};

const getWorkerCoverageDirectory = () => {
    const directory = process.env[SUBPROCESS_COVERAGE_ENV];
    if (
        dirname(directory || '') !== subprocessCoverageParent ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
            (directory || '').slice(subprocessCoverageParent.length + 1)
        )
    ) {
        throw new Error('Vitest worker received an invalid subprocess coverage directory.');
    }
    return directory;
};

export default {
    async startCoverage(options) {
        // Vitest 5 replaces this extension of its exported V8 provider with coverage.autoAttachSubprocess.
        process.env.NODE_V8_COVERAGE = getWorkerCoverageDirectory();
        return v8Coverage.startCoverage(options);
    },
    takeCoverage: options => v8Coverage.takeCoverage(options),
    stopCoverage: options => v8Coverage.stopCoverage(options),
    getProvider: createControllerCoverageProvider
};
