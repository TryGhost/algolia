const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const Module = require('node:module');
const net = require('node:net');

const requestLogPath = process.env.ALGOLIA_ACCEPTANCE_REQUEST_LOG;
const statePath = process.env.ALGOLIA_ACCEPTANCE_STATE_PATH;
const allowedOrigin = process.env.GHOST_REPLAY_ORIGIN;
const expectedSettings = require('../fixtures/ghost-v6/expected-index-settings.json');

if (!requestLogPath || !allowedOrigin) {
    throw new Error('Acceptance preload requires request logging and a replay origin.');
}

const originalLoad = Module._load;
const parsedAllowedOrigin = new URL(allowedOrigin);
const allowedPort = Number(parsedAllowedOrigin.port);
const settingsPath = '/1/indexes/ghost-content/settings';
const batchPath = '/1/indexes/ghost-content/batch';
const deleteByQueryPath = '/1/indexes/ghost-content/deleteByQuery';
const requiredSlugFacet = 'filterOnly(slug)';
let currentSettings = {...expectedSettings};
let taskId = 0;

const updateState = update => {
    if (!statePath) {
        return;
    }

    const records = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    fs.writeFileSync(statePath, JSON.stringify(update(records)), {encoding: 'utf8'});
};

const networkTarget = (defaultProtocol, input) => {
    if (typeof input === 'string' || input instanceof URL) {
        return new URL(input);
    }

    if (!input || typeof input !== 'object') {
        throw new Error('Network request did not provide a URL.');
    }

    const protocol = input.protocol || defaultProtocol;
    const authority = input.hostname
        ? `${input.hostname}${input.port ? `:${input.port}` : ''}`
        : input.host || `localhost${input.port ? `:${input.port}` : ''}`;
    return new URL(`${protocol}//${authority}${input.path || input.pathname || '/'}`);
};

const effectiveNetworkTarget = (defaultProtocol, input, args) => {
    const target = networkTarget(defaultProtocol, input);
    const options =
        (typeof input === 'string' || input instanceof URL) &&
        args[0] &&
        typeof args[0] === 'object'
            ? args[0]
            : null;

    if (!options) {
        return target;
    }
    if (options.socketPath) {
        throw new Error('HTTP transport denied a Unix socket request.');
    }
    if (options.protocol) {
        target.protocol = options.protocol;
    }
    if (options.host) {
        const authority = new URL(`${target.protocol}//${options.host}`);
        target.hostname = authority.hostname;
        target.port = authority.port;
    }
    if (options.hostname) {
        target.hostname = options.hostname;
    }
    if (options.port !== undefined) {
        target.port = String(options.port);
    }
    return target;
};

const assertAllowedNetworkTarget = (transport, defaultProtocol, input, args = []) => {
    const target = effectiveNetworkTarget(defaultProtocol, input, args);
    if (target.origin !== parsedAllowedOrigin.origin) {
        throw new Error(`${transport} denied non-loopback network request to ${target.origin}.`);
    }
};

const guardRequest = (transport, defaultProtocol, originalRequest) => {
    return function (input, ...args) {
        assertAllowedNetworkTarget(transport, defaultProtocol, input, args);
        return originalRequest.call(this, input, ...args);
    };
};

const socketTarget = args => {
    const [options] = Array.isArray(args[0]) ? args[0] : net._normalizeArgs(args);
    return options.path
        ? {path: options.path}
        : {port: Number(options.port), host: options.host || 'localhost'};
};

const guardSocket = (transport, originalConnect) => {
    return function (...args) {
        const target = socketTarget(args);
        if (target.path) {
            throw new Error(`${transport} denied Unix socket ${target.path}.`);
        }
        if (target.host !== parsedAllowedOrigin.hostname || target.port !== allowedPort) {
            throw new Error(
                `${transport} denied non-loopback socket to ${target.host}:${target.port}.`
            );
        }
        return originalConnect.apply(this, args);
    };
};

http.request = guardRequest('http.request', 'http:', http.request);
http.get = guardRequest('http.get', 'http:', http.get);
https.request = guardRequest('https.request', 'https:', https.request);
https.get = guardRequest('https.get', 'https:', https.get);
net.Socket.prototype.connect = guardSocket('net.Socket.connect', net.Socket.prototype.connect);

if (typeof global.fetch === 'function') {
    const originalFetch = global.fetch;
    global.fetch = function (input, ...args) {
        assertAllowedNetworkTarget('fetch', 'https:', input.url || input);
        return originalFetch.call(this, input, ...args);
    };
}

const responseFor = request => {
    const url = new URL(request.url);
    const hasExpectedHost =
        url.hostname ===
        (request.method === 'GET'
            ? 'acceptance-app-dsn.algolia.net'
            : 'acceptance-app.algolia.net');
    const hasExpectedHeaders =
        request.headers['x-algolia-application-id'] === 'acceptance-app' &&
        request.headers['x-algolia-api-key'] === 'acceptance-admin-key' &&
        request.headers.accept === 'application/json' &&
        request.headers['content-type'] === 'text/plain';

    if (
        ![
            `PUT ${settingsPath}`,
            `GET ${settingsPath}`,
            `POST ${batchPath}`,
            `POST ${deleteByQueryPath}`
        ].includes(`${request.method} ${url.pathname}`) ||
        !hasExpectedHost ||
        !hasExpectedHeaders
    ) {
        return {
            status: 403,
            content: JSON.stringify({
                message: 'Unexpected Algolia request denied by the acceptance test.'
            }),
            isTimedOut: false
        };
    }

    if (request.method === 'GET') {
        return {status: 200, content: JSON.stringify(currentSettings), isTimedOut: false};
    }

    taskId += 1;
    if (url.pathname === settingsPath) {
        currentSettings = {...currentSettings, ...JSON.parse(request.data)};
        return {
            status: 200,
            content: JSON.stringify({
                taskID: taskId,
                updatedAt: '2026-01-01T00:00:00.000Z'
            }),
            isTimedOut: false
        };
    }
    if (url.pathname === deleteByQueryPath) {
        if (!currentSettings.attributesForFaceting?.includes(requiredSlugFacet)) {
            return {
                status: 400,
                content: JSON.stringify({
                    message: 'Attribute slug is not configured for faceting.'
                }),
                isTimedOut: false
            };
        }
        const {filters} = JSON.parse(request.data);
        if (
            typeof filters !== 'string' ||
            !filters.startsWith('slug:') ||
            filters.length === 'slug:'.length
        ) {
            return {
                status: 400,
                content: JSON.stringify({message: `Unsupported delete filter: ${filters}.`}),
                isTimedOut: false
            };
        }
        const slug = filters.slice('slug:'.length);
        updateState(records => records.filter(record => record.slug !== slug));
        return {
            status: 200,
            content: JSON.stringify({
                taskID: taskId,
                updatedAt: '2026-01-01T00:00:00.000Z'
            }),
            isTimedOut: false
        };
    }

    const body = JSON.parse(request.data);
    updateState(records => {
        const recordsById = new Map(records.map(record => [record.objectID, record]));
        for (const entry of body.requests) {
            recordsById.set(entry.body.objectID, entry.body);
        }
        return [...recordsById.values()];
    });
    return {
        status: 200,
        content: JSON.stringify({
            taskID: taskId,
            objectIDs: body.requests.map(entry => entry.body.objectID)
        }),
        isTimedOut: false
    };
};

const createHttpRequester = () => ({
    async send(request) {
        fs.appendFileSync(requestLogPath, `${JSON.stringify(request)}\n`, {encoding: 'utf8'});
        return responseFor(request);
    },
    async destroy() {}
});

Module._load = function (request) {
    if (request === '@algolia/requester-node-http') {
        return {createHttpRequester};
    }

    return originalLoad.apply(this, arguments);
};
