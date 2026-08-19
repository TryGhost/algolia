import {appendFile} from 'node:fs/promises';

import {
    SmokeError,
    runLiveGhostContentSmoke,
    type SmokeTransport,
    type SmokeTransportRequest
} from './live-ghost-content-smoke.mts';

const createRequestUrl = (request: SmokeTransportRequest): URL => {
    const requestUrl = new URL(`/ghost/api/content/${request.contentType}/`, request.target);
    requestUrl.searchParams.set('key', request.contentApiKey);
    requestUrl.searchParams.set('fields', request.fields);
    requestUrl.searchParams.set('formats', request.formats);
    requestUrl.searchParams.set('limit', String(request.limit));
    requestUrl.searchParams.set('page', String(request.page));
    return requestUrl;
};

const transport: SmokeTransport = async request => {
    const response = await fetch(createRequestUrl(request), {
        method: 'GET',
        headers: {'Accept-Version': request.apiVersion},
        redirect: request.redirect
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

const summaryPath = process.env.GITHUB_STEP_SUMMARY;
if (summaryPath === undefined || summaryPath === '') {
    process.stderr.write('Live Ghost content smoke failed: operational-failure\n');
    process.exitCode = 1;
} else {
    try {
        const report = await runLiveGhostContentSmoke({
            target: process.env.GHOST_URL ?? '',
            apiVersion: process.env.GHOST_API_VERSION ?? '',
            contentApiKey: process.env.MAIN_GHOST_CONTENT_API_KEY ?? '',
            transport,
            clock: () => new Date(),
            summarySink: summary => appendFile(summaryPath, summary, 'utf8')
        });

        process.stdout.write(`Live Ghost content smoke: ${report.category}\n`);
        if (report.category !== 'ok') {
            process.exitCode = 1;
        }
    } catch (error) {
        const category = error instanceof SmokeError ? error.category : 'operational-failure';
        process.stderr.write(`Live Ghost content smoke failed: ${category}\n`);
        process.exitCode = 1;
    }
}
