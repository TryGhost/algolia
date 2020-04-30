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
        try {
            await this.initIndex(); //initiate client
            await this.index.setSettings(this.options.indexSettings);
            return await this.index.getSettings();
        } catch (error) {
            throw new Error('Couldn\'t setup Algolia index', error);
        }
    }
    async save(fragments) {
        console.log(`Saving ${fragments.length} fragments`); // eslint-disable-line no-console
        try {
            await this.index.saveObjects(fragments);
        } catch (error) {
            throw new Error('Error, saving to Algolia', error);
        }
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
