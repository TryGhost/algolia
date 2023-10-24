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

/**
 * @param {options} options
 * @param {string} options.code
 * @param {number} options.statusCode
 * @param {object} options.originalError
 * @returns {Error}
 */
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

/**
 * @typedef {object} AlgoliaSettings
 * @property {string} apiKey
 * @property {string} appId
 * @property {string} index
 * @property {object} indexSettings
 * @property {string} indexSettings.distinct
 * @property {string} indexSettings.attributeForDistinct
 * @property {string} indexSettings.customRanking
 * @property {string} indexSettings.searchableAttributes
 * @property {string} indexSettings.attributesForFaceting
 */

/**
 * @typedef IIndexFactory
 * @property {() => void} initClient
 * @property {() => Promise<void>} initIndex
 * @property {({updateSettings?: boolean}) => Promise<object>} setSettingsForIndex
 * @property {(fragments: object[]) => Promise<void>} save
 * @property {(slug: string) => Promise<void>} delete
 * @property {(fragments: object[]) => Promise<void>} deleteObjects
 */

/** @implements IIndexFactory */
class IndexFactory {
    /**
     * @param {AlgoliaSettings} algoliaSettings
     */
    constructor(algoliaSettings = {}) {
        if (!algoliaSettings.apiKey || !algoliaSettings.appId || !algoliaSettings.index || algoliaSettings.index.length < 1) {
            throw new Error('Algolia appId, apiKey, and index is required!'); // eslint-disable-line
        }
        this.index = [];
        this.options = algoliaSettings;

        this.options.indexSettings = algoliaSettings.indexSettings || REQUIRED_SETTINGS;
    }

    /**
     * @returns {void}
     */
    initClient() {
        this.client = algoliaSearch(this.options.appId, this.options.apiKey);
    }

    /**
     * @returns {Promise<void>}
     */
    async initIndex() {
        this.initClient();
        this.index = await this.client.initIndex(this.options.index);
    }

    /**
     * @param {object} options
     * @param {boolean?} options.updateSettings
     * @returns {Promise<object>}
     */
    async setSettingsForIndex(options = {}) {
        options.updateSettings = options?.updateSettings ?? true;

        try {
            await this.initIndex();
            if (options.updateSettings) {
                await this.index.setSettings(this.options.indexSettings);
            }
            return await this.index.getSettings();
        } catch (error) {
            throw AlgoliaError({code: error.code, statusCode: error.status, originalError: error});
        }
    }

    /**
     * @param {object[]} fragments
     * @returns {Promise<void>}
     */
    async save(fragments) {
        console.log(`Saving ${fragments.length} fragments to Algolia index...`); // eslint-disable-line no-console
        try {
            await this.index.saveObjects(fragments);
        } catch (error) {
            throw AlgoliaError({code: error.code, statusCode: error.status, originalError: error});
        }
    }

    /**
     * @param {string} slug
     * @returns {Promise<void>}
     */
    async delete(slug) {
        console.log(`Removing all fragments with post slug "${slug}"...`); // eslint-disable-line no-console
        try {
            await this.index.deleteBy({filters: `slug:${slug}`});
        } catch (error) {
            throw AlgoliaError({code: error.code, statusCode: error.status, originalError: error});
        }
    }

    /**
     * @param {object[]} fragments
     * @returns {Promise<void>}
     */
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
