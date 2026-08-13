import assert from 'node:assert/strict';
import {access, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, it} from 'vitest';

import {
    SUBPROCESS_COVERAGE_ENV,
    consumeOwnedSubprocessCoverage,
    createControllerCoverageProvider,
    createOwnedSubprocessCoverageDirectory
} from './coverage-provider.mjs';

describe('subprocess coverage ownership', function () {
    let externalParent;
    let originalCoverageDirectory;
    let originalNodeCoverageDirectory;
    let sibling;

    beforeEach(function () {
        originalCoverageDirectory = process.env[SUBPROCESS_COVERAGE_ENV];
        originalNodeCoverageDirectory = process.env.NODE_V8_COVERAGE;
    });

    afterEach(async function () {
        if (originalCoverageDirectory === undefined) {
            delete process.env[SUBPROCESS_COVERAGE_ENV];
        } else {
            process.env[SUBPROCESS_COVERAGE_ENV] = originalCoverageDirectory;
        }
        if (originalNodeCoverageDirectory === undefined) {
            delete process.env.NODE_V8_COVERAGE;
        } else {
            process.env.NODE_V8_COVERAGE = originalNodeCoverageDirectory;
        }
        if (externalParent) {
            await rm(externalParent, {recursive: true, force: true});
        }
        if (sibling) {
            await rm(sibling, {recursive: true, force: true});
        }
    });

    const createOwnedRun = async contents => {
        const directory = createOwnedSubprocessCoverageDirectory();
        sibling = `${directory}-sibling-sentinel`;
        await mkdir(directory, {recursive: true});
        await writeFile(path.join(directory, 'coverage.json'), contents);
        await writeFile(sibling, 'keep me');
        return directory;
    };

    const assertExactCleanup = async directory => {
        await assert.rejects(access(directory), {code: 'ENOENT'});
        assert.equal(await readFile(sibling, 'utf8'), 'keep me');
        await access(path.dirname(directory));
    };

    it('cleans its exact owned run after successful consumption', async function () {
        const directory = await createOwnedRun('{"result":[]}');
        let consumed = false;

        await consumeOwnedSubprocessCoverage(directory, async () => {
            consumed = true;
        });

        assert.equal(consumed, true);
        await assertExactCleanup(directory);
    });

    it('cleans its exact owned run when reading raw coverage fails', async function () {
        const directory = await createOwnedRun('invalid JSON');

        await assert.rejects(
            consumeOwnedSubprocessCoverage(directory, async () => {}),
            SyntaxError
        );
        await assertExactCleanup(directory);
    });

    it('ignores an externally injected cleanup target', async function () {
        externalParent = await mkdtemp(path.join(os.tmpdir(), 'algolia-external-coverage-'));
        const sentinel = path.join(externalParent, 'sentinel');
        await writeFile(sentinel, 'keep me');
        process.env[SUBPROCESS_COVERAGE_ENV] = externalParent;

        const provider = createControllerCoverageProvider();
        const ownedDirectory = process.env[SUBPROCESS_COVERAGE_ENV];
        await mkdir(ownedDirectory, {recursive: true});
        await writeFile(path.join(ownedDirectory, 'coverage-invalid.json'), 'invalid JSON');
        process.env[SUBPROCESS_COVERAGE_ENV] = externalParent;

        assert.notEqual(ownedDirectory, externalParent);
        await assert.rejects(provider.generateCoverage({}), SyntaxError);
        await assert.rejects(access(ownedDirectory), {code: 'ENOENT'});
        assert.equal(await readFile(sentinel, 'utf8'), 'keep me');
    });

    it('refuses to consume an unowned directory', async function () {
        externalParent = await mkdtemp(path.join(os.tmpdir(), 'algolia-unowned-coverage-'));
        const sentinel = path.join(externalParent, 'sentinel');
        await writeFile(sentinel, 'keep me');

        await assert.rejects(
            consumeOwnedSubprocessCoverage(externalParent, async () => {}),
            /not owned/
        );
        assert.equal(await readFile(sentinel, 'utf8'), 'keep me');
    });
});
