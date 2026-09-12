import { definePlugin } from '../../core/define.ts';
import { launch } from '../../core/playwright.ts';
import { S } from '../_shared/common.ts';

/**
 * browser.open — open a real website and capture it.
 *
 * Unlike browser.screenshot (which renders HTML through the zero-dependency
 * CDP client), this uses Playwright: it waits for the page to actually settle,
 * can dismiss cookie banners, and can wait for a specific element before it
 * shoots. Use it when the target is a live site rather than markup you control.
 */
export default definePlugin({
    id: 'browser.open',
    name: 'Open a website (Playwright)',
    category: 'browser',
    description: 'Open a URL in Playwright Chromium, wait for it to settle, and save a screenshot. Handles cookie banners and dark mode.',
    inputs: {
        url: S.string('Page URL (or path to a local .html file)', { required: true }),
        width: S.int('Viewport width', { default: 1440, minimum: 200 }),
        height: S.int('Viewport height', { default: 900, minimum: 200 }),
        scale: S.number('Device scale factor (2 = retina)', { default: 1, minimum: 0.5, maximum: 3 }),
        fullPage: S.bool('Capture the full scrollable page', { default: false }),
        waitUntil: S.string('Navigation wait condition', { enum: ['load', 'domcontentloaded', 'networkidle'], default: 'load' }),
        waitFor: S.string('Wait for this CSS selector to appear before shooting'),
        waitMs: S.int('Extra settle time after load, ms', { default: 800, minimum: 0 }),
        darkMode: S.bool('Emulate prefers-color-scheme: dark', { default: false }),
        dismissCookies: S.bool('Click a common cookie-consent button if one is present', { default: true }),
        userAgent: S.string('Override the user agent'),
        out: S.string('Output file name (.png/.jpg)', { default: 'site.png' }),
    },
    outputs: ['image'],
    async run({ input, ctx }) {
        const url = String(input.url);
        const session = await launch({
            width: Number(input.width ?? 1440),
            height: Number(input.height ?? 900),
            scale: Number(input.scale ?? 1),
            colorScheme: input.darkMode ? 'dark' : undefined,
            userAgent: input.userAgent ? String(input.userAgent) : undefined,
        });
        try {
            const { page } = session;
            await page.goto(url, { waitUntil: (input.waitUntil as 'load') ?? 'load' });

            if (input.dismissCookies) {
                // Best-effort only: no consent button is not a failure.
                const selectors = [
                    'button:has-text("Accept all")',
                    'button:has-text("Accept All")',
                    'button:has-text("I agree")',
                    'button:has-text("Agree")',
                    '#onetrust-accept-btn-handler',
                    'button[aria-label*="Accept"]',
                ];
                for (const sel of selectors) {
                    const btn = page.locator(sel).first();
                    if (await btn.count().catch(() => 0)) {
                        await btn.click({ timeout: 2000, noWaitAfter: true }).catch(() => {});
                        break;
                    }
                }
            }

            if (input.waitFor) await page.locator(String(input.waitFor)).first().waitFor({ state: 'visible' });
            if (Number(input.waitMs ?? 0) > 0) await page.waitForTimeout(Number(input.waitMs));

            const dest = ctx.out(String(input.out ?? 'site.png'));
            await page.screenshot({ path: dest, fullPage: Boolean(input.fullPage) });

            return {
                outputs: [{ path: dest, kind: 'image' as const, meta: { url, title: await page.title() } }],
            };
        } finally {
            await session.close();
        }
    },
});
