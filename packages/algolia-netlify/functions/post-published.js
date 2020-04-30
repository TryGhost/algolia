import IndexFactory from '@tryghost/algolia-indexer';
import transforms from '@tryghost/algolia-fragmenter';

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

    const post = JSON.parse(event.body).post.current;

    // TODO: move to a util
    const algoliaPost = {
        objectID: post.uuid,
        slug: post.slug,
        url: post.url,
        html: post.html,
        image: post.feature_image,
        title: post.title,
        tags: []
    };

    post.tags.forEach((tag) => {
        algoliaPost.tags.push({name: tag.name, slug: tag.slug});
    });

    const node = [];

    node.push(algoliaPost);

    // Fragmenter needs an Array to reduce
    const fragments = node.reduce(transforms.fragmentTransformer, []);

    try {
        // Instanciate the Algolia indexer, which connects to Algolia and
        // sets up the settings for the index.
        const index = new IndexFactory(algoliaSettings);
        await index.setSettingsForIndex();
        await index.save(fragments);
        console.log('Fragments successfully saved to Algolia index'); // eslint-disable-line no-console
        return {
            statusCode: 200,
            body: `Post "${algoliaPost.title}" has been added to the index.`
        };
    } catch (error) {
        console.log(error); // eslint-disable-line no-console
        return {
            statusCode: 500,
            body: JSON.stringify({msg: error.message})
        };
    }
};
