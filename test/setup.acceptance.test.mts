import {afterEach, expect, it, vi} from 'vitest';

import {createWebhookUrls} from '../deployment/setup.mts';

class BrowserControl extends EventTarget {
    value = '';
    hidden = true;
    disabled = false;
    textContent = '';
    dataset: Record<string, string> = {};
    focus = vi.fn<() => void>();
    select = vi.fn<() => void>();
}

async function openSetup(
    options: {
        storedTheme?: string;
        storageBlocked?: boolean;
        missingControl?: string;
        config?: {production: boolean; siteUrl?: string};
        origin?: string;
        response?: Response | Promise<Response>;
        fetchError?: Error;
        verification?: Response | Promise<Response>;
        verificationError?: Error;
    } = {}
) {
    const controls = new Map(
        [
            'webhook-key',
            'verify-secret',
            'verification-status',
            'published-url',
            'unpublished-url',
            'webhook-urls',
            'copy-status',
            'theme',
            'clear-secret',
            'setup-form',
            'setup-message'
        ].map(id => [id, new BrowserControl()])
    );
    const publishedCopy = new BrowserControl();
    publishedCopy.dataset.copy = 'published-url';
    const unpublishedCopy = new BrowserControl();
    unpublishedCopy.dataset.copy = 'unpublished-url';
    const documentRoot = {dataset: {} as Record<string, string>};
    const browserWindow = Object.assign(new EventTarget(), {
        location: {origin: options.origin ?? 'https://search.example.com'}
    });
    const clipboard = {writeText: vi.fn<(text: string) => Promise<void>>(async () => {})};
    const storage = {
        getItem: vi.fn<(key: string) => string | null>(() => {
            if (options.storageBlocked) {
                throw new Error('Storage unavailable');
            }
            return options.storedTheme ?? null;
        }),
        setItem: vi.fn<(key: string, value: string) => void>(() => {
            if (options.storageBlocked) {
                throw new Error('Storage unavailable');
            }
        })
    };
    vi.stubGlobal('document', {
        documentElement: documentRoot,
        querySelector: (selector: string) =>
            selector === `#${options.missingControl}` ? null : controls.get(selector.slice(1)),
        querySelectorAll: () => [publishedCopy, unpublishedCopy]
    });
    vi.stubGlobal('window', browserWindow);
    vi.stubGlobal('navigator', {clipboard});
    vi.stubGlobal('localStorage', storage);
    const fetchStatus = vi.fn<typeof fetch>(async input => {
        if (input === '/.netlify/functions/verify-secret') {
            if (options.verificationError) {
                throw options.verificationError;
            }
            return options.verification ?? new Response(null, {status: 204});
        }
        if (options.fetchError) {
            throw options.fetchError;
        }
        return options.response ?? Response.json({active: false});
    });
    vi.stubGlobal('fetch', fetchStatus);
    const {initializeSetup} = await import('../deployment/setup.mts');
    initializeSetup(options.config ?? {production: true, siteUrl: 'https://search.example.com'});

    function control(id: string): BrowserControl {
        const element = controls.get(id);
        if (!element) {
            throw new Error(`Unknown fixture control: ${id}`);
        }
        return element;
    }
    function enterSecret(value: string): void {
        control('webhook-key').value = value;
        control('webhook-key').dispatchEvent(new Event('input'));
    }
    return {
        control,
        enterSecret,
        async verifySecret() {
            control('verify-secret').dispatchEvent(new Event('click'));
            await vi.waitFor(() => expect(control('verify-secret').disabled).toBe(false));
        },
        publishedCopy,
        unpublishedCopy,
        clipboard,
        storage,
        browserWindow,
        documentRoot,
        fetchStatus
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

it('gives customers both webhook URLs with their exact secret safely encoded', () => {
    const result = createWebhookUrls('https://search.example.com', 'a key&with=reserved?#chars');
    expect(result).toEqual({
        published:
            'https://search.example.com/.netlify/functions/post-published?key=a+key%26with%3Dreserved%3F%23chars',
        unpublished:
            'https://search.example.com/.netlify/functions/post-unpublished?key=a+key%26with%3Dreserved%3F%23chars'
    });
});

it.each(['', '   '])('does not offer unauthenticated webhook URLs for a blank key', key => {
    expect(createWebhookUrls('https://search.example.com', key)).toBeUndefined();
});

it('verifies the existing secret before showing URLs and hides them when it changes', async () => {
    const page = await openSetup();
    expect(page.control('webhook-urls').hidden).toBe(true);
    page.enterSecret('a key&more');
    expect(page.control('webhook-urls').hidden).toBe(true);
    expect(page.fetchStatus).toHaveBeenCalledTimes(1);
    await page.verifySecret();
    expect(page.fetchStatus).toHaveBeenLastCalledWith(
        '/.netlify/functions/verify-secret',
        expect.objectContaining({
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({key: 'a key&more'}),
            cache: 'no-store'
        })
    );
    expect(page.control('webhook-urls').hidden).toBe(false);
    expect(page.control('published-url').value).toBe(
        'https://search.example.com/.netlify/functions/post-published?key=a+key%26more'
    );
    expect(page.control('unpublished-url').value).toBe(
        'https://search.example.com/.netlify/functions/post-unpublished?key=a+key%26more'
    );
    expect(page.storage.setItem).not.toHaveBeenCalled();
    page.enterSecret('  ');
    expect(page.control('webhook-urls').hidden).toBe(true);
    expect(page.control('published-url').value).toBe('');
    expect(page.control('unpublished-url').value).toBe('');
});

it.each(['clear', 'leave'])('clears the secret and generated URLs on %s', async action => {
    const page = await openSetup();
    page.enterSecret('private-key');
    await page.verifySecret();
    page.control('copy-status').textContent = 'URL copied';
    if (action === 'clear') {
        page.control('clear-secret').dispatchEvent(new Event('click'));
    } else {
        page.browserWindow.dispatchEvent(new Event('pagehide'));
    }
    expect(page.control('webhook-key').focus).toHaveBeenCalledTimes(action === 'clear' ? 1 : 0);
    expect(page.control('webhook-key').value).toBe('');
    expect(page.control('published-url').value).toBe('');
    expect(page.control('unpublished-url').value).toBe('');
    expect(page.control('webhook-urls').hidden).toBe(true);
    expect(page.control('copy-status').textContent).toBe('');
    expect(page.storage.setItem).not.toHaveBeenCalled();
});

it('copies the correct URL for each button and confirms it to the customer', async () => {
    const page = await openSetup();
    page.enterSecret('private-key');
    await page.verifySecret();
    page.publishedCopy.dispatchEvent(new Event('click'));
    await Promise.resolve();
    expect(page.clipboard.writeText).toHaveBeenLastCalledWith(page.control('published-url').value);
    expect(page.control('copy-status').textContent).toBe('URL copied. Paste it into Ghost.');
    page.unpublishedCopy.dispatchEvent(new Event('click'));
    await Promise.resolve();
    expect(page.clipboard.writeText).toHaveBeenLastCalledWith(
        page.control('unpublished-url').value
    );
});

it('selects the URL for manual copying when clipboard access is denied', async () => {
    const page = await openSetup();
    page.clipboard.writeText.mockRejectedValue(new Error('Clipboard denied'));
    page.enterSecret('private-key');
    await page.verifySecret();
    page.publishedCopy.dispatchEvent(new Event('click'));
    await Promise.resolve();
    expect(page.control('published-url').focus).toHaveBeenCalledOnce();
    expect(page.control('published-url').select).toHaveBeenCalledOnce();
    expect(page.control('copy-status').textContent).toBe(
        'Copy the selected URL with your keyboard or device menu.'
    );
});

it.each(['light', 'dark'])(
    'restores the %s theme and stores only the appearance preference',
    async storedTheme => {
        const page = await openSetup({storedTheme});
        expect(page.control('theme').value).toBe(storedTheme);
        expect(page.documentRoot.dataset.theme).toBe(storedTheme);
        page.enterSecret('private-key');
        page.control('theme').value = 'system';
        page.control('theme').dispatchEvent(new Event('change'));
        expect(page.documentRoot.dataset.theme).toBe('system');
        expect(page.storage.setItem.mock.calls).toEqual([['ghost-algolia-theme', 'system']]);
    }
);

it('keeps setup and theme selection working when storage is blocked', async () => {
    const page = await openSetup({storageBlocked: true});
    page.enterSecret('private-key');
    await page.verifySecret();
    expect(page.control('webhook-urls').hidden).toBe(false);
    page.control('theme').value = 'dark';
    page.control('theme').dispatchEvent(new Event('change'));
    expect(page.documentRoot.dataset.theme).toBe('dark');
});

it('ignores unknown saved themes', async () => {
    const page = await openSetup({storedTheme: 'invalid'});
    expect(page.documentRoot.dataset.theme).toBeUndefined();
});

it('leaves an incomplete page untouched rather than failing during initialization', async () => {
    const page = await openSetup({missingControl: 'webhook-key'});
    page.enterSecret('private-key');
    expect(page.control('webhook-urls').hidden).toBe(true);
    expect(page.storage.getItem).not.toHaveBeenCalled();
});

it('uses the stable site URL when opened on a production deploy permalink', async () => {
    const page = await openSetup({
        origin: 'https://commit--search.netlify.app',
        config: {production: true, siteUrl: 'https://search.example.com/nested/'}
    });
    page.enterSecret('secret');
    await page.verifySecret();
    expect(page.control('published-url').value).toBe(
        'https://search.example.com/.netlify/functions/post-published?key=secret'
    );
    expect(page.control('setup-form').hidden).toBe(false);
});

it('previews explain isolation and never offer webhook URLs', async () => {
    const page = await openSetup({
        config: {production: false, siteUrl: 'https://search.example.com'}
    });
    page.enterSecret('secret');
    expect(page.fetchStatus).not.toHaveBeenCalled();
    expect(page.control('setup-form').hidden).toBe(true);
    expect(page.control('setup-message').hidden).toBe(false);
    expect(page.control('setup-message').textContent).toBe(
        'This is a preview. Indexing is disabled.'
    );
    expect(page.control('published-url').value).toBe('');
    expect(page.control('unpublished-url').value).toBe('');
});

it.each([
    undefined,
    '',
    '/relative',
    'not a URL',
    'ftp://search.example.com',
    'https://user:password@search.example.com',
    'https://search.example.com?key=secret',
    'https://search.example.com#secret'
])(
    'does not fall back to the current host when configured site URL is invalid: %s',
    async siteUrl => {
        const page = await openSetup({config: {production: true, siteUrl}});
        page.enterSecret('secret');
        expect(page.control('setup-form').hidden).toBe(true);
        expect(page.control('setup-message').hidden).toBe(false);
        expect(page.control('setup-message').textContent).toBe(
            'Setup is unavailable because the site URL is missing or invalid. Redeploy this site in Netlify.'
        );
        expect(page.control('published-url').value).toBe('');
        expect(page.control('unpublished-url').value).toBe('');
    }
);

it('shows paused indexing and explains how to enable webhook updates without sending the secret', async () => {
    const page = await openSetup();
    page.enterSecret('private-key');
    await vi.waitFor(() =>
        expect(page.control('setup-message').textContent).toBe(
            'Indexing is paused. Set ALGOLIA_ACTIVE to TRUE in Netlify, then redeploy to enable webhook updates.'
        )
    );
    expect(page.control('setup-message').hidden).toBe(false);
    expect(page.control('webhook-urls').hidden).toBe(true);
    expect(page.fetchStatus).toHaveBeenCalledOnce();
    expect(page.fetchStatus.mock.calls[0]?.[0]).toBe('/.netlify/functions/integration-status');
    expect(JSON.stringify(page.fetchStatus.mock.calls)).not.toContain('private-key');
});

it('shows enabled indexing without claiming the webhook connection has been verified', async () => {
    const page = await openSetup({response: Response.json({active: true})});
    await vi.waitFor(() =>
        expect(page.control('setup-message').textContent).toBe(
            'Indexing is enabled. Publish a test post to check that Ghost can update your index.'
        )
    );
});

it.each([
    {fetchError: new Error('Network unavailable')},
    {response: new Response('Unavailable', {status: 503})},
    {response: new Response('invalid JSON')},
    {response: Response.json({active: 'TRUE'})},
    {response: Response.json(null)}
])('reports unknown status when the runtime check fails: %s', async options => {
    const page = await openSetup(options);
    await vi.waitFor(() =>
        expect(page.control('setup-message').textContent).toBe(
            'Could not check indexing status. Check ALGOLIA_ACTIVE in Netlify before connecting Ghost.'
        )
    );
    expect(page.control('setup-message').hidden).toBe(false);
});

it('shows that status is being checked while the runtime response is pending', async () => {
    let respond: (response: Response) => void = () => {};
    const response = new Promise<Response>(resolve => {
        respond = resolve;
    });
    const page = await openSetup({response});
    expect(page.control('setup-message').textContent).toBe('Checking indexing status…');
    expect(page.control('setup-message').hidden).toBe(false);
    respond(Response.json({active: false}));
    await vi.waitFor(() =>
        expect(page.control('setup-message').textContent).toContain('Indexing is paused.')
    );
});

it.each([
    {verification: new Response(null, {status: 401}), message: 'This secret does not match.'},
    {
        verification: new Response(null, {status: 503}),
        message: 'NETLIFY_KEY is missing in Netlify.'
    },
    {
        verification: new Response(null, {status: 403}),
        message: 'Verification is unavailable on previews.'
    },
    {verification: new Response(null, {status: 500}), message: 'Could not verify your secret.'},
    {verificationError: new Error('Offline'), message: 'Could not verify your secret.'}
])('keeps URLs hidden when verification fails: $message', async options => {
    const page = await openSetup(options);
    expect(page.control('verify-secret').disabled).toBe(true);
    page.enterSecret('wrong-key');
    await page.verifySecret();
    expect(page.control('verification-status').textContent).toContain(options.message);
    expect(page.control('webhook-urls').hidden).toBe(true);
    expect(page.control('published-url').value).toBe('');
    page.publishedCopy.dispatchEvent(new Event('click'));
    expect(page.clipboard.writeText).not.toHaveBeenCalled();
});

it.each(['change', 'clear', 'leave'])('ignores pending verification after %s', async action => {
    let respond: (response: Response) => void = () => {};
    const verification = new Promise<Response>(resolve => {
        respond = resolve;
    });
    const page = await openSetup({verification});
    page.enterSecret('original-key');
    page.control('verify-secret').dispatchEvent(new Event('click'));
    expect(page.control('verify-secret').disabled).toBe(true);
    expect(page.control('verification-status').textContent).toContain('Checking');
    if (action === 'change') {
        page.enterSecret('changed-key');
        page.enterSecret('original-key');
    } else if (action === 'clear') {
        page.control('clear-secret').dispatchEvent(new Event('click'));
    } else {
        page.browserWindow.dispatchEvent(new Event('pagehide'));
    }
    respond(new Response(null, {status: 204}));
    await new Promise(resolve => {
        setTimeout(resolve, 0);
    });
    expect(page.control('webhook-urls').hidden).toBe(true);
    expect(page.control('published-url').value).toBe('');
    expect(page.control('verification-status').textContent).toBe('');
});

it('hides previously verified URLs while checking again, including a failed recheck', async () => {
    const page = await openSetup();
    page.enterSecret('private-key');
    await page.verifySecret();
    page.fetchStatus.mockResolvedValueOnce(new Response(null, {status: 401}));
    page.control('verify-secret').dispatchEvent(new Event('click'));
    expect(page.control('webhook-urls').hidden).toBe(true);
    await vi.waitFor(() => expect(page.control('verify-secret').disabled).toBe(false));
    expect(page.control('webhook-urls').hidden).toBe(true);
});

it('verifies with Enter and ignores a second attempt while verification is pending', async () => {
    const page = await openSetup();
    page.enterSecret('private-key');
    const enter = Object.assign(new Event('keydown', {cancelable: true}), {key: 'Enter'});
    page.control('webhook-key').dispatchEvent(enter);
    page.control('verify-secret').dispatchEvent(new Event('click'));
    expect(enter.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(page.control('webhook-urls').hidden).toBe(false));
    expect(
        page.fetchStatus.mock.calls.filter(([url]) => url === '/.netlify/functions/verify-secret')
    ).toHaveLength(1);
});
