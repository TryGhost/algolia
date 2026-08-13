const http = require('node:http');
const https = require('node:https');
const Module = require('node:module');
const net = require('node:net');
const tls = require('node:tls');

const originals = {
    load: Module._load,
    httpRequest: http.request,
    httpGet: http.get,
    httpsRequest: https.request,
    httpsGet: https.get,
    netConnect: net.connect,
    netCreateConnection: net.createConnection,
    socketConnect: net.Socket.prototype.connect,
    tlsConnect: tls.connect,
    fetch: global.fetch
};
const state = {failureAt: 0, installed: false, requests: []};
const denyNetwork = transport => () => {
    throw new Error(`${transport} denied an unexpected network request.`);
};

const responseFor = (request, requestNumber) => {
    const pathname = new URL(request.url).pathname;
    if (request.method === 'GET' && pathname.endsWith('/settings')) {
        return {
            status: 200,
            content: JSON.stringify({
                distinct: true,
                attributeForDistinct: 'slug',
                customRanking: ['desc(customRanking.heading)', 'asc(customRanking.position)'],
                searchableAttributes: [
                    'title',
                    'headings',
                    'html',
                    'url',
                    'tags.name',
                    'tags',
                    'authors.name',
                    'authors'
                ],
                attributesForFaceting: ['filterOnly(slug)']
            }),
            isTimedOut: false
        };
    }
    return {
        status: 200,
        content: JSON.stringify({taskID: requestNumber, objectIDs: []}),
        isTimedOut: false
    };
};

const createHttpRequester = () => ({
    async send(request) {
        state.requests.push(structuredClone(request));
        const requestNumber = state.requests.length;
        if (requestNumber === state.failureAt) {
            throw new Error('Algolia transport failed');
        }
        return responseFor(request, requestNumber);
    },
    async destroy() {}
});

const mockedLoad = function (request) {
    if (request === '@algolia/requester-node-http') {
        return {createHttpRequester};
    }
    return originals.load.apply(this, arguments);
};

const install = () => {
    if (state.installed) {
        return;
    }
    state.installed = true;
    Module._load = mockedLoad;
    http.request = denyNetwork('http.request');
    http.get = denyNetwork('http.get');
    https.request = denyNetwork('https.request');
    https.get = denyNetwork('https.get');
    net.connect = denyNetwork('net.connect');
    net.createConnection = denyNetwork('net.createConnection');
    net.Socket.prototype.connect = denyNetwork('net.Socket.connect');
    tls.connect = denyNetwork('tls.connect');
    global.fetch = denyNetwork('fetch');
};

const restore = () => {
    Module._load = originals.load;
    http.request = originals.httpRequest;
    http.get = originals.httpGet;
    https.request = originals.httpsRequest;
    https.get = originals.httpsGet;
    net.connect = originals.netConnect;
    net.createConnection = originals.netCreateConnection;
    net.Socket.prototype.connect = originals.socketConnect;
    tls.connect = originals.tlsConnect;
    global.fetch = originals.fetch;
    state.installed = false;
};

module.exports = {
    install,
    restore,
    reset(failureAt = 0) {
        state.failureAt = failureAt;
        state.requests.length = 0;
    },
    requests() {
        return structuredClone(state.requests);
    },
    isInstalled() {
        return state.installed;
    }
};
