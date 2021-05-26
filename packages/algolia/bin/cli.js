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
        sywac.array('-s --skip', {
            defaultValue: [],
            desc: 'Comma separated list of post slugs to exclude from indexing'
        });
        sywac.number('-l --limit', {
            desc: 'Amount of posts we want to fetch from Ghost'
        });
        sywac.number('-p --page', {
            desc: 'Use page to navigate through posts when setting a limit'
        });
        sywac.array('-sjs --skipjsonslugs', {
            defaultValue: false,
            desc: 'Exclude post slugs from config JSON file'
        });
    },
    run: async (argv) => {
        const mainTimer = Date.now();
        let context = {errors: [], posts: []};

        if (argv.verbose) {
            ui.log.info(`Received config file ${argv.pathToConfig}`);
        }

        // 1. Read the config files and verify everything
        try {
            const config = await fs.readJSON(argv.pathToConfig);
            context = Object.assign(context, config);

            utils.verifyConfig(context);
        } catch (error) {
            context.errors.push(error);
            return ui.log.error('Failed loading JSON config file:', context.errors);
        }

        // 2. Fetch all posts from the Ghost instance
        try {
            const timer = Date.now();
            const params = {limit: 'all', include: 'tags,authors'};
            const ghost = new GhostContentAPI({
                url: context.ghost.apiUrl,
                key: context.ghost.apiKey,
                version: 'canary'
            });

            if (argv.skip && argv.skip.length > 0) {
                const filterSlugs = argv.skip.join(',');

                params.filter = `slug:-[${filterSlugs}]`;
            }

            if (argv.limit) {
                params.limit = argv.limit;
            }

            ui.log.info(`Fetching ${params.limit} posts from Ghost...`);

            if (argv.page) {
                ui.log.info(`...from page #${argv.page}.`);
                params.page = argv.page;
            }

            context.posts = await ghost.posts.browse(params);

            ui.log.info(`Done fetching posts in ${Date.now() - timer}ms.`);
        } catch (error) {
            context.errors.push(error);
            return ui.log.error('Could not fetch posts from Ghost', context.errors);
        }

        // 3. Transform into Algolia objects and create fragments
        try {
            const timer = Date.now();

            ui.log.info('Transforming and fragmenting posts...');

            if (argv.skipjsonslugs) {
                const ignoreSlugsCount = context.ignore_slugs.length;

                ui.log.info(`Skipping the ${ignoreSlugsCount} slugs in ${argv.pathToConfig}`);
            }

            context.posts = transforms.transformToAlgoliaObject(context.posts, context.ignore_slugs);

            context.fragments = context.posts.reduce(transforms.fragmentTransformer, []);

            // we don't need the posts anymore
            delete context.posts;

            ui.log.info(`Done transforming and fragmenting posts in ${Date.now() - timer}ms.`);
        } catch (error) {
            context.errors.push(error);
            return ui.log.error('Error fragmenting posts', context.errors);
        }

        // 4. Save to Algolia
        try {
            let timer = Date.now();

            ui.log.info('Connecting to Algolia index and setting it up...');

            // Instanciate the Algolia indexer, which connects to Algolia and
            const index = new IndexFactory(context.algolia);
            // sets up the settings for the index.
            await index.setSettingsForIndex();

            ui.log.info(`Done setting up Alolia index in ${Date.now() - timer}ms.`);

            timer = Date.now();

            ui.log.info('Saving fragments to Algolia...');

            await index.save(context.fragments);

            ui.log.ok(`${context.fragments.length} Fragments successfully saved to Algolia index in ${Date.now() - timer}ms.`);
        } catch (error) {
            context.errors.push(error);
            return ui.log.error('Error saving fragments', context.errors);
        }

        // Report success
        ui.log.ok(`Successfully indexed all the things in ${Date.now() - mainTimer}ms.`);
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
