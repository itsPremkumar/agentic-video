import * as fs from 'node:fs';
import { definePlugin, PluginFailure } from '../../core/define.ts';
import { Browser } from '../../core/browser.ts';
import { S } from '../_shared/common.ts';
import { DEVICES, DEVICE_NAMES, resolveTarget } from './_shared.ts';

/**
 * browser.mockup - render a page inside a device frame (browser chrome or
 * phone bezel) on a gradient background. The standard "show the product"
 * shot used in promo videos, thumbnails and landing pages.
 */
export default definePlugin({
    id: 'browser.mockup',
    name: 'Device mockup of a web page',
    category: 'image',
    description: 'Render a URL or local HTML inside a browser-window or phone frame on a styled background.',
    inputs: {
        url: S.string('URL, or path to a local .html file', { required: true }),
        frame: S.string('Frame style', { default: 'browser', enum: ['browser', 'phone', 'none'] }),
        device: S.string('Inner viewport preset', { enum: DEVICE_NAMES }),
        width: S.int('Inner viewport width', { default: 1280, minimum: 200 }),
        height: S.int('Inner viewport height', { default: 800, minimum: 200 }),
        background: S.string('Backdrop: CSS background value, or a two-colour gradient "from,to"', { default: '#1e293b,#0f172a' }),
        padding: S.int('Padding around the frame in px', { default: 90, minimum: 0 }),
        radius: S.int('Frame corner radius in px', { default: 14, minimum: 0 }),
        shadow: S.bool('Drop shadow under the frame', { default: true }),
        waitMs: S.int('Settle time after load, in ms', { default: 1500, minimum: 0 }),
        out: S.string('Output file name (.png or .jpg)', { default: 'mockup.png' }),
    },
    outputs: ['image'],
    async run({ input, ctx }) {
        const target = resolveTarget(String(input.url ?? ''));
        const preset = input.device ? DEVICES[String(input.device)] : undefined;
        const vw = preset?.width ?? Number(input.width ?? 1280);
        const vh = preset?.height ?? Number(input.height ?? 800);
        const frame = String(input.frame ?? 'browser');
        const pad = Number(input.padding ?? 90);
        const radius = Number(input.radius ?? 14);
        const bgRaw = String(input.background ?? '#1e293b,#0f172a');
        const bg = bgRaw.includes(',')
            ? 'linear-gradient(135deg, ' + bgRaw.split(',').map((c) => c.trim()).join(', ') + ')'
            : bgRaw;

        // Stage that previews the page in an iframe, framed to look like a device.
        const stageW = vw + pad * 2 + (frame === 'phone' ? 40 : 0);
        const stageH = vh + pad * 2 + (frame === 'browser' ? 48 : 0) + (frame === 'phone' ? 40 : 0);

        const chromeHtml = frame === 'browser'
            ? '<div style="height:48px;display:flex;align-items:center;gap:8px;padding:0 16px;background:#202936;border-bottom:1px solid #2f3a4d">' +
              '<span style="width:12px;height:12px;border-radius:50%;background:#ff5f57"></span>' +
              '<span style="width:12px;height:12px;border-radius:50%;background:#febc2e"></span>' +
              '<span style="width:12px;height:12px;border-radius:50%;background:#28c840"></span>' +
              '<div style="margin-left:16px;flex:1;height:26px;border-radius:6px;background:#2f3a4d"></div></div>'
            : '';

        const stage =
            '<!doctype html><html><head><meta charset="utf-8"><style>' +
            'html,body{margin:0;padding:0;background:' + bg + ';height:100%;}' +
            'body{display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;}' +
            '.frame{background:' + (frame === 'phone' ? '#0b0e14' : '#202936') + ';border-radius:' +
            (frame === 'phone' ? '44' : radius) + 'px;overflow:hidden;' +
            (input.shadow !== false ? 'box-shadow:0 40px 90px rgba(0,0,0,.55);' : '') +
            (frame === 'phone' ? 'border:10px solid #0b0e14;' : '') + '}' +
            'iframe{border:0;display:block;}' +
            '</style></head><body><div class="frame">' + chromeHtml +
            '<iframe src="' + target.replace(/"/g, '&quot;') + '" width="' + vw + '" height="' + vh + '"></iframe>' +
            '</div></body></html>';

        const dest = ctx.out(String(input.out ?? 'mockup.png'));
        fs.mkdirSync(dest.slice(0, Math.max(dest.lastIndexOf('\\'), dest.lastIndexOf('/'))), { recursive: true });

        const browser = await Browser.launch({ width: stageW, height: stageH });
        try {
            await browser.setContent(stage, ctx.workspaceDir);
            await browser.settle(Number(input.waitMs ?? 1500));
            await browser.screenshot(dest);
        } finally {
            await browser.close();
        }
        if (!fs.existsSync(dest)) {
            throw new PluginFailure({ code: 'MOCKUP_FAILED', message: 'No image was written.', retryable: true });
        }
        return { outputs: [{ path: dest, kind: 'image', meta: { url: target, frame, width: stageW, height: stageH } }] };
    },
});
