import { definePlugin, PluginFailure } from '../../core/define.ts';
import { launch, runActions, type Action } from '../../core/playwright.ts';
import { S } from '../_shared/common.ts';

/**
 * browser.scroll_capture — walk down a page capturing a still at each step.
 *
 * Complements browser.record_flow: that one gives you moving footage, this one
 * gives you evenly spaced stills you can feed straight into video.from_images
 * for a Ken Burns pan, or use as a visual QA strip of a long page.
 */
export default definePlugin({
    id: 'browser.scroll_capture',
    name: 'Scroll-capture a page into stills',
    category: 'image',
    description: 'Scroll a page in even steps, screenshotting the viewport at each stop. Good for Ken Burns pans and long-page QA.',
    inputs: {
        url: S.string('Page URL (or path to a local .html file)', { required: true }),
        width: S.int('Viewport width', { default: 1280, minimum: 200 }),
        height: S.int('Viewport height', { default: 720, minimum: 200 }),
        scale: S.number('Device scale factor', { default: 1, minimum: 0.5, maximum: 3 }),
        steps: S.int('How many stops along the page', { default: 5, minimum: 1, maximum: 40 }),
        /** 0 = top-to-bottom across the full scrollable height. */
        distance: S.int('Total pixels to travel (0 = whole page)', { default: 0, minimum: 0 }),
        stepPx: S.int('Pixels per incremental step (smaller = smoother)', { default: 120, minimum: 20 }),
        waitMs: S.int('Settle time at each stop, ms', { default: 400, minimum: 0 }),
        darkMode: S.bool('Emulate prefers-color-scheme: dark', { default: false }),
        before: S.array('Actions to run before scrolling (e.g. dismiss a banner, click a tab)'),
        prefix: S.string('Filename prefix', { default: 'scroll' }),
    },
    outputs: ['image', 'json'],
    async run({ input, ctx }) {
        const steps = Number(input.steps ?? 5);
        const session = await launch({
            width: Number(input.width ?? 1280),
            height: Number(input.height ?? 720),
            scale: Number(input.scale ?? 1),
            colorScheme: input.darkMode ? 'dark' : undefined,
        });
        try {
            const { page } = session;
            await page.goto(String(input.url), { waitUntil: 'load' });

            if (Array.isArray(input.before) && input.before.length) {
                await runActions(page, input.before as Action[], {
                    outDir: ctx.workspaceDir,
                    out: (n: string) => ctx.out(n),
                });
            }

            // Runs in the page; this project compiles without the DOM lib.
            const metrics = await page.evaluate(() => {
                const d = (globalThis as unknown as { document: { documentElement: { scrollHeight: number; clientHeight: number } } }).document;
                return { scrollHeight: d.documentElement.scrollHeight, clientHeight: d.documentElement.clientHeight };
            });
            const maxScroll = Math.max(0, metrics.scrollHeight - metrics.clientHeight);
            const total = Number(input.distance ?? 0) > 0
                ? Math.min(Number(input.distance), maxScroll)
                : maxScroll;

            if (total <= 0) {
                // Nothing to scroll — a single viewport shot is still a valid result.
                const only = ctx.out(`${String(input.prefix ?? 'scroll')}_01.png`);
                await page.screenshot({ path: only });
                return {
                    outputs: [{ path: only, kind: 'image' as const, meta: { stop: 1, y: 0 } }],
                    warnings: ['Page is not scrollable — captured one viewport.'],
                };
            }

            const prefix = String(input.prefix ?? 'scroll');
            const waitMs = Number(input.waitMs ?? 400);
            const stepPx = Number(input.stepPx ?? 120);
            const outputs: { path: string; kind: 'image'; meta?: Record<string, unknown> }[] = [];
            const manifest: { stop: number; y: number; file: string }[] = [];

            let current = 0;
            for (let s = 0; s < steps; s++) {
                const targetY = Math.round((total * s) / Math.max(1, steps - 1));
                // Move in increments so lazy-loaded content has a chance to load.
                while (current < targetY) {
                    const delta = Math.min(stepPx, targetY - current);
                    await page.mouse.wheel(0, delta);
                    current += delta;
                    await page.waitForTimeout(50);
                }
                await page.waitForTimeout(waitMs);
                const file = ctx.out(`${prefix}_${String(s + 1).padStart(2, '0')}.png`);
                await page.screenshot({ path: file });
                outputs.push({ path: file, kind: 'image', meta: { stop: s + 1, y: current } });
                manifest.push({ stop: s + 1, y: current, file });
            }

            const jsonPath = ctx.out('scroll-manifest.json');
            const { default: fs } = await import('node:fs');
            await fs.promises.writeFile(
                jsonPath,
                JSON.stringify({ url: page.url(), scrollHeight: metrics.scrollHeight, travelled: total, stops: manifest }, null, 2),
                'utf8',
            );

            return {
                outputs: [...outputs, { path: jsonPath, kind: 'json' as const, meta: { stops: manifest.length } }],
            };
        } finally {
            await session.close();
        }
    },
});
