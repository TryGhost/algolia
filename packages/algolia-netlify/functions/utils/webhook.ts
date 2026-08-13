const TEXT_HEADERS = {'content-type': 'text/plain; charset=utf-8'};
const GHOST_SOURCE = String.raw`https://github\.com/TryGhost/Ghost`;
const SEMVER = String.raw`(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?`;
const GHOST_USER_AGENT = new RegExp(
    `^Ghost(?:\\(${GHOST_SOURCE}\\)|/${SEMVER} \\(${GHOST_SOURCE}\\))$`,
    'u'
);

type JsonRecord = Record<string, unknown>;

export type GhostWebhookPayload = {
    post: {
        current?: JsonRecord;
        previous?: JsonRecord;
    };
};

export const isRecord = (value: unknown): value is JsonRecord => (
    typeof value === 'object' && value !== null && !Array.isArray(value)
);

export const isGhostUserAgent = (value: string | null): boolean => (
    value !== null && GHOST_USER_AGENT.test(value)
);

export const textResponse = (body: string, status = 200): Response => (
    new Response(body, {status, headers: TEXT_HEADERS})
);

export const invalidBodyResponse = (): Response => textResponse('Invalid request body', 400);
export const noValidBodyResponse = (): Response => textResponse('No valid request body detected');

export const authorizeRequest = (request: Request): Response | undefined => {
    const keys = new URL(request.url).searchParams.getAll('key');
    if (keys.length > 1 || (keys[0] && keys[0] !== process.env.NETLIFY_KEY)) {
        return textResponse('Unauthorized', 401);
    }
    return undefined;
};

export const algoliaSettings = () => ({
    appId: process.env.ALGOLIA_APP_ID,
    apiKey: process.env.ALGOLIA_API_KEY,
    index: process.env.ALGOLIA_INDEX
});

export const parseWebhookBody = async (
    request: Request
): Promise<GhostWebhookPayload | undefined> => {
    try {
        const body: unknown = await request.json();
        if (!isRecord(body) || !isRecord(body.post)) {
            return undefined;
        }

        return {post: body.post};
    } catch {
        return undefined;
    }
};
