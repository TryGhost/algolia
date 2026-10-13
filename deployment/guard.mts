import {createHash, timingSafeEqual} from 'node:crypto';

const authorizeKey = (supplied: string | null): Response | undefined => {
    const key = process.env.NETLIFY_KEY;
    if (!key?.trim()) {
        return new Response('Webhook authentication is not configured', {status: 503});
    }
    if (
        !supplied ||
        !timingSafeEqual(
            createHash('sha256').update(supplied).digest(),
            createHash('sha256').update(key).digest()
        )
    ) {
        return new Response('Unauthorized', {status: 401});
    }
    return undefined;
};

/** Applied outside the selected runtime, including historical releases. */
export const authorizeDeployment = (request: Request): Response | undefined => {
    const keys = new URL(request.url).searchParams.getAll('key');
    return authorizeKey(keys.length === 1 ? keys[0] : null);
};

/** Read-only check: never invokes an indexing handler or changes configuration. */
export const verifySecret = async (request: Request): Promise<Response> => {
    const headers = {'Cache-Control': 'no-store'};
    if (request.method !== 'POST') {
        return new Response('Method not allowed', {
            status: 405,
            headers: {...headers, Allow: 'POST'}
        });
    }
    if (
        request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !==
        'application/json'
    ) {
        return new Response('Invalid request', {status: 400, headers});
    }
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return new Response('Invalid request', {status: 400, headers});
    }
    if (!body || typeof body !== 'object' || !('key' in body) || typeof body.key !== 'string') {
        return new Response('Invalid request', {status: 400, headers});
    }
    const denied = authorizeKey(body.key);
    if (denied) {
        denied.headers.set('Cache-Control', 'no-store');
        return denied;
    }
    return new Response(null, {status: 204, headers});
};
