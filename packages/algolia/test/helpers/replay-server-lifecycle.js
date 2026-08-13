export const stopOwnedServer = async (server, ownedServers) => {
    if (!ownedServers.delete(server)) {
        throw new Error('Refusing to stop an unowned replay server.');
    }

    await new Promise((resolve, reject) => {
        let settled = false;
        const cleanup = () => {
            server.removeListener('exit', handleExit);
            server.removeListener('close', handleExit);
            server.removeListener('error', handleError);
        };
        const settle = (complete, value) => {
            if (settled) {
                return;
            }
            settled = true;
            cleanup();
            complete(value);
        };
        const handleExit = () => settle(resolve);
        const handleError = error => settle(reject, error);

        server.once('exit', handleExit);
        server.once('close', handleExit);
        server.once('error', handleError);

        if (server.exitCode !== null || server.signalCode !== null || settled) {
            settle(resolve);
            return;
        }

        try {
            server.kill('SIGTERM');
        } catch (error) {
            settle(reject, error);
        }
    });
};
