const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const tls = require('node:tls');

const replayOrigin = process.env.GHOST_REPLAY_ORIGIN;
const contentApiKey = process.env.GHOST_REPLAY_CONTENT_API_KEY;

if (!replayOrigin || !contentApiKey) {
    throw new Error('Network denial probe requires its replay environment.');
}

const ghostUrl = `${replayOrigin}/ghost/api/content/posts/?key=${contentApiKey}&include=tags,authors&limit=1`;
const headers = {
    'accept-version': 'v6.0',
    'user-agent': 'GhostContentSDK/1.12.10'
};

const readWithHttp = () =>
    new Promise((resolve, reject) => {
        const request = http.get(ghostUrl, {headers}, response => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () =>
                resolve({
                    status: response.statusCode,
                    posts: JSON.parse(Buffer.concat(chunks)).posts.length
                })
            );
        });
        request.on('error', reject);
    });

const readWithNet = () =>
    new Promise((resolve, reject) => {
        const target = new URL(replayOrigin);
        const socket = net.connect(Number(target.port), target.hostname);
        const chunks = [];
        socket.on('connect', () => {
            socket.write(
                [
                    `GET /ghost/api/content/posts/?key=${contentApiKey}&include=tags,authors&limit=1 HTTP/1.1`,
                    `Host: ${target.host}`,
                    'Accept-Version: v6.0',
                    'User-Agent: GhostContentSDK/1.12.10',
                    'Connection: close',
                    '',
                    ''
                ].join('\r\n')
            );
        });
        socket.on('data', chunk => chunks.push(chunk));
        socket.on('end', () => {
            const response = Buffer.concat(chunks);
            const separator = response.indexOf('\r\n\r\n');
            const responseHead = response.subarray(0, separator).toString('utf8');
            const chunkedBody = response.subarray(separator + 4);
            const bodyChunks = [];
            let cursor = 0;
            while (cursor < chunkedBody.length) {
                const lineEnd = chunkedBody.indexOf('\r\n', cursor);
                const size = Number.parseInt(
                    chunkedBody.subarray(cursor, lineEnd).toString('ascii'),
                    16
                );
                if (size === 0) {
                    break;
                }
                cursor = lineEnd + 2;
                bodyChunks.push(chunkedBody.subarray(cursor, cursor + size));
                cursor += size + 2;
            }
            resolve({
                status: Number(responseHead.match(/^HTTP\/1\.1 (\d{3})/u)[1]),
                posts: JSON.parse(Buffer.concat(bodyChunks)).posts.length
            });
        });
        socket.on('error', reject);
    });

const expectDenied = async (name, start) => {
    try {
        const result = start();
        if (result && typeof result.then === 'function') {
            await result;
        } else if (result && typeof result.destroy === 'function') {
            result.destroy();
        }
    } catch (error) {
        if (
            !/denied (?:non-loopback (?:network request|socket)|Unix socket)/u.test(error.message)
        ) {
            throw error;
        }
        return name;
    }

    throw new Error(`${name} unexpectedly allowed an external request.`);
};

const main = async () => {
    const httpResult = await readWithHttp();
    const fetchResponse = await fetch(ghostUrl, {headers});
    const fetchResult = {
        status: fetchResponse.status,
        posts: (await fetchResponse.json()).posts.length
    };
    const netResult = await readWithNet();
    const denied = await Promise.all([
        expectDenied('http.request', () => http.request('http://example.invalid/')),
        expectDenied('http.get', () => http.get('http://example.invalid/')),
        expectDenied('http.get URL', () => http.get(new URL('http://example.invalid/'))),
        expectDenied('http.request options', () =>
            http.request({protocol: 'http:', hostname: 'example.invalid', path: '/'})
        ),
        expectDenied('http.get hostname override', () =>
            http.get(replayOrigin, {hostname: 'example.invalid'})
        ),
        expectDenied('http.get port override', () => http.get(replayOrigin, {port: 80})),
        expectDenied('http.get protocol override', () =>
            http.get(replayOrigin, {protocol: 'https:'})
        ),
        expectDenied('https.request', () => https.request('https://example.invalid/')),
        expectDenied('https.get', () => https.get('https://example.invalid/')),
        expectDenied('https.get URL', () => https.get(new URL('https://example.invalid/'))),
        expectDenied('https.request options', () =>
            https.request({protocol: 'https:', hostname: 'example.invalid', path: '/'})
        ),
        expectDenied('fetch', () => fetch('https://example.invalid/')),
        expectDenied('fetch Request', () => fetch(new Request('https://example.invalid/'))),
        expectDenied('net.connect', () => net.connect(443, 'example.invalid')),
        expectDenied('net.createConnection', () =>
            net.createConnection({port: 443, host: 'example.invalid'})
        ),
        expectDenied('net.Socket.connect', () =>
            new net.Socket().connect({host: 'example.invalid', port: 443})
        ),
        expectDenied('net.Socket.connect path', () =>
            new net.Socket().connect({path: '/tmp/algolia-network-denial-probe.sock'})
        ),
        expectDenied('tls.connect', () => tls.connect(443, 'example.invalid')),
        expectDenied('tls.TLSSocket.connect', () =>
            new tls.TLSSocket(new net.Socket()).connect({host: 'example.invalid', port: 443})
        )
    ]);

    process.stdout.write(`${JSON.stringify({httpResult, fetchResult, netResult, denied})}\n`);
};

main().catch(error => {
    process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
});
