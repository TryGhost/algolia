// Keep the default major fixed; users must opt into breaking changes.
export const DEFAULT_RELEASE = '1';
export const CATALOG_URL =
    'https://raw.githubusercontent.com/TryGhost/algolia/refs/heads/aileen/integration-releases/deployment/releases.json';
const MAJOR = /^(0|[1-9]\d*)$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export const validateSelection = (selection: string): void => {
    if (!MAJOR.test(selection) && !VERSION.test(selection)) {
        throw new Error('Choose an integration major or exact stable version.');
    }
};

export const selectRelease = (
    selection: string,
    catalog: unknown
): {version: string; commit: string} => {
    if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
        throw new Error('Invalid integration release catalog.');
    }
    const releases = Object.entries(catalog);
    for (const [version, commit] of releases) {
        if (
            !VERSION.test(version) ||
            typeof commit !== 'string' ||
            !/^[a-f0-9]{40}$/.test(commit)
        ) {
            throw new Error('Release catalog requires stable versions and full commit IDs.');
        }
    }
    const candidates = releases.filter(([version]) =>
        MAJOR.test(selection) ? version.split('.')[0] === selection : version === selection
    );
    candidates.sort(([left], [right]) => {
        const a = left.split('.').map(BigInt);
        const b = right.split('.').map(BigInt);
        for (let part = 0; part < 3; part++) {
            if (a[part] !== b[part]) {
                return a[part] > b[part] ? -1 : 1;
            }
        }
        return 0;
    });
    const selected = candidates[0];
    if (!selected) {
        throw new Error('Unknown integration release. Choose a published major or version.');
    }
    return {version: selected[0], commit: selected[1] as string};
};
