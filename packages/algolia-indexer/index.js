const algoliaSearch = require('algoliasearch');

// Any defined settings will override those in the algolia UI
const REQUIRED_SETTINGS = {
    // We chunk our pages into small algolia entries, and mark them as distinct by slug
    // This ensures we get one result per page, whichever is ranked highest
    distinct: true,
    attributeForDistinct: `slug`,
    // This ensures that chunks higher up on a page rank higher
    customRanking: [`desc(customRanking.heading)`, `asc(customRanking.position)`],
    // Defines the order algolia ranks various attributes in
    searchableAttributes: [`title`, `headings`, `html`, `url`, `tags.name`, `tags`]
};

class IndexFactory {
    constructor(algoliaSettings = {}) {
        if (!algoliaSettings.apiKey || !algoliaSettings.appId || !algoliaSettings.index || algoliaSettings.index.length < 1) {
            throw new Error('Algolia appId, apiKey, and index is required!');
        }
        this.index = [];
        this.options = algoliaSettings;

        this.options.indexSettings = algoliaSettings.indexSettings || REQUIRED_SETTINGS;
    }
    initClient() {
        this.client = algoliaSearch(this.options.appId, this.options.apiKey);
    }
    initIndex() {
        this.initClient();
        this.index = this.client.initIndex(this.options.index);
    }
    async setSettingsForIndex() {
        this.initIndex();
        return await this.index.setSettings(this.options.indexSettings)
            .then(() => this.index.getSettings());
    }
    save(fragments) {
        return this.index.addObjects(fragments);
    }
    delete(post) {
        return this.index.deleteBy(post.attributes.uuid, {
            restrictSearchableAttributes: 'post_uuid'
        });
    }
    countRecords() {
        return this.index.search({query: '', hitsPerPage: 0}).then(queryResult => queryResult.nbHits);
    }
}

module.exports = IndexFactory;
