import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const summary = JSON.parse(await readFile('coverage/coverage-summary.json', 'utf8'));
const cliCoverage = summary[`${process.cwd()}/packages/algolia/bin/cli.js`];

assert(cliCoverage, 'Expected the V8 report to include the spawned CLI.');
assert(cliCoverage.lines.covered > 0, 'Expected the spawned CLI to have covered lines.');
assert(cliCoverage.functions.covered > 0, 'Expected the spawned CLI to have covered functions.');
assert(cliCoverage.branches.covered > 0, 'Expected the spawned CLI to have covered branches.');
