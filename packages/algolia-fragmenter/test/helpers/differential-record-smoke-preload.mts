import {appendFileSync} from 'node:fs';

const requestLogPath = process.env.DIFFERENTIAL_SMOKE_REQUEST_LOG;
if (requestLogPath === undefined || requestLogPath === '') {
    throw new Error('The differential smoke preload requires a request log path.');
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
    if (
        requestUrl.origin !== 'https://main.ghost.is' ||
        requestUrl.pathname !== '/ghost/api/content/posts/'
    ) {
        throw new Error(`Denied unexpected differential smoke request to ${requestUrl.origin}.`);
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

    const items = [
        {
            id: '68f1a2b3c4d5e6f708192a3b',
            slug: 'private-fixture-slug',
            url: 'https://main.ghost.is/private-fixture-slug/',
            title: 'Private fixture title',
            html: '<p>Private fixture prose</p>'
        }
    ];
    return new Response(
        JSON.stringify({
            posts: items,
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
