#!/usr/bin/env node
const prettyCLI = require('@tryghost/pretty-cli');
const ui = require('@tryghost/pretty-cli').ui;
const fs = require('fs-extra');
const utils = require('../lib/utils');
const {fetchPosts} = require('../lib/fetch-posts');
const GhostContentAPI = require('@tryghost/content-api');
const transforms = require('@tryghost/algolia-fragmenter');
const IndexFactory = require('@tryghost/algolia-indexer');

prettyCLI.preface('Command line utilities to batch index content from Ghost to Algolia');

prettyCLI.command({
    id: 'algolia',
    flags: 'index <pathToConfig>',
    desc: 'Run a batch index of all Ghost posts to Algolia',
    paramsDesc: ['Path to a valid config JSON file'],
    setup: sywac => {
        sywac.boolean('-V --verbose', {
            defaultValue: false,
            desc: 'Show verbose output'
        });
        sywac.array('-s --skip', {
            defaultValue: [],
            desc: 'Comma separated list of post slugs to exclude from indexing'
        });
        sywac.number('-l --limit', {
            desc: 'Fetch one page containing 1 to 100 posts'
        });
        sywac.number('-p --page', {
            desc: 'Select a page; requires --limit'
        });
        sywac.array('-sjs --skipjsonslugs', {
            defaultValue: false,
            desc: 'Exclude post slugs from config JSON file'
        });
        sywac.check((argv, context) => {
            if (
                argv.limit !== undefined &&
                (!Number.isInteger(argv.limit) || argv.limit < 1 || argv.limit > 100)
            ) {
                context.cliMessage('--limit must be an integer from 1 to 100.');
            }

            if (argv.page !== undefined && argv.limit === undefined) {
                context.cliMessage('--page requires --limit.');
            }

            if (argv.page !== undefined && (!Number.isInteger(argv.page) || argv.page < 1)) {
                context.cliMessage('--page must be a positive integer.');
            }
        });
    },
    run: async argv => {
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
            const fetchOptions = {};
            const ghost = new GhostContentAPI({
                url: context.ghost.apiUrl,
                key: context.ghost.apiKey,
                version: 'v6.0'
            });

            if (argv.skip && argv.skip.length > 0) {
                const filterSlugs = argv.skip.join(',');

                fetchOptions.filter = `slug:-[${filterSlugs}]`;
            }

            if (argv.limit !== undefined) {
                fetchOptions.limit = argv.limit;
            }

            ui.log.info(
                `Fetching ${argv.limit === undefined ? 'all' : argv.limit} posts from Ghost...`
            );

            if (argv.page !== undefined) {
                ui.log.info(`...from page #${argv.page}.`);
                fetchOptions.page = argv.page;
            }

            context.posts = await fetchPosts(ghost.posts.browse.bind(ghost.posts), fetchOptions);

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

            context.posts = transforms.transformToAlgoliaObject(
                context.posts,
                context.ignore_slugs
            );

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

            ui.log.ok(
                `${context.fragments.length} Fragments successfully saved to Algolia index in ${Date.now() - timer}ms.`
            );
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
