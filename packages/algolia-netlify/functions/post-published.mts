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
import {IndexFactory, transforms} from './utils/algolia.mts';

export default async function postPublished(request: Request): Promise<Response> {
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

    const post = payload.post.current;
    if (!isRecord(post) || Object.keys(post).length === 0) {
        return noValidBodyResponse();
    }

    try {
        const algoliaObjects = transforms.transformToAlgoliaObject([post]);
        const fragments = algoliaObjects.reduce(transforms.fragmentTransformer, []);
        const index = new IndexFactory(algoliaSettings());
        await index.initIndex();
        await index.save(fragments);
        console.log('Fragments successfully saved to Algolia index');
        return textResponse(`Post "${String(post.title)}" has been added to the index.`);
    } catch (error) {
        console.log(error);
        const message = error instanceof Error ? error.message : String(error);
        return Response.json({msg: message}, {status: 500});
    }
}
