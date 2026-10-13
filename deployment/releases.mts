import {major, prerelease, rcompare, valid} from 'semver';

// Keep the default major fixed; users must opt into breaking changes.
export const DEFAULT_RELEASE = '0';
export const RELEASES_URL = 'https://api.github.com/repos/TryGhost/algolia/releases';
const MAJOR = /^(0|[1-9]\d*)$/;
const COMMIT = /^[a-f0-9]{40}$/;
const TAG_PREFIX = '@tryghost/algolia-netlify@';
const MANIFEST = 'netlify-release.json';
const exactVersion = (value: string): boolean => valid(value) === value && !value.includes('+');
const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

export const validateSelection = (selection: string): void => {
    if (!MAJOR.test(selection) && !exactVersion(selection)) {
        throw new Error('Choose an integration major or exact version.');
    }
};

const selectedVersion = (selection: string, versions: string[]): string => {
    const selected = versions
        .filter(version =>
            MAJOR.test(selection)
                ? prerelease(version) === null && String(major(version)) === selection
                : version === selection
        )
        .toSorted(rcompare)[0];
    if (!selected) {
        throw new Error('Unknown integration release. Choose a published major or version.');
    }
    return selected;
};

export const selectRelease = (
    selection: string,
    catalog: unknown
): {version: string; commit: string} => {
    if (!isRecord(catalog)) {
        throw new Error('Invalid integration release catalog.');
    }
    for (const [version, commit] of Object.entries(catalog)) {
        if (!exactVersion(version) || typeof commit !== 'string' || !COMMIT.test(commit)) {
            throw new Error('Release catalog requires exact versions and full commit IDs.');
        }
    }
    const version = selectedVersion(selection, Object.keys(catalog));
    return {version, commit: catalog[version] as string};
};

const requestJson = async (url: URL, redirect: RequestRedirect = 'error') => {
    try {
        const response = await fetch(url, {
            signal: AbortSignal.timeout(15000),
            cache: 'no-store',
            redirect,
            headers: {
                Accept: 'application/vnd.github+json',
                ...(process.env.GITHUB_TOKEN && url.origin === 'https://api.github.com'
                    ? {Authorization: `Bearer ${process.env.GITHUB_TOKEN}`}
                    : {})
            }
        });
        if (!response.ok) {
            throw new Error('Request failed');
        }
        return {
            body: (await response.json()) as unknown,
            next: /rel="next"/.test(response.headers.get('link') ?? '')
        };
    } catch {
        throw new Error('Could not load the integration release manifest. Retry the build.');
    }
};

const publishedReleases = async (endpoint: URL): Promise<Map<string, Record<string, unknown>>> => {
    const candidates = new Map<string, Record<string, unknown>>();
    for (let page = 1; ; page++) {
        if (page > 100) {
            throw new Error('Integration release pagination exceeded its limit.');
        }
        const url = new URL(endpoint);
        url.searchParams.set('per_page', '100');
        url.searchParams.set('page', String(page));
        const {body, next} = await requestJson(url);
        if (!Array.isArray(body)) {
            throw new Error('Invalid GitHub integration releases response.');
        }
        for (const release of body) {
            if (
                !isRecord(release) ||
                release.draft !== false ||
                typeof release.tag_name !== 'string' ||
                !release.tag_name.startsWith(TAG_PREFIX)
            ) {
                continue;
            }
            const version = release.tag_name.slice(TAG_PREFIX.length);
            if (!exactVersion(version) || release.prerelease !== (prerelease(version) !== null)) {
                continue;
            }
            if (candidates.has(version)) {
                throw new Error('Duplicate integration release version.');
            }
            candidates.set(version, release);
        }
        if (!next) {
            break;
        }
    }
    return candidates;
};

const manifestUrl = (release: Record<string, unknown>, tag: string, endpoint: URL): URL => {
    const assets = Array.isArray(release.assets)
        ? release.assets.filter(asset => isRecord(asset) && asset.name === MANIFEST)
        : [];
    if (assets.length !== 1) {
        throw new Error('Invalid integration release manifest metadata.');
    }
    const asset = assets[0] as Record<string, unknown>;
    // The alternate origin is restricted to loopback for offline acceptance tests.
    const assetOrigin =
        endpoint.protocol === 'http:' && endpoint.hostname === '127.0.0.1'
            ? endpoint.origin
            : 'https://github.com';
    let assetUrl: URL;
    try {
        if (typeof asset.browser_download_url !== 'string') {
            throw new Error('Missing URL');
        }
        assetUrl = new URL(asset.browser_download_url);
        const expectedPath = `/TryGhost/algolia/releases/download/${tag}/${MANIFEST}`;
        if (
            assetUrl.origin !== assetOrigin ||
            assetUrl.username ||
            assetUrl.password ||
            assetUrl.search ||
            assetUrl.hash ||
            decodeURIComponent(assetUrl.pathname) !== expectedPath
        ) {
            throw new Error('Unexpected URL');
        }
    } catch {
        throw new Error('Invalid integration release manifest URL.');
    }
    return assetUrl;
};

/** Discover published package releases; the selected release must have a valid manifest. */
export const discoverRelease = async (
    selection: string,
    releasesUrl = RELEASES_URL
): Promise<{version: string; commit: string}> => {
    const endpoint = new URL(releasesUrl);
    const candidates = await publishedReleases(endpoint);
    const version = selectedVersion(selection, [...candidates.keys()]);
    const tag = TAG_PREFIX + version;
    const assetUrl = manifestUrl(candidates.get(version)!, tag, endpoint);
    const commitUrl = new URL(
        `/repos/TryGhost/algolia/commits/${encodeURIComponent(tag)}`,
        endpoint.origin
    );
    const {body: taggedCommit} = await requestJson(commitUrl);
    if (
        !isRecord(taggedCommit) ||
        typeof taggedCommit.sha !== 'string' ||
        !COMMIT.test(taggedCommit.sha)
    ) {
        throw new Error('Invalid integration release manifest tag commit.');
    }
    const {body: manifest} = await requestJson(assetUrl, 'follow');
    if (
        !isRecord(manifest) ||
        manifest.version !== version ||
        manifest.commit !== taggedCommit.sha
    ) {
        throw new Error('Invalid integration release manifest contents.');
    }
    return {version, commit: taggedCommit.sha};
};
