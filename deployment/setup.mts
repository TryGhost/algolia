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
    const verify = document.querySelector<HTMLButtonElement>('#verify-secret');
    const verification = document.querySelector<HTMLElement>('#verification-status');
    const message = document.querySelector<HTMLElement>('#setup-message');
    if (
        !key ||
        !published ||
        !unpublished ||
        !urls ||
        !status ||
        !theme ||
        !form ||
        !message ||
        !verify ||
        !verification
    ) {
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
    message.hidden = false;
    form.hidden = false;
    void showIndexingStatus(message);

    let verificationAttempt = 0;
    const invalidateVerification = (): void => {
        verificationAttempt += 1;
        published.value = '';
        unpublished.value = '';
        urls.hidden = true;
        status.textContent = '';
        verification.textContent = '';
        verify.disabled = !key.value.trim();
        verify.textContent = 'Verify secret';
    };
    invalidateVerification();

    const verifySecret = async (): Promise<void> => {
        if (verify.disabled) {
            return;
        }
        invalidateVerification();
        const secret = key.value;
        const attempt = verificationAttempt;
        verify.disabled = true;
        verify.textContent = 'Verifying…';
        verification.textContent = 'Checking your existing webhook secret…';
        try {
            const response = await fetch('/.netlify/functions/verify-secret', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({key: secret}),
                cache: 'no-store',
                redirect: 'error',
                signal: AbortSignal.timeout(10_000)
            });
            if (attempt !== verificationAttempt || key.value !== secret) {
                return;
            }
            if (response.status !== 204) {
                verification.textContent =
                    response.status === 401
                        ? 'This secret does not match. Enter the NETLIFY_KEY saved in Netlify.'
                        : response.status === 503
                          ? 'NETLIFY_KEY is missing in Netlify. Add it and redeploy, then try again.'
                          : response.status === 403
                            ? 'Verification is unavailable on previews. Open your production site.'
                            : 'Could not verify your secret. Try again.';
                return;
            }
            const generated = createWebhookUrls(siteOrigin, secret);
            published.value = generated?.published ?? '';
            unpublished.value = generated?.unpublished ?? '';
            urls.hidden = !generated;
            verification.textContent = 'Secret verified. Copy these URLs into Ghost.';
        } catch {
            if (attempt === verificationAttempt) {
                verification.textContent = 'Could not verify your secret. Try again.';
            }
        } finally {
            if (attempt === verificationAttempt) {
                verify.disabled = !key.value.trim();
                verify.textContent = 'Verify secret';
            }
        }
    };
    verify.addEventListener('click', () => {
        void verifySecret();
    });
    key.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            void verifySecret();
        }
    });
    key.addEventListener('input', invalidateVerification);
    document.querySelector('#clear-secret')?.addEventListener('click', () => {
        key.value = '';
        invalidateVerification();
        key.focus();
    });
    window.addEventListener('pagehide', () => {
        key.value = '';
        invalidateVerification();
    });

    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-copy]')) {
        button.addEventListener('click', async () => {
            if (urls.hidden) {
                return;
            }
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

async function showIndexingStatus(message: HTMLElement): Promise<void> {
    message.textContent = 'Checking indexing status…';
    message.dataset.state = 'checking';
    try {
        const response = await fetch('/.netlify/functions/integration-status', {
            cache: 'no-store',
            signal: AbortSignal.timeout(10_000)
        });
        if (!response.ok) {
            throw new Error('Indexing status unavailable');
        }
        const status: unknown = await response.json();
        if (
            !status ||
            typeof status !== 'object' ||
            !('active' in status) ||
            typeof status.active !== 'boolean'
        ) {
            throw new Error('Invalid indexing status');
        }
        message.dataset.state = status.active ? 'enabled' : 'paused';
        message.textContent = status.active
            ? 'Indexing is enabled. Publish a test post to check that Ghost can update your index.'
            : 'Indexing is paused. Set ALGOLIA_ACTIVE to TRUE in Netlify, then redeploy to enable webhook updates.';
    } catch {
        message.dataset.state = 'unknown';
        message.textContent =
            'Could not check indexing status. Check ALGOLIA_ACTIVE in Netlify before connecting Ghost.';
    }
}
