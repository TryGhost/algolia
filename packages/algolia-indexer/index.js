const algoliaSearch = require('algoliasearch');

const indexFactory = (algoliaSettings) => {
    return {
        index: [],
        connect() {
            if (algoliaSettings && algoliaSettings.active === true) {
                if (algoliaSettings.applicationID && algoliaSettings.apiKey && algoliaSettings.index) {
                    const client = algoliaSearch(algoliaSettings.applicationID, algoliaSettings.apiKey);

                    this.index = client.initIndex(algoliaSettings.index);
                    return true;
                }
                // TODO better error output on frontend
                console.log(
                    'Please check your Algolia settings for a missing configuration option: applicationID, apiKey, index.'
                );
                return false;
            }
            console.log('Algolia indexing deactivated.');
            return false;
        },
        save(fragments) {
            return this.index.addObjects(fragments);
        },
        // TODO
        delete(post) {
            return this.index.deleteBy(post.attributes.uuid, {
                restrictSearchableAttributes: 'post_uuid'
            });
        },
        countRecords() {
            return this.index.search({query: '', hitsPerPage: 0}).then(queryResult => queryResult.nbHits);
        }
    };
};

module.exports = indexFactory;
