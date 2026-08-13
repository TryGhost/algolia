import {describe, expect, it} from 'vitest';

import {EventEmitter} from 'node:events';

import {stopOwnedServer} from './helpers/replay-server-lifecycle.js';

describe('replay server lifecycle', function () {
    it('finishes when an owned server closes without an exit event', async function () {
        const server = new EventEmitter();
        server.exitCode = null;
        server.signalCode = null;
        let killCalls = 0;
        server.kill = () => {
            killCalls += 1;
            server.emit('close', 0, 'SIGTERM');
        };

        const completion = stopOwnedServer(server, new Set([server]));
        const deadline = new Promise((resolve, reject) => {
            setTimeout(() => reject(new Error('Stopping the replay server did not finish.')), 50);
        });

        await expect(Promise.race([completion, deadline])).resolves.toBeUndefined();
        expect(killCalls).toBe(1);
        expect(server.listenerCount('exit')).toBe(0);
        expect(server.listenerCount('error')).toBe(0);
        expect(server.listenerCount('close')).toBe(0);
    });

    it('finishes when an owned server exits while its state is being checked', async function () {
        const server = new EventEmitter();
        let killCalls = 0;
        Object.defineProperties(server, {
            exitCode: {
                get() {
                    return null;
                }
            },
            signalCode: {
                get() {
                    server.emit('exit', 0, null);
                    return null;
                }
            }
        });
        server.kill = () => {
            killCalls += 1;
        };

        const completion = stopOwnedServer(server, new Set([server]));
        const deadline = new Promise((resolve, reject) => {
            setTimeout(() => reject(new Error('Stopping the replay server did not finish.')), 50);
        });

        await expect(Promise.race([completion, deadline])).resolves.toBeUndefined();
        expect(killCalls).toBe(0);
        expect(server.listenerCount('exit')).toBe(0);
        expect(server.listenerCount('error')).toBe(0);
        expect(server.listenerCount('close')).toBe(0);
    });
});
