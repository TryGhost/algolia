const errors = require('@tryghost/errors');

const REQUIRED_SLUG_FACET = 'filterOnly(slug)';

module.exports.verifyConfig = ({ghost, algolia}) => {
    if (!ghost || !algolia) {
        throw new errors.BadRequestError({
            message: 'Config has the wrong format. Check `example.json` for reference.'
        });
    }

    // Check for all Ghost keys
    if (!ghost.apiKey || !ghost.apiUrl) {
        throw new errors.BadRequestError({message: 'Ghost apiUrl or apiKey are missing.'});
    }

    // Check for all Ghost keys
    if (!algolia.apiKey || !algolia.appId || !algolia.index) {
        throw new errors.BadRequestError({
            message: 'Algolia index, appId or apiKey are missing.'
        });
    }

    if (algolia.indexSettings && Object.keys(algolia.indexSettings).length < 1) {
        throw new errors.BadRequestError({
            message: 'Algolia indexSettings are empty. Please remove or provide own settings.'
        });
    }

    if (
        algolia.indexSettings &&
        Object.hasOwn(algolia.indexSettings, 'attributesForFaceting') &&
        (!Array.isArray(algolia.indexSettings.attributesForFaceting) ||
            !algolia.indexSettings.attributesForFaceting.includes(REQUIRED_SLUG_FACET))
    ) {
        throw new errors.BadRequestError({
            message:
                'Algolia indexSettings.attributesForFaceting must include filterOnly(slug) for record replacement.'
        });
    }

    return;
};
