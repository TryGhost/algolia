/** Shared request-contract scaffolding for the indexer test files. */

const ALGOLIA_OPTIONS = {
    appId: 'app-id',
    apiKey: 'admin-api-key',
    index: 'help-center'
};

const normalizeRequest = request => {
    const url = new URL(request.url);
    // algoliasearch 5.57+ stamps every request with a randomly generated request-id header,
    // so it cannot be part of a deterministic request contract.
    const headers = {...request.headers};
    delete headers['request-id'];
    return {
        method: request.method,
        origin: url.origin,
        pathname: url.pathname,
        headers,
        body: request.data ? JSON.parse(request.data) : undefined
    };
};

module.exports = {ALGOLIA_OPTIONS, normalizeRequest};
