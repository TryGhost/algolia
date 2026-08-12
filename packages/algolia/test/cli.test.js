require('./utils');

const path = require('path');
const {spawnSync} = require('child_process');

const CLI_PATH = path.join(__dirname, '..', 'bin', 'cli.js');
const MISSING_CONFIG_PATH = path.join(__dirname, 'missing-config.json');
const CONFIG_PATH = path.join(__dirname, 'fixtures', 'cli-config.json');
const MOCK_DEPENDENCIES_PATH = path.join(__dirname, 'fixtures', 'mock-cli-dependencies.js');
const INVALID_LIMITS = ['not-a-number', '0', '-1', '1.5', '101'];
const INVALID_PAGES = ['not-a-number', '0', '-1', '1.5'];

const runCli = (args, options = {}) => {
    const env = {...process.env};

    if (options.mockDependencies) {
        env.NODE_OPTIONS = [env.NODE_OPTIONS, `--require=${MOCK_DEPENDENCIES_PATH}`].filter(Boolean).join(' ');
    }

    return spawnSync(process.execPath, [CLI_PATH, ...args], {
        encoding: 'utf8',
        env
    });
};

const getOutput = (result) => {
    return `${result.stdout}${result.stderr}`;
};

const getLoggedValues = (output, marker) => {
    return output
        .split('\n')
        .filter(line => line.startsWith(`${marker} `))
        .map(line => JSON.parse(line.slice(marker.length + 1)));
};

describe('algolia CLI', function () {
    it('rejects page without limit before loading config', function () {
        const result = runCli(['index', MISSING_CONFIG_PATH, '--page', '2']);
        const output = getOutput(result);

        result.status.should.not.eql(0);
        output.should.match(/--page requires --limit/);
        output.should.not.match(/--page must be a positive integer/);
        output.should.not.match(/Failed loading JSON config file/);
    });

    for (const limit of INVALID_LIMITS) {
        it(`rejects limit ${limit} before loading config`, function () {
            const result = runCli(['index', MISSING_CONFIG_PATH, '--limit', limit]);
            const output = getOutput(result);

            result.status.should.not.eql(0);
            output.should.match(/--limit must be an integer from 1 to 100/);
            output.should.not.match(/Failed loading JSON config file/);
        });
    }

    for (const page of INVALID_PAGES) {
        it(`rejects page ${page} before loading config`, function () {
            const result = runCli(['index', MISSING_CONFIG_PATH, '--limit', '100', '--page', page]);
            const output = getOutput(result);

            result.status.should.not.eql(0);
            output.should.match(/--page must be a positive integer/);
            output.should.not.match(/Failed loading JSON config file/);
            output.should.not.match(/GHOST_CLIENT|GHOST_BROWSE/);
        });
    }

    it('indexes every Ghost page through a Ghost 6 client', function () {
        const result = runCli(['index', CONFIG_PATH], {mockDependencies: true});
        const output = getOutput(result);

        result.status.should.eql(0);
        getLoggedValues(output, 'GHOST_CLIENT').should.eql([{
            url: 'https://example.test',
            key: 'test-content-api-key',
            version: 'v6.0'
        }]);
        getLoggedValues(output, 'GHOST_BROWSE').should.eql([
            {limit: 100, page: 1, include: 'tags,authors'},
            {limit: 100, page: 2, include: 'tags,authors'}
        ]);
        output.should.match(/2 Fragments successfully saved/);
    });

    it('accepts the inclusive limit bounds in one-page mode', function () {
        const firstPost = runCli(['index', CONFIG_PATH, '--limit', '1'], {mockDependencies: true});
        const requestedPage = runCli(['index', CONFIG_PATH, '--limit', '100', '--page', '3'], {mockDependencies: true});

        firstPost.status.should.eql(0);
        getLoggedValues(getOutput(firstPost), 'GHOST_BROWSE').should.eql([
            {limit: 1, include: 'tags,authors'}
        ]);
        requestedPage.status.should.eql(0);
        getLoggedValues(getOutput(requestedPage), 'GHOST_BROWSE').should.eql([
            {limit: 100, page: 3, include: 'tags,authors'}
        ]);
    });
});
