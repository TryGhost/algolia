import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import IndexFactory from '../index.js';

describe('IndexFactory', function () {
    let mockIndex;

    beforeEach(function () {
        // Mocking algoliasearch client and index
        mockIndex = {
            setSettings: vi.fn(),
            getSettings: vi.fn(),
            saveObjects: vi.fn(),
            deleteBy: vi.fn(),
            deleteObjects: vi.fn()
        };
    });

    afterEach(function () {
        vi.restoreAllMocks();
    });

    function createMockedAlgoliaIndex(settings) {
        const algoliaIndex = new IndexFactory(settings);

        // Immediately stub the initClient and initIndex methods after instantiation
        vi.spyOn(algoliaIndex, 'initClient').mockImplementation(function () {
            this.client = {}; // You can mock further if needed
        });

        vi.spyOn(algoliaIndex, 'initIndex').mockImplementation(async function () {
            this.initClient();
            this.index = mockIndex;
        });

        return algoliaIndex;
    }

    it('throws error when settings are not passed', function () {
        try {
            createMockedAlgoliaIndex();
            throw new Error('Expected IndexFactory construction to fail.');
        } catch (error) {
            expect(error.message).toBe('Algolia appId, apiKey, and index is required!');
        }
    });

    describe('setSettingsForIndex', function () {
        it('updates settings by default', async function () {
            const algoliaIndex = await createMockedAlgoliaIndex({appId: 'test', apiKey: 'test', index: 'ALGOLIA'});

            mockIndex.getSettings.mockResolvedValue({some: 'settings'}); // Provide a mocked response for getSettings

            const settings = await algoliaIndex.setSettingsForIndex();

            expect(mockIndex.setSettings).toHaveBeenCalled();
            expect(mockIndex.getSettings).toHaveBeenCalled();

            expect(settings).not.toBeNull();
            expect(settings).toEqual({some: 'settings'});
        });

        it('does not update Algolia settings when set to false', async function () {
            const algoliaIndex = await createMockedAlgoliaIndex({appId: 'test', apiKey: 'test', index: 'ALGOLIA'});

            mockIndex.getSettings.mockResolvedValue({some: 'settings'}); // Provide a mocked response for getSettings

            const settings = await algoliaIndex.setSettingsForIndex({updateSettings: false});

            expect(mockIndex.setSettings).not.toHaveBeenCalled();
            expect(mockIndex.getSettings).toHaveBeenCalled();

            expect(settings).not.toBeNull();
            expect(settings).toEqual({some: 'settings'});
        });

        it('throws AlgoliaError when an error occurs', async function () {
            const algoliaIndex = await createMockedAlgoliaIndex({appId: 'test', apiKey: 'test', index: 'ALGOLIA'});

            mockIndex.getSettings.mockRejectedValue(new Error('Test Error')); // Simulating an error

            await expect(algoliaIndex.setSettingsForIndex()).rejects.toMatchObject({
                errorType: 'AlgoliaError'
            });
        });
    });

    // TODO: Add tests for the other methods like save, delete, deleteObjects, etc.
});
