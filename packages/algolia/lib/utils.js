module.exports.verifyConfig = ({ghost, algolia}) => {
    if (!ghost || !algolia) {
        throw new Error('Config has the wrong format. Check `example.json` for reference.');
    }

    // Check for all Ghost keys
    if (!ghost.apiKey || !ghost.apiUrl) {
        throw new Error('Ghost apiUrl or apiKey are missing.');
    }

    // Check for all Ghost keys
    if (!algolia.apiKey || !algolia.appId || !algolia.index) {
        throw new Error('Algolia index, appId or apiKey are missing.');
    }

    if (algolia.indexSettings && Object.keys(algolia.indexSettings) < 1) {
        throw new Error('Algolia indexSettings are empty. Please remove or provide own settings.');
    }

    return;
};
