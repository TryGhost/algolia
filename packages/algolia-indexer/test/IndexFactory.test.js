// Switch these lines once there are useful utils
// const testUtils = require('./utils');
require('./utils');
const sinon = require('sinon');

const IndexFactory = require('../');

describe('IndexFactory', function () {
    let sandbox;
    let mockIndex;

    beforeEach(function () {
        sandbox = sinon.createSandbox();

        // Mocking algoliasearch client and index
        mockIndex = {
            setSettings: sandbox.stub(),
            getSettings: sandbox.stub(),
            saveObjects: sandbox.stub(),
            deleteBy: sandbox.stub(),
            deleteObjects: sandbox.stub()
        };
    });

    afterEach(function () {
        sandbox.restore();
    });

    function createMockedAlgoliaIndex(settings) {
        const algoliaIndex = new IndexFactory(settings);

        // Immediately stub the initClient and initIndex methods after instantiation
        sandbox.stub(algoliaIndex, 'initClient').callsFake(function () {
            this.client = {}; // You can mock further if needed
        });

        sandbox.stub(algoliaIndex, 'initIndex').callsFake(async function () {
            this.initClient();
            this.index = mockIndex;
        });

        return algoliaIndex;
    }

    it('throws error when settings are not passed', async function () {
        let algoliaIndex;
        try {
            algoliaIndex = await createMockedAlgoliaIndex();
        } catch (error) {
            should.exist(error);
            should.not.exist(algoliaIndex);
            error.message.should.eql('Algolia appId, apiKey, and index is required!');
        }
    });

    describe('setSettingsForIndex', function () {
        it('updates settings by default', async function () {
            const algoliaIndex = await createMockedAlgoliaIndex({appId: 'test', apiKey: 'test', index: 'ALGOLIA'});

            mockIndex.getSettings.resolves({some: 'settings'}); // Provide a mocked response for getSettings

            const settings = await algoliaIndex.setSettingsForIndex();

            mockIndex.setSettings.should.have.been.called;
            mockIndex.getSettings.should.have.been.called;

            should.exist(settings);
        });

        it('does not update Algolia settings when set to false', async function () {
            const algoliaIndex = await createMockedAlgoliaIndex({appId: 'test', apiKey: 'test', index: 'ALGOLIA'});

            mockIndex.getSettings.resolves({some: 'settings'}); // Provide a mocked response for getSettings

            const settings = await algoliaIndex.setSettingsForIndex({updateSettings: false});

            mockIndex.setSettings.should.have.not.been.called;
            mockIndex.getSettings.should.have.been.called;

            should.exist(settings);
        });

        it('throws AlgoliaError when an error occurs', async function () {
            const algoliaIndex = await createMockedAlgoliaIndex({appId: 'test', apiKey: 'test', index: 'ALGOLIA'});

            mockIndex.getSettings.rejects(new Error('Test Error')); // Simulating an error

            try {
                await algoliaIndex.setSettingsForIndex();
            } catch (error) {
                should.exist(error);
                error.errorType.should.eql('AlgoliaError');
            }
        });
    });

    // TODO: Add tests for the other methods like save, delete, deleteObjects, etc.
});
