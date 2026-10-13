import path from 'node:path';
import {fileURLToPath} from 'node:url';

const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const PR_CHANNEL = /^pr-([1-9]\d*)$/;

export const validateReleaseChannel = (channel: string): void => {
    if (channel !== '' && !PR_CHANNEL.test(channel)) {
        throw new Error('Prerelease tag must be pr- followed by a pull request number.');
    }
};

export const validateReleaseVersion = (version: string, channel: string): boolean => {
    validateReleaseChannel(channel);
    if (channel === '') {
        if (!STABLE_VERSION.test(version)) {
            throw new Error('Netlify promotion requires a stable package version.');
        }
        return false;
    }
    const [base, prerelease] = version.split('-');
    const pullRequest = channel.slice(3);
    if (
        !STABLE_VERSION.test(base) ||
        !new RegExp(`^pr\\.${pullRequest}\\.[1-9]\\d*$`).test(prerelease ?? '') ||
        version !== `${base}-${prerelease}`
    ) {
        throw new Error(
            `Every package in ${channel} must use a matching prerelease version, such as 0.4.7-pr.${pullRequest}.1.`
        );
    }
    return true;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const channel = process.env.PRERELEASE_TAG ?? '';
        validateReleaseChannel(channel);
        if (process.argv[2] !== undefined) {
            validateReleaseVersion(process.argv[2], channel);
        }
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    }
}
