/** Applied outside the selected runtime, including historical releases. */
export const authorizeDeployment = (request: Request): Response | undefined => {
    const key = process.env.NETLIFY_KEY;
    if (!key?.trim()) {
        return new Response('Webhook authentication is not configured', {status: 503});
    }
    const keys = new URL(request.url).searchParams.getAll('key');
    if (keys.length !== 1 || !keys[0] || keys[0] !== key) {
        return new Response('Unauthorized', {status: 401});
    }
    return undefined;
};
