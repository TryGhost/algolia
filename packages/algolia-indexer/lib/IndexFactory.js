const {algoliasearch} = require('algoliasearch');

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
    searchableAttributes: [
        `title`,
        `headings`,
        `html`,
        `url`,
        `tags.name`,
        `tags`,
        `authors.name`,
        `authors`
    ],
    // Add slug to attributes we can filter by in order to find fragments to remove/delete
    attributesForFaceting: [`filterOnly(slug)`]
};

const createIndexAdapter = (client, indexName) => ({
    getSettings: () => client.getSettings({indexName}),
    setSettings: indexSettings => client.setSettings({indexName, indexSettings}),
    saveObjects: objects => client.saveObjects({indexName, objects}),
    deleteBy: deleteByParams => client.deleteBy({indexName, deleteByParams}),
    deleteObjects: objectIDs => client.deleteObjects({indexName, objectIDs})
});

const contentKey = content => content && JSON.stringify([content.id, content.slug]);

const contentMatcher = contents => {
    const bySlug = new Map();
    for (const content of contents) {
        if (
            !content ||
            typeof content.id !== 'string' ||
            !content.id ||
            typeof content.slug !== 'string' ||
            !content.slug
        ) {
            throw new TypeError('Replacement content requires an id and slug.');
        }
        const ids = bySlug.get(content.slug) || [];
        ids.push(content);
        bySlug.set(content.slug, ids);
    }
    return record =>
        typeof record?.objectID === 'string' &&
        (bySlug.get(record.slug) || []).find(
            ({id}) =>
                record.objectID.startsWith(`${id}_`) &&
                /^(0|[1-9]\d*)(?:_([1-9]\d*))?$/.test(record.objectID.slice(id.length + 1))
        );
};

/**
 * @param {options} options
 * @param {string} options.code
 * @param {number} options.statusCode
 * @param {object} options.originalError
 * @returns {Error}
 */
const AlgoliaError = ({code, statusCode, originalError}) => {
    let error = new Error({message: 'Error processing Algolia'});

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
 * @property {() => Promise<object>} prepareIndex
 * @property {(fragments: object[], contents: {id: string, slug: string}[]) => Promise<{cleanupSkipped: boolean}>} replace
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
        if (
            !algoliaSettings.apiKey ||
            !algoliaSettings.appId ||
            !algoliaSettings.index ||
            algoliaSettings.index.length < 1
        ) {
            throw new Error('Algolia appId, apiKey, and index is required!');
        }
        this.index = [];
        this.hasExplicitSettings = Boolean(algoliaSettings.indexSettings);
        this.options = {...algoliaSettings};

        this.options.indexSettings = algoliaSettings.indexSettings || REQUIRED_SETTINGS;
    }

    /**
     * @returns {void}
     */
    initClient() {
        this.client = algoliasearch(this.options.appId, this.options.apiKey);
    }

    /**
     * @returns {Promise<void>}
     */
    async initIndex() {
        this.initClient();
        this.index = createIndexAdapter(this.client, this.options.index);
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
            throw AlgoliaError({
                code: error.code,
                statusCode: error.status,
                originalError: error
            });
        }
    }

    /**
     * Preserve existing settings, initialize a missing index, or apply explicit settings.
     * @returns {Promise<object>}
     */
    async prepareIndex() {
        try {
            await this.initIndex();
            if (!this.hasExplicitSettings) {
                try {
                    return await this.index.getSettings();
                } catch (error) {
                    if (error.status !== 404) {
                        throw error;
                    }
                }
            }
            const {taskID} = await this.index.setSettings(this.options.indexSettings);
            await this.client.waitForTask({indexName: this.options.index, taskID});
            return this.options.indexSettings;
        } catch (error) {
            throw AlgoliaError({code: error.code, statusCode: error.status, originalError: error});
        }
    }

    /**
     * Save complete replacements before removing their stale managed records.
     * Call initIndex() or prepareIndex() first. Every supplied content scope must have
     * replacement records; an empty fragments array makes no requests.
     * @param {object[]} fragments
     * @param {{id: string, slug: string}[]} contents
     * @returns {Promise<{cleanupSkipped: boolean}>} True when browse permission is missing.
     */
    async replace(fragments, contents) {
        if (!Array.isArray(fragments) || !Array.isArray(contents)) {
            throw new TypeError('Replacement requires fragment and content arrays.');
        }
        if (!fragments.length) {
            return {cleanupSkipped: false};
        }
        const matchesContent = contentMatcher(contents);
        const represented = new Set(
            fragments.map(fragment => contentKey(matchesContent(fragment)))
        );
        if (
            represented.has(false) ||
            represented.has(undefined) ||
            contents.some(content => !represented.has(contentKey(content)))
        ) {
            throw new TypeError('Replacement fragments must belong to the supplied content.');
        }
        try {
            const retained = new Set(fragments.map(fragment => fragment.objectID));
            const stale = new Set();
            const indexName = this.options.index;
            let cleanupSkipped = false;
            try {
                await this.client.browseObjects({
                    indexName,
                    browseParams: {attributesToRetrieve: ['objectID', 'slug']},
                    aggregator: ({hits}) => {
                        for (const hit of hits) {
                            if (retained.has(hit.objectID)) {
                                continue;
                            }
                            if (matchesContent(hit)) {
                                stale.add(hit.objectID);
                            }
                        }
                    }
                });
            } catch (error) {
                if (error.status !== 403 && error.status !== 404) {
                    throw error;
                }
                stale.clear();
                cleanupSkipped = error.status === 403;
            }
            await this.client.saveObjects({indexName, objects: fragments, waitForTasks: true});
            if (stale.size) {
                await this.client.deleteObjects({
                    indexName,
                    objectIDs: [...stale],
                    waitForTasks: true
                });
            }
            return {cleanupSkipped};
        } catch (error) {
            throw AlgoliaError({code: error.code, statusCode: error.status, originalError: error});
        }
    }

    /**
     * @param {object[]} fragments
     * @returns {Promise<void>}
     */
    async save(fragments) {
        console.log(`Saving ${fragments.length} fragments to Algolia index...`);
        try {
            await this.index.saveObjects(fragments);
        } catch (error) {
            throw AlgoliaError({
                code: error.code,
                statusCode: error.status,
                originalError: error
            });
        }
    }

    /**
     * @param {string} slug
     * @returns {Promise<void>}
     */
    async delete(slug) {
        console.log(`Removing all fragments with post slug "${slug}"...`);
        try {
            await this.index.deleteBy({filters: `slug:${slug}`});
        } catch (error) {
            throw AlgoliaError({
                code: error.code,
                statusCode: error.status,
                originalError: error
            });
        }
    }

    /**
     * @param {object[]} fragments
     * @returns {Promise<void>}
     */
    async deleteObjects(fragments) {
        console.log(`Deleting ${fragments.length} fragments from Algolia index...`);
        try {
            await this.index.deleteObjects(fragments);
        } catch (error) {
            throw AlgoliaError({
                code: error.code,
                statusCode: error.status,
                originalError: error
            });
        }
    }
}

module.exports = IndexFactory;
