import * as fs from 'node:fs';
import { definePlugin } from '../../core/define.ts';
import { Browser } from '../../core/browser.ts';
import { S } from '../_shared/common.ts';
import { DEVICES, DEVICE_NAMES, resolveTarget } from './_shared.ts';

/** browser.pdf - render a web page to a PDF document. */
export default definePlugin({
    id: 'browser.pdf',
    name: 'Render a web page to PDF',
    category: 'export',
    description: 'Print a URL or local HTML file to PDF using headless Chromium.',
    inputs: {
        url: S.string('URL, or path to a local .html file', { required: true }),
        device: S.string('Viewport preset', { enum: DEVICE_NAMES }),
        landscape: S.bool('Landscape orientation', { default: false }),
        printBackground: S.bool('Include background colours and images', { default: true }),
        waitMs: S.int('Settle time after load, in ms', { default: 1200, minimum: 0 }),
        out: S.string('Output file name (.pdf)', { default: 'page.pdf' }),
    },
    outputs: ['data'],
    async run({ input, ctx }) {
        const target = resolveTarget(String(input.url ?? ''));
        const preset = input.device ? DEVICES[String(input.device)] : undefined;
        const width = preset?.width ?? 1280;
        const height = preset?.height ?? 800;
        const dest = ctx.out(String(input.out ?? 'page.pdf'));
        fs.mkdirSync(dest.slice(0, Math.max(dest.lastIndexOf('\\'), dest.lastIndexOf('/'))), { recursive: true });
        const browser = await Browser.launch({ width, height });
        try {
            await browser.open(target);
            await browser.settle(Number(input.waitMs ?? 1200));
            await browser.printPdf(dest, { landscape: input.landscape === true, printBackground: input.printBackground !== false });
        } finally {
            await browser.close();
        }
        return { outputs: [{ path: dest, kind: 'data', meta: { url: target } }] };
    },
});
