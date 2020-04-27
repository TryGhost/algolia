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
    const node = [];
    node.push(post);
    const index = new IndexFactory(algoliaSettings);
    const fragments = node.reduce(transforms.fragmentTransformer, []);

    index
        .setSettingsForIndex()
        .then(() => {
            index
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
