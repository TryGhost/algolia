import IndexFactory from '@tryghost/algolia-indexer';
import {
    createAlgoliaRecords,
    type ContentProjection,
    type CreateAlgoliaRecordsOptions
} from '@tryghost/algolia-fragmenter';
import 'algoliasearch';

const recordOptions = (): CreateAlgoliaRecordsOptions => {
    const configured = process.env.ALGOLIA_CONTENT_PROJECTION;
    if (configured === undefined) {
        return {};
    }

    try {
        // The fragmenter's public operation validates this untrusted JSON before use.
        const contentProjection = JSON.parse(configured) as ContentProjection;
        return {contentProjection};
    } catch {
        throw new Error('ALGOLIA_CONTENT_PROJECTION must contain valid JSON.');
    }
};

const transforms = {createAlgoliaRecords};

export {IndexFactory, transforms, recordOptions};
