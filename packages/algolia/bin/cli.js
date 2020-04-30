#!/usr/bin/env node
const prettyCLI = require('@tryghost/pretty-cli');
const ui = require('@tryghost/pretty-cli').ui;
const fs = require('fs-extra');
const utils = require('../lib/utils');
const GhostContentAPI = require('@tryghost/content-api');
const transforms = require('@tryghost/algolia-fragmenter');
const IndexFactory = require('@tryghost/algolia-indexer');

prettyCLI.preface('Command line utilities to batch index content from Ghost to Algolia');

prettyCLI.command({
    id: 'algolia',
    flags: 'index <pathToConfig>',
    desc: 'Run a batch index of all Ghost posts to Algolia',
    paramsDesc: ['Path to a valid config JSON file'],
    setup: (sywac) => {
        sywac.boolean('-V --verbose', {
            defaultValue: false,
            desc: 'Show verbose output'
        });
    },
    run: async (argv) => {
        let posts = [];
        const timer = Date.now();
        let context = {errors: []};

        if (argv.verbose) {
            ui.log.info(`Received config file ${argv.pathToConfig}`);
        }

        try {
            // 1. Read the config files and verify everything
            const config = await fs.readJSON(argv.pathToConfig);
            context = Object.assign(context, config);
            utils.verifyConfig(context);
        } catch (error) {
            context.errors.push(error);
            return ui.log.info('Failed loading JSON config file:', context.errors);
        }

        try {
            // 2. Fetch all posts from the Ghost instance
            const ghost = new GhostContentAPI({
                url: context.ghost.apiUrl,
                key: context.ghost.apiKey,
                version: 'v3'
            });

            // TODO: This should be done in batches of 100 or so for performance reasons
            // // Get pagination information
            // const {meta} = await ghost.posts.browse({limit: 1});

            // // With the total on hand, calculate the amount of times we have to
            // // fetch from the API
            // const {total} = meta.pagination;
            // const calls = Math.ceil(parseInt(total) / 100);
            console.time('Ghost API fetch'); // eslint-disable-line no-console
            posts = await ghost.posts.browse({limit: 'all', include: 'tags,authors'});
            console.timeEnd('Ghost API fetch'); // eslint-disable-line no-console
        } catch (error) {
            context.errors.push(error);
            return ui.log.warn('Could not fetch posts from Ghost', context.errors);
        }

        try {
            // 3. Run the fragmenter
            context.posts = [];
            // TODO: make this a util
            posts.map((post) => {
                // Define the properties we need for Algolia
                // TODO: make this a custom setting
                const algoliaPost = {
                    objectID: post.id,
                    slug: post.slug,
                    url: post.url,
                    html: post.html,
                    image: post.feature_image,
                    title: post.title,
                    tags: [],
                    authors: []
                };

                post.tags.forEach((tag) => {
                    algoliaPost.tags.push({name: tag.name, slug: tag.slug});
                });

                post.authors.forEach((author) => {
                    algoliaPost.authors.push({name: author.name, slug: author.slug});
                });

                context.posts.push(algoliaPost);
            });

            // Fragmenter needs an Array to reduce
            context.fragments = context.posts.reduce(transforms.fragmentTransformer, []);
        } catch (error) {
            context.errors.push(error);
            return ui.log.warn('Error fragmenting posts', context.errors);
        }

        try {
            // 4. Save to Algolia

            // Instanciate the Algolia indexer, which connects to Algolia and
            // sets up the settings for the index.
            const index = new IndexFactory(context.algolia);
            await index.setSettingsForIndex();
            await index.save(context.fragments);
            ui.log.ok(`${context.fragments.length} Fragments successfully saved to Algolia index`);
        } catch (error) {
            context.errors.push(error);
            return ui.log.warn('Error saving fragments', context.errors);
        }

        // Report success
        ui.log.ok(`Successfully indexed all the things in ${Date.now() - timer}ms.`);
    }
});

prettyCLI.style({
    usageCommandPlaceholder: () => '<source or utility>'
});

prettyCLI.groupOrder([
    'Commands:',
    'Arguments:',
    'Required Options:',
    'Options:',
    'Global Options:'
]);

prettyCLI.parseAndExit();
