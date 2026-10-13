import {afterEach, expect, it, vi} from 'vitest';

import {createWebhookUrls} from '../deployment/setup.mts';

class BrowserControl extends EventTarget {
    value = '';
    hidden = true;
    textContent = '';
    dataset: Record<string, string> = {};
    focus = vi.fn<() => void>();
    select = vi.fn<() => void>();
}

let browserVisit = 0;

async function openSetup(
    options: {storedTheme?: string; storageBlocked?: boolean; missingControl?: string} = {}
) {
    const controls = new Map(
        [
            'webhook-key',
            'published-url',
            'unpublished-url',
            'webhook-urls',
            'copy-status',
            'theme',
            'clear-secret'
        ].map(id => [id, new BrowserControl()])
    );
    const publishedCopy = new BrowserControl();
    publishedCopy.dataset.copy = 'published-url';
    const unpublishedCopy = new BrowserControl();
    unpublishedCopy.dataset.copy = 'unpublished-url';
    const documentRoot = {dataset: {} as Record<string, string>};
    const browserWindow = Object.assign(new EventTarget(), {
        location: {origin: 'https://search.example.com'}
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
    const moduleUrl = new URL('../deployment/setup.mts', import.meta.url);
    browserVisit += 1;
    moduleUrl.searchParams.set('visit', String(browserVisit));
    await import(moduleUrl.href);

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
        publishedCopy,
        unpublishedCopy,
        clipboard,
        storage,
        browserWindow,
        documentRoot
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

it('shows both usable URLs after entering a secret and hides them when it is blank', async () => {
    const page = await openSetup();
    expect(page.control('webhook-urls').hidden).toBe(true);
    page.enterSecret('a key&more');
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
