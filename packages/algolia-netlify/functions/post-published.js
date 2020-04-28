const IndexFactory = require('@tryghost/algolia-indexer');
const transforms = require('@tryghost/algolia-fragmenter');

exports.handler = (event, context, callback) => {
    if (!process.env.ALGOLIA_ACTIVE === 'TRUE') {
        return;
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

    // Instanciate the Algolia indexer, which connects to Algolia and
    // sets up the settings for the index.
    const index = new IndexFactory(algoliaSettings);

    // Fragmenter needs an Array to reduce
    const fragments = node.reduce(transforms.fragmentTransformer, []);

    index
        .setSettingsForIndex()
        .then((settings) => {
            console.log('Index set up with following settings: ', settings); // eslint-disable-line no-console

            return index
                .save(fragments).then(() => {
                    callback(null, {
                        statusCode: 200,
                        body: `GhostAlgolia: post "${post.title}" has been added to the index.`
                    });
                });
        })
        .catch((err) => {
            callback(err);
        });
};
