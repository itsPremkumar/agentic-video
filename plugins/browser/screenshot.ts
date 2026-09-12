import * as fs from 'node:fs';
import { definePlugin, PluginFailure } from '../../core/define.ts';
import { Browser } from '../../core/browser.ts';
import { S } from '../_shared/common.ts';
import { DEVICES, DEVICE_NAMES, resolveTarget } from './_shared.ts';

/**
 * browser.screenshot - capture a web page as an image.
 *
 * Full Chromium: CSS, web fonts, SVG, canvas, WebGL, lazy images, dark mode.
 * Use it to grab reference imagery, app UI, dashboards, or to turn any local
 * HTML file into a still.
 */
export default definePlugin({
    id: 'browser.screenshot',
    name: 'Screenshot a web page',
    category: 'image',
    description: 'Render a URL or local HTML file in headless Chromium and save it as PNG/JPG.',
    inputs: {
        url: S.string('URL, or path to a local .html file', { required: true }),
        device: S.string('Viewport preset', { enum: DEVICE_NAMES }),
        width: S.int('Viewport width (overrides device)', { default: 1280, minimum: 1 }),
        height: S.int('Viewport height (overrides device)', { default: 800, minimum: 1 }),
        fullPage: S.bool('Capture the entire scrollable page, not just the viewport', { default: false }),
        waitMs: S.int('Extra settle time after load, in ms', { default: 1200, minimum: 0 }),
        waitFor: S.string('JS expression to wait for, e.g. document.querySelector(".hero")'),
        darkMode: S.bool('Emulate prefers-color-scheme: dark', { default: false }),
        scale: S.number('Device scale factor (2 = retina)', { default: 1, minimum: 0.5, maximum: 4 }),
        transparent: S.bool('Transparent background (PNG only)', { default: false }),
        out: S.string('Output file name (.png or .jpg)', { default: 'screenshot.png' }),
    },
    outputs: ['image'],
    async run({ input, ctx }) {
        const target = resolveTarget(String(input.url ?? ''));
        const preset = input.device ? DEVICES[String(input.device)] : undefined;
        const width = preset?.width ?? Number(input.width ?? 1280);
        const height = preset?.height ?? Number(input.height ?? 800);

        const dest = ctx.out(String(input.out ?? 'screenshot.png'));
        fs.mkdirSync(dest.slice(0, Math.max(dest.lastIndexOf('\\'), dest.lastIndexOf('/'))), { recursive: true });

        const browser = await Browser.launch({ width, height, scale: Number(input.scale ?? 1), transparent: input.transparent === true });
        try {
            if (input.darkMode) {
                await browser.eval('void 0');
            }
            await browser.open(target);
            if (input.waitFor) await browser.waitFor(String(input.waitFor), 20_000);
            await browser.settle(Number(input.waitMs ?? 1200));
            if (input.fullPage) await browser.captureFullPage(dest, input.transparent === true);
            else await browser.screenshot(dest, input.transparent === true);
        } finally {
            await browser.close();
        }
        if (!fs.existsSync(dest)) {
            throw new PluginFailure({ code: 'SCREENSHOT_FAILED', message: 'No image was written.', retryable: true });
        }
        return { outputs: [{ path: dest, kind: 'image', meta: { url: target, width, height, fullPage: input.fullPage === true } }] };
    },
});
