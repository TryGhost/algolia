import {appendFileSync} from 'node:fs';

const requestLogPath = process.env.LIVE_GHOST_SMOKE_REQUEST_LOG;
if (requestLogPath === undefined || requestLogPath === '') {
    throw new Error('The live Ghost smoke preload requires a request log path.');
}

const timeoutBySignal = new WeakMap<AbortSignal, number>();

AbortSignal.timeout = (milliseconds: number): AbortSignal => {
    const signal = new AbortController().signal;
    timeoutBySignal.set(signal, milliseconds);
    return signal;
};

globalThis.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const requestUrl =
        input instanceof Request
            ? new URL(input.url)
            : input instanceof URL
              ? input
              : new URL(input);
    const contentTypeMatch = requestUrl.pathname.match(/^\/ghost\/api\/content\/(posts|pages)\/$/u);
    if (requestUrl.origin !== 'https://main.ghost.is' || contentTypeMatch === null) {
        throw new Error(`Denied unexpected live smoke request to ${requestUrl.origin}.`);
    }

    const contentType = contentTypeMatch[1];
    if (contentType !== 'posts' && contentType !== 'pages') {
        throw new Error('The live smoke request used an unexpected content type.');
    }

    const signal = init?.signal;
    appendFileSync(
        requestLogPath,
        `${JSON.stringify({
            url: requestUrl.href,
            method: init?.method,
            acceptVersion: new Headers(init?.headers).get('Accept-Version'),
            redirect: init?.redirect,
            signalIsAbortSignal: signal instanceof AbortSignal,
            timeoutMilliseconds:
                signal instanceof AbortSignal ? (timeoutBySignal.get(signal) ?? null) : null
        })}\n`,
        'utf8'
    );

    const items = contentType === 'posts' ? [{html: '<p>Private fixture prose</p>'}] : [];
    return new Response(
        JSON.stringify({
            [contentType]: items,
            meta: {
                pagination: {
                    page: 1,
                    limit: 100,
                    pages: 1,
                    total: items.length,
                    next: null,
                    prev: null
                }
            }
        }),
        {status: 200, headers: {'Content-Type': 'application/json'}}
    );
};
