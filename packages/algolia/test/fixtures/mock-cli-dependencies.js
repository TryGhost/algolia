const Module = require('module');

const originalLoad = Module._load;
let browseCount = 0;

class GhostContentAPI {
    constructor(options) {
        process.stdout.write(`GHOST_CLIENT ${JSON.stringify(options)}\n`);

        this.posts = {
            browse: async (params) => {
                browseCount += 1;
                process.stdout.write(`GHOST_BROWSE ${JSON.stringify(params)}\n`);

                const posts = [{id: `post-${browseCount}`}];
                posts.meta = {pagination: {next: browseCount === 1 ? 2 : null}};
                return posts;
            }
        };
    }
}

const transforms = {
    transformToAlgoliaObject: posts => posts,
    fragmentTransformer: (fragments, post) => fragments.concat(post)
};

class IndexFactory {
    async setSettingsForIndex() {}

    async save() {}
}

Module._load = function (request) {
    if (request === '@tryghost/content-api') {
        return GhostContentAPI;
    }

    if (request === '@tryghost/algolia-fragmenter') {
        return transforms;
    }

    if (request === '@tryghost/algolia-indexer') {
        return IndexFactory;
    }

    return originalLoad.apply(this, arguments);
};
