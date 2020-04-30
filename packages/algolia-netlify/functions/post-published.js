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

    let {post} = JSON.parse(event.body);
    post = (post && Object.keys(post.current).length > 0 && post.current) || {};

    if (!post || Object.keys(post).length < 1) {
        return {
            statusCode: 200,
            body: `No valid request body detected`
        };
    }

    // Define the properties we need for Algolia
    // TODO: make this a custom setting
    const algoliaPost = {
        objectID: post.uuid,
        slug: post.slug,
        url: post.url,
        html: post.html,
        image: post.feature_image,
        title: post.title,
        tags: [],
        authors: []
    };

    post.tags.forEach((tag) => {
        algoliaPost.tags.push({name: tag.name, slug: tag.slug});
    });

    post.authors.forEach((author) => {
        algoliaPost.authors.push({name: author.name, slug: author.slug});
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
