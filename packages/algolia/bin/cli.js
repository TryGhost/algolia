#!/usr/bin/env node
const prettyCLI = require('@tryghost/pretty-cli');
const ui = require('@tryghost/pretty-cli').ui;

prettyCLI.preface('Command line utilities for migrating content to Ghost.');

prettyCLI.command({
    id: 'algolia',
    flags: 'algolia <pathToConfig>',
    desc: 'Run a batch index of all Ghost posts to Algolia',
    paramsDesc: ['Path to a valid config JSON file'],
    setup: (sywac) => {
        sywac.boolean('-V --verbose', {
            defaultValue: false,
            desc: 'Show verbose output'
        });
    },
    run: async (argv) => {
        let timer = Date.now();
        let context = {errors: []};

        if (argv.verbose) {
            ui.log.info(`Received config file ${argv.pathToConfig}`);
        }

        try {
            // DO STUFF HERE

            if (argv.verbose) {
                ui.log.info('Done', require('util').inspect(context.result.data, false, 2));
            }
        } catch (error) {
            ui.log.info('Done with errors', context.errors);
        }

        // Report success
        ui.log.ok(`Successfully indexed all the things in ${Date.now() - timer}ms.`);
    }
});

prettyCLI.style({
    usageCommandPlaceholder: () => '<source or utility>'
});

prettyCLI.groupOrder([
    'Sources:',
    'Utilities:',
    'Commands:',
    'Arguments:',
    'Required Options:',
    'Options:',
    'Global Options:'
]);

prettyCLI.parseAndExit();
