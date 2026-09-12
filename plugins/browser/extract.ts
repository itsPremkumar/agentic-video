import * as fs from 'node:fs';
import { definePlugin } from '../../core/define.ts';
import { Browser } from '../../core/browser.ts';
import { S } from '../_shared/common.ts';
import { DEVICES, DEVICE_NAMES, resolveTarget } from './_shared.ts';

/**
 * browser.extract - pull structured content out of a web page:
 * title, meta description, headings, body text, links, images, OpenGraph tags.
 */
export default definePlugin({
    id: 'browser.extract',
    name: 'Extract content from a web page',
    category: 'export',
    description: 'Read a page in headless Chromium and extract its title, meta, headings, text, links and images as JSON.',
    inputs: {
        url: S.string('URL, or path to a local .html file', { required: true }),
        device: S.string('Viewport preset', { enum: DEVICE_NAMES }),
        maxTextChars: S.int('Truncate body text to this many characters', { default: 20000, minimum: 100 }),
        waitMs: S.int('Settle time after load, in ms', { default: 1200, minimum: 0 }),
        waitFor: S.string('JS expression to wait for'),
        out: S.string('Output JSON file name', { default: 'page-data.json' }),
    },
    outputs: ['data'],
    async run({ input, ctx }) {
        const target = resolveTarget(String(input.url ?? ''));
        const preset = input.device ? DEVICES[String(input.device)] : undefined;
        const browser = await Browser.launch({ width: preset?.width ?? 1280, height: preset?.height ?? 800 });
        let data: Record<string, unknown>;
        try {
            await browser.open(target);
            if (input.waitFor) await browser.waitFor(String(input.waitFor), 20_000);
            await browser.settle(Number(input.waitMs ?? 1200));
            data = await browser.eval<Record<string, unknown>>(
                '(function(){' +
                'var q=function(s){var e=document.querySelector(s);return e?e.getAttribute("content")||e.textContent:"";};' +
                'var links=[].slice.call(document.querySelectorAll("a[href]")).map(function(a){return {text:(a.textContent||"").trim().slice(0,200),href:a.href};});' +
                'var imgs=[].slice.call(document.querySelectorAll("img")).map(function(i){return {src:i.src,alt:i.alt||"",w:i.naturalWidth,h:i.naturalHeight};});' +
                'var hs=[].slice.call(document.querySelectorAll("h1,h2,h3")).map(function(h){return h.tagName+": "+(h.textContent||"").trim().slice(0,300);});' +
                'return {' +
                'title:document.title,' +
                'description:q(\'meta[name="description"]\'),' +
                'ogTitle:q(\'meta[property="og:title"]\'),' +
                'ogImage:q(\'meta[property="og:image"]\'),' +
                'ogDescription:q(\'meta[property="og:description"]\'),' +
                'headings:hs,' +
                'text:(document.body?document.body.innerText:"").replace(/\\n{2,}/g,"\\n").trim(),' +
                'links:links,' +
                'images:imgs' +
                '};})()',
            );
        } finally {
            await browser.close();
        }
        const maxChars = Number(input.maxTextChars ?? 20000);
        const text = String(data.text ?? '');
        if (text.length > maxChars) data.text = text.slice(0, maxChars) + '… [truncated]';
        data.sourceUrl = target;
        const dest = ctx.out(String(input.out ?? 'page-data.json'));
        fs.mkdirSync(dest.slice(0, Math.max(dest.lastIndexOf('\\'), dest.lastIndexOf('/'))), { recursive: true });
        fs.writeFileSync(dest, JSON.stringify(data, null, 2), 'utf8');
        return { outputs: [{ path: dest, kind: 'data', meta: { url: target, links: (data.links as unknown[])?.length ?? 0, images: (data.images as unknown[])?.length ?? 0 } }] };
    },
});
