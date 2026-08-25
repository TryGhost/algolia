import type {EventEmitter} from 'node:events';

export type OwnedServer = EventEmitter &
    Readonly<{
        exitCode: number | null;
        signalCode: NodeJS.Signals | null;
        kill: (signal?: NodeJS.Signals | number) => boolean | void;
    }>;

export const stopOwnedServer = async (
    server: OwnedServer,
    ownedServers: Set<OwnedServer>
): Promise<void> => {
    if (!ownedServers.delete(server)) {
        throw new Error('Refusing to stop an unowned replay server.');
    }

    await new Promise<void>((resolve, reject) => {
        let settled = false;
        const cleanup = (): void => {
            server.removeListener('exit', handleExit);
            server.removeListener('close', handleExit);
            server.removeListener('error', handleError);
        };
        const settle = (complete: () => void): void => {
            if (settled) {
                return;
            }
            settled = true;
            cleanup();
            complete();
        };
        const handleExit = (): void => settle(resolve);
        const handleError = (error: Error): void => settle(() => reject(error));

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
            settle(() => reject(error));
        }
    });
};
