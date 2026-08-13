import http from 'node:http';
import https from 'node:https';
import Module from 'node:module';
import {createRequire} from 'node:module';
import net from 'node:net';
import tls from 'node:tls';

import {describe, expect, it} from 'vitest';

const require = createRequire(import.meta.url);
const requesterMock = require('./helpers/algolia-requester-register.cjs');

describe('Algolia requester test lifecycle', () => {
    it('denies bypass network calls while installed and restores global hooks', () => {
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
        try {
            requesterMock.install();
            for (const hook of [
                Module._load,
                http.request,
                http.get,
                https.request,
                https.get,
                net.connect,
                net.createConnection,
                net.Socket.prototype.connect,
                tls.connect,
                global.fetch
            ]) {
                expect(Object.values(originals)).not.toContain(hook);
            }
            expect(() => http.request('http://example.com')).toThrow(
                'denied an unexpected network request'
            );
            expect(() => https.get('https://example.com')).toThrow(
                'denied an unexpected network request'
            );
            expect(() => net.connect(443, 'example.com')).toThrow(
                'denied an unexpected network request'
            );
            expect(() => tls.connect(443, 'example.com')).toThrow(
                'denied an unexpected network request'
            );
            expect(() => global.fetch('https://example.com')).toThrow(
                'denied an unexpected network request'
            );
        } finally {
            requesterMock.restore();
        }

        expect(Module._load).toBe(originals.load);
        expect(http.request).toBe(originals.httpRequest);
        expect(http.get).toBe(originals.httpGet);
        expect(https.request).toBe(originals.httpsRequest);
        expect(https.get).toBe(originals.httpsGet);
        expect(net.connect).toBe(originals.netConnect);
        expect(net.createConnection).toBe(originals.netCreateConnection);
        expect(net.Socket.prototype.connect).toBe(originals.socketConnect);
        expect(tls.connect).toBe(originals.tlsConnect);
        expect(global.fetch).toBe(originals.fetch);
    });
});
