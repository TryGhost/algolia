import IndexFactory from '@tryghost/algolia-indexer';

exports.handler = async (event) => {
    if (!process.env.ALGOLIA_ACTIVE === 'TRUE') {
        return {
            statusCode: 200,
            body: `Algolia is not activated`
        };
    }

    const algoliaSettings = {
        appId: process.env.ALGOLIA_APP_ID,
        apiKey: process.env.ALGOLIA_API_KEY,
        index: process.env.ALGOLIA_INDEX
    };

    const {post} = JSON.parse(event.body);

    // Updated posts are in `post.current`, deleted are in `post.previous`
    const {slug} = (post.current && Object.keys(post.current).length && post.current)
                   || (post.previous && Object.keys(post.previous).length && post.previous);

    if (!slug) {
        return {
            statusCode: 200,
            body: `No valid request body detected`
        };
    }

    try {
        // Instanciate the Algolia indexer, which connects to Algolia and
        // sets up the settings for the index.
        const index = new IndexFactory(algoliaSettings);
        await index.initIndex();
        await index.delete(slug);
        console.log(`Fragments for slug "${slug}" successfully removed from Algolia index`); // eslint-disable-line no-console
        return {
            statusCode: 200,
            body: `Post "${slug}" has been removed from the index.`
        };
    } catch (error) {
        console.log(error); // eslint-disable-line no-console
        return {
            statusCode: 500,
            body: JSON.stringify({msg: error.message})
        };
    }
};
