const IndexFactory = require('@tryghost/algolia-indexer');
const transforms = require('@tryghost/algolia-fragmenter');

exports.handler = async (event) => {
    if (process.env.ALGOLIA_ACTIVE !== 'TRUE') {
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

    let {page} = JSON.parse(event.body);
    page = (page && Object.keys(page.current).length > 0 && page.current) || {};

    if (!page || Object.keys(page).length < 1) {
        return {
            statusCode: 200,
            body: `No valid request body detected`
        };
    }

    const node = [];

    // Transformer methods need an Array of Objects
    node.push(page);

    // Transform into Algolia object with the properties we need
    const algoliaObject = transforms.transformToAlgoliaObject(node);

    // Create fragments of the page
    const fragments = algoliaObject.reduce(transforms.fragmentTransformer, []);

    try {
        // Instanciate the Algolia indexer, which connects to Algolia and
        // sets up the settings for the index.
        const index = new IndexFactory(algoliaSettings);
        await index.setSettingsForIndex();
        await index.save(fragments);
        console.log('Fragments successfully saved to Algolia index'); // eslint-disable-line no-console
        return {
            statusCode: 200,
            body: `page "${page.title}" has been added to the index.`
        };
    } catch (error) {
        console.log(error); // eslint-disable-line no-console
        return {
            statusCode: 500,
            body: JSON.stringify({msg: error.message})
        };
    }
};
