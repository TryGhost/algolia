import {appendFile, readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

import {createAlgoliaRecords} from '../lib/index.mjs';
import {
    DifferentialSmokeError,
    runDifferentialRecordSmoke,
    type DifferentialTransport,
    type DifferentialTransportRequest,
    type ExpectedDriftDeclaration,
    type GhostContentItem,
    type RecordBuilder
} from './differential-record-smoke.mts';

const REQUEST_TIMEOUT_MS = 30_000;

const createRequestUrl = (request: DifferentialTransportRequest): URL => {
    const requestUrl = new URL(`/ghost/api/content/${request.contentType}/`, request.target);
    requestUrl.searchParams.set('key', request.contentApiKey);
    requestUrl.searchParams.set('fields', request.fields);
    requestUrl.searchParams.set('formats', request.formats);
    requestUrl.searchParams.set('limit', String(request.limit));
    requestUrl.searchParams.set('page', String(request.page));
    return requestUrl;
};

const transport: DifferentialTransport = async request => {
    const response = await fetch(createRequestUrl(request), {
        method: 'GET',
        headers: {'Accept-Version': request.apiVersion},
        redirect: request.redirect,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });

    let body: unknown = null;
    if (response.status >= 200 && response.status < 300) {
        try {
            body = await response.json();
        } catch {
            body = null;
        }
    }

    return {
        status: response.status,
        redirected: response.redirected,
        body
    };
};

type PublishedFragmenter = Readonly<{
    version: string;
    build: RecordBuilder;
}>;

const isRecordBuilderModule = (
    value: unknown
): value is Readonly<{createAlgoliaRecords: (contents: readonly unknown[]) => unknown}> => {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as Record<string, unknown>).createAlgoliaRecords === 'function'
    );
};

const loadPublishedFragmenter = async (
    packageDirectory: string
): Promise<PublishedFragmenter | null> => {
    try {
        const manifest: unknown = JSON.parse(
            await readFile(path.join(packageDirectory, 'package.json'), 'utf8')
        );
        if (typeof manifest !== 'object' || manifest === null) {
            return null;
        }
        const {version, exports: exportMap} = manifest as Record<string, unknown>;
        if (typeof version !== 'string') {
            return null;
        }
        const rootExport = (exportMap as Record<string, Record<string, unknown>>)['.'];
        const entry = rootExport?.import;
        if (typeof entry !== 'string') {
            return null;
        }

        const entryPath = path.resolve(packageDirectory, entry);
        if (!entryPath.startsWith(path.resolve(packageDirectory) + path.sep)) {
            return null;
        }
        const loaded: unknown = await import(pathToFileURL(entryPath).href);
        if (!isRecordBuilderModule(loaded)) {
            return null;
        }

        const build: RecordBuilder = content => {
            return loaded.createAlgoliaRecords([content]) as ReturnType<RecordBuilder>;
        };
        return {version, build};
    } catch {
        return null;
    }
};

const readExpectedDrift = async (): Promise<ExpectedDriftDeclaration | undefined> => {
    const declaredPath =
        process.env.EXPECTED_DRIFT_FILE ?? path.join(import.meta.dirname, 'expected-drift.json');
    let contents: string;
    try {
        contents = await readFile(declaredPath, 'utf8');
    } catch {
        return undefined;
    }
    try {
        return JSON.parse(contents) as ExpectedDriftDeclaration;
    } catch {
        // An unparsable declaration file surfaces as an invalid declaration inside the run.
        return {publishedVersion: '', reason: ''};
    }
};

const buildWorkspaceRecords: RecordBuilder = (content: GhostContentItem) => {
    return createAlgoliaRecords([content]);
};

const summaryPath = process.env.GITHUB_STEP_SUMMARY;
const publishedDirectory = process.env.PUBLISHED_FRAGMENTER_DIR;
// The published module executes third-party code at import time, so the key leaves the
// environment first and reaches only the smoke transport.
const contentApiKey = process.env.MAIN_GHOST_CONTENT_API_KEY ?? '';
delete process.env.MAIN_GHOST_CONTENT_API_KEY;
const published =
    publishedDirectory === undefined || publishedDirectory === ''
        ? null
        : await loadPublishedFragmenter(publishedDirectory);

if (summaryPath === undefined || summaryPath === '' || published === null) {
    process.stderr.write('Differential record smoke failed: operational-failure\n');
    process.exitCode = 1;
} else {
    try {
        const report = await runDifferentialRecordSmoke({
            target: process.env.GHOST_URL ?? '',
            apiVersion: process.env.GHOST_API_VERSION ?? '',
            contentApiKey,
            transport,
            clock: () => new Date(),
            summarySink: summary => appendFile(summaryPath, summary, 'utf8'),
            publishedVersion: published.version,
            buildWorkspaceRecords,
            buildPublishedRecords: published.build,
            ...(await readExpectedDrift().then(declaration =>
                declaration === undefined ? {} : {expectedDrift: declaration}
            ))
        });

        process.stdout.write(`Differential record smoke: ${report.category}\n`);
        if (report.category !== 'ok' && report.category !== 'expected-drift') {
            process.exitCode = 1;
        }
    } catch (error) {
        const category =
            error instanceof DifferentialSmokeError ? error.category : 'operational-failure';
        process.stderr.write(`Differential record smoke failed: ${category}\n`);
        process.exitCode = 1;
    }
}
