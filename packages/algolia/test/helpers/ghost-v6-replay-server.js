const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const fixtureDirectory = process.env.GHOST_REPLAY_FIXTURE_DIRECTORY;
const requestLogPath = process.env.GHOST_REPLAY_REQUEST_LOG;
const contentApiKey = process.env.GHOST_REPLAY_CONTENT_API_KEY;
const replayMode = process.env.GHOST_REPLAY_MODE;
const replayPlanPath = process.env.GHOST_REPLAY_PLAN_PATH;

if (!process.send || !fixtureDirectory || !requestLogPath || !contentApiKey || !replayMode) {
    throw new Error('Ghost replay server requires IPC and its fixture environment.');
}

const page1 = fs.readFileSync(path.join(fixtureDirectory, 'posts-page-1.json'));
const page2 = fs.readFileSync(path.join(fixtureDirectory, 'posts-page-2.json'));
const page1Data = JSON.parse(page1);
const firstPost = Buffer.from(
    JSON.stringify({
        posts: page1Data.posts.slice(0, 1),
        meta: {
            pagination: {
                page: 1,
                limit: 1,
                pages: 101,
                total: 101,
                next: 2,
                prev: null
            }
        }
    })
);
const replayPlans = {
    automatic: [
        {
            query: {key: contentApiKey, include: 'tags,authors', limit: '100', page: '1'},
            body: page1
        },
        {
            query: {key: contentApiKey, include: 'tags,authors', limit: '100', page: '2'},
            body: page2
        }
    ],
    'limit-one': [
        {query: {key: contentApiKey, include: 'tags,authors', limit: '1'}, body: firstPost}
    ],
    'page-two': [
        {
            query: {key: contentApiKey, include: 'tags,authors', limit: '100', page: '2'},
            body: page2
        }
    ],
    'network-probe': [
        {query: {key: contentApiKey, include: 'tags,authors', limit: '1'}, body: firstPost},
        {query: {key: contentApiKey, include: 'tags,authors', limit: '1'}, body: firstPost},
        {query: {key: contentApiKey, include: 'tags,authors', limit: '1'}, body: firstPost}
    ]
};
const replayPlan = replayPlanPath
    ? JSON.parse(fs.readFileSync(replayPlanPath, 'utf8')).map(entry => ({
          query: entry.query,
          body: Buffer.from(JSON.stringify(entry.body))
      }))
    : replayPlans[replayMode];
let requestIndex = 0;

if (!replayPlan) {
    throw new Error(`Unknown Ghost replay mode: ${replayMode}`);
}

const appendRequest = request => {
    fs.appendFileSync(requestLogPath, `${JSON.stringify(request)}\n`, {encoding: 'utf8'});
};

const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const query = Object.fromEntries(url.searchParams.entries());
    const entry = {
        method: request.method,
        pathname: url.pathname,
        query,
        acceptVersion: request.headers['accept-version'],
        userAgent: request.headers['user-agent']
    };
    appendRequest(entry);

    const expected = replayPlan[requestIndex];
    const valid =
        expected &&
        request.method === 'GET' &&
        url.pathname === '/ghost/api/content/posts/' &&
        url.searchParams.size === Object.keys(expected.query).length &&
        Object.keys(query).sort().join(',') === Object.keys(expected.query).sort().join(',') &&
        Object.entries(expected.query).every(([name, value]) => query[name] === value) &&
        request.headers['accept-version'] === 'v6.0' &&
        request.headers['user-agent'] === 'GhostContentSDK/1.12.10';

    if (!valid) {
        response.writeHead(400, {'content-type': 'application/json'});
        response.end(
            JSON.stringify({errors: [{message: 'Unexpected Ghost Content API request.'}]})
        );
        return;
    }

    requestIndex += 1;
    response.writeHead(200, {'content-type': 'application/json'});
    response.end(expected.body);
});

server.on('error', error => {
    process.send({type: 'error', message: error.message});
});

server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    process.send({type: 'ready', port: address.port});
});

process.on('SIGTERM', () => {
    server.close(() => process.exit(0));
});
