const algoliaSearch = require('algoliasearch');

// Any defined settings will override those in the algolia UI
// TODO: make this a custom setting
const REQUIRED_SETTINGS = {
    // We chunk our pages into small algolia entries, and mark them as distinct by slug
    // This ensures we get one result per page, whichever is ranked highest
    distinct: true,
    attributeForDistinct: `slug`,
    // This ensures that chunks higher up on a page rank higher
    customRanking: [`desc(customRanking.heading)`, `asc(customRanking.position)`],
    // Defines the order algolia ranks various attributes in
    searchableAttributes: [`title`, `headings`, `html`, `url`, `tags.name`, `tags`, `authors.name`, `authors`],
    // Add slug to attributes we can filter by in order to find fragments to remove/delete
    attributesForFaceting: [`filterOnly(slug)`]
};

const AlgoliaError = ({code, statusCode, originalError}) => {
    let error = new Error({ message: 'Error processing Algolia' }); // eslint-disable-line

    error.errorType = 'AlgoliaError';
    error.code = code;
    if (statusCode) {
        error.status = statusCode;
    }
    if (originalError.message) {
        error.message = originalError.message;
    }
    error.originalError = originalError;

    return error;
};

class IndexFactory {
    constructor(algoliaSettings = {}) {
        if (!algoliaSettings.apiKey || !algoliaSettings.appId || !algoliaSettings.index || algoliaSettings.index.length < 1) {
            throw new Error('Algolia appId, apiKey, and index is required!'); // eslint-disable-line
        }
        this.index = [];
        this.options = algoliaSettings;

        this.options.indexSettings = algoliaSettings.indexSettings || REQUIRED_SETTINGS;
    }

    initClient() {
        this.client = algoliaSearch(this.options.appId, this.options.apiKey);
    }

    async initIndex() {
        this.initClient();
        this.index = await this.client.initIndex(this.options.index);
    }

    async setSettingsForIndex() {
        try {
            await this.initIndex();
            await this.index.setSettings(this.options.indexSettings);
            return await this.index.getSettings();
        } catch (error) {
            throw AlgoliaError({code: error.code, statusCode: error.status, originalError: error});
        }
    }

    async save(fragments) {
        console.log(`Saving ${fragments.length} fragments to Algolia index...`); // eslint-disable-line no-console
        try {
            await this.index.saveObjects(fragments);
        } catch (error) {
            throw AlgoliaError({code: error.code, statusCode: error.status, originalError: error});
        }
    }

    async delete(slug) {
        console.log(`Removing all fragments with post slug "${slug}"...`); // eslint-disable-line no-console
        try {
            await this.index.deleteBy({filters: `slug:${slug}`});
        } catch (error) {
            throw AlgoliaError({code: error.code, statusCode: error.status, originalError: error});
        }
    }

    async deleteObjects(fragments) {
        console.log(`Deleting ${fragments.length} fragments from Algolia index...`); // eslint-disable-line no-console
        try {
            await this.index.deleteObjects(fragments);
        } catch (error) {
            throw AlgoliaError({code: error.code, statusCode: error.status, originalError: error});
        }
    }
}

module.exports = IndexFactory;
