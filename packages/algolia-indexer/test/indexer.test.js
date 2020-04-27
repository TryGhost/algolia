// Switch these lines once there are useful utils
// const testUtils = require('./utils');
require('./utils');

const IndexFactory = require('../');

describe('IndexFactory', function () {
    it('throws error when settings are not passed', async function () {
        let algoliaIndex;
        try {
            algoliaIndex = new IndexFactory();
        } catch (error) {
            should.exist(error);
            should.not.exist(algoliaIndex);
            error.message.should.eql('Algolia appId, apiKey, and index is required!');
        }
    });

    // TODO: mock algoliasearch
    it.skip('inits a client', async function () {
        const algoliaIndex = new IndexFactory({appId: '', apiKey: '', index: ''});

        try {
            const settings = await algoliaIndex.setSettingsForIndex();
            should.exist(settings);
        } catch (error) {
            should.not.exist(error);
        }
    });
});
