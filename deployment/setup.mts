export function createWebhookUrls(
    origin: string,
    key: string
): {published: string; unpublished: string} | undefined {
    if (!key.trim()) {
        return undefined;
    }
    const published = new URL('/.netlify/functions/post-published', origin);
    const unpublished = new URL('/.netlify/functions/post-unpublished', origin);
    published.searchParams.set('key', key);
    unpublished.searchParams.set('key', key);
    return {published: published.href, unpublished: unpublished.href};
}

function getSiteOrigin(siteUrl: string | undefined): string | undefined {
    if (!siteUrl) {
        return undefined;
    }
    try {
        const url = new URL(siteUrl);
        if (
            !['https:', 'http:'].includes(url.protocol) ||
            url.username ||
            url.password ||
            url.search ||
            url.hash
        ) {
            return undefined;
        }
        return url.origin;
    } catch {
        return undefined;
    }
}

export function initializeSetup(config: {production: boolean; siteUrl?: string}): void {
    const key = document.querySelector<HTMLInputElement>('#webhook-key');
    const published = document.querySelector<HTMLInputElement>('#published-url');
    const unpublished = document.querySelector<HTMLInputElement>('#unpublished-url');
    const urls = document.querySelector<HTMLElement>('#webhook-urls');
    const status = document.querySelector<HTMLElement>('#copy-status');
    const theme = document.querySelector<HTMLSelectElement>('#theme');
    const form = document.querySelector<HTMLElement>('#setup-form');
    const message = document.querySelector<HTMLElement>('#setup-message');
    if (!key || !published || !unpublished || !urls || !status || !theme || !form || !message) {
        return;
    }

    initializeTheme(theme);
    key.value = '';
    published.value = '';
    unpublished.value = '';
    urls.hidden = true;
    form.hidden = true;
    const siteOrigin = getSiteOrigin(config.siteUrl);
    if (!config.production || !siteOrigin) {
        message.hidden = false;
        message.textContent = !config.production
            ? 'This is a preview. Indexing is disabled.'
            : 'Setup is unavailable because the site URL is missing or invalid. Redeploy this site in Netlify.';
        return;
    }
    message.hidden = true;
    form.hidden = false;

    const updateUrls = (): void => {
        const generated = createWebhookUrls(siteOrigin, key.value);
        published.value = generated?.published ?? '';
        unpublished.value = generated?.unpublished ?? '';
        urls.hidden = !generated;
        status.textContent = '';
    };

    key.addEventListener('input', updateUrls);
    document.querySelector('#clear-secret')?.addEventListener('click', () => {
        key.value = '';
        updateUrls();
        key.focus();
    });
    window.addEventListener('pagehide', () => {
        key.value = '';
        updateUrls();
    });

    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-copy]')) {
        button.addEventListener('click', async () => {
            const field = button.dataset.copy === 'published-url' ? published : unpublished;
            try {
                await navigator.clipboard.writeText(field.value);
                status.textContent = 'URL copied. Paste it into Ghost.';
            } catch {
                field.focus();
                field.select();
                status.textContent = 'Copy the selected URL with your keyboard or device menu.';
            }
        });
    }
}

function applyTheme(value: string): void {
    document.documentElement.dataset.theme =
        value === 'light' || value === 'dark' ? value : 'system';
}

function initializeTheme(theme: HTMLSelectElement): void {
    try {
        const saved = localStorage.getItem('ghost-algolia-theme');
        if (saved === 'light' || saved === 'dark') {
            theme.value = saved;
            applyTheme(saved);
        }
    } catch {
        // The system theme still works when browser storage is unavailable.
    }
    theme.addEventListener('change', () => {
        applyTheme(theme.value);
        try {
            localStorage.setItem('ghost-algolia-theme', theme.value);
        } catch {
            // Theme selection remains active for this visit.
        }
    });
}
