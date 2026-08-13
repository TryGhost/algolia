import {
    algoliaSettings,
    authorizeRequest,
    invalidBodyResponse,
    isGhostUserAgent,
    isRecord,
    noValidBodyResponse,
    parseWebhookBody,
    textResponse
} from './utils/webhook.ts';
import {IndexFactory} from './utils/algolia.mts';

export default async function postUnpublished(request: Request): Promise<Response> {
    const authorizationResponse = authorizeRequest(request);
    if (authorizationResponse) {
        return authorizationResponse;
    }

    if (process.env.ALGOLIA_ACTIVE !== 'TRUE') {
        return textResponse('Algolia is not activated');
    }

    if (!isGhostUserAgent(request.headers.get('user-agent'))) {
        return textResponse('Unauthorized', 401);
    }

    const payload = await parseWebhookBody(request);
    if (!payload) {
        return invalidBodyResponse();
    }

    const {current} = payload.post;
    const {previous} = payload.post;
    const post = isRecord(current) && Object.keys(current).length > 0
        ? current
        : previous;
    const slug = isRecord(post) && typeof post.slug === 'string' ? post.slug : '';

    if (!slug) {
        return noValidBodyResponse();
    }

    try {
        const index = new IndexFactory(algoliaSettings());
        await index.initIndex();
        await index.delete(slug);
        console.log(`Fragments for slug "${slug}" successfully removed from Algolia index`); // eslint-disable-line no-console
        return textResponse(`Post "${slug}" has been removed from the index.`);
    } catch (error) {
        console.log(error); // eslint-disable-line no-console
        const message = error instanceof Error ? error.message : String(error);
        return Response.json({msg: message}, {status: 500});
    }
}
