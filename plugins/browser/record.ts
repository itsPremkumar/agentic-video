import * as fs from 'node:fs';
import * as path from 'node:path';
import { definePlugin, PluginFailure } from '../../core/define.ts';
import { Browser } from '../../core/browser.ts';
import { ffmpeg } from '../../core/media.ts';
import { S } from '../_shared/common.ts';
import { DEVICES, DEVICE_NAMES, resolveTarget } from './_shared.ts';

/**
 * browser.record - record a web page to MP4/WebM.
 *
 * Captures one screenshot per frame while optionally scrolling the page, so
 * the result is a smooth "browse the site" clip. Deterministic: every frame
 * is seeked explicitly, so output does not depend on machine speed.
 */
export default definePlugin({
    id: 'browser.record',
    name: 'Record a web page to video',
    category: 'video',
    description: 'Record a URL / local HTML file to MP4 or WebM while scrolling, one captured frame at a time.',
    inputs: {
        url: S.string('URL, or path to a local .html file', { required: true }),
        duration: S.number('Recording length in seconds', { default: 6, minimum: 0.5, maximum: 120 }),
        fps: S.int('Frames per second', { default: 24, minimum: 1, maximum: 60 }),
        device: S.string('Viewport preset', { enum: DEVICE_NAMES }),
        width: S.int('Viewport width (overrides device)', { default: 1280, minimum: 1 }),
        height: S.int('Viewport height (overrides device)', { default: 800, minimum: 1 }),
        scroll: S.bool('Scroll the page while recording', { default: true }),
        scrollTo: S.string('How far to scroll: bottom, or a pixel count', { default: 'bottom' }),
        waitMs: S.int('Settle time after load before recording starts', { default: 1500, minimum: 0 }),
        waitFor: S.string('JS expression to wait for before recording'),
        darkMode: S.bool('Emulate prefers-color-scheme: dark', { default: false }),
        out: S.string('Output file name (.mp4 or .webm)', { default: 'site.mp4' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const target = resolveTarget(String(input.url ?? ''));
        const preset = input.device ? DEVICES[String(input.device)] : undefined;
        const width = preset?.width ?? Number(input.width ?? 1280);
        const height = preset?.height ?? Number(input.height ?? 800);
        const fps = Math.max(1, Math.min(60, Math.round(Number(input.fps ?? 24))));
        const duration = Math.max(0.5, Number(input.duration ?? 6));
        const totalFrames = Math.max(1, Math.round(duration * fps));
        const doScroll = input.scroll !== false;

        const dest = ctx.out(String(input.out ?? 'site.mp4'));
        fs.mkdirSync(dest.slice(0, Math.max(dest.lastIndexOf('\\'), dest.lastIndexOf('/'))), { recursive: true });
        const framesDir = path.join(ctx.workspaceDir, '_browser_rec_' + Date.now());
        fs.mkdirSync(framesDir, { recursive: true });

        const browser = await Browser.launch({ width, height });
        try {
            await browser.open(target);
            if (input.waitFor) await browser.waitFor(String(input.waitFor), 20_000);
            await browser.settle(Number(input.waitMs ?? 1500));

            const maxScroll = doScroll
                ? Math.max(0, (await browser.contentHeight()) - height)
                : 0;
            const targetScroll = String(input.scrollTo ?? 'bottom').toLowerCase() === 'bottom'
                ? maxScroll
                : Math.min(maxScroll, Number(input.scrollTo) || 0);

            for (let i = 0; i < totalFrames; i++) {
                if (doScroll && targetScroll > 0) {
                    const y = Math.round((i / Math.max(1, totalFrames - 1)) * targetScroll);
                    await browser.eval('window.scrollTo(0, ' + y + ')');
                }
                await browser.screenshot(path.join(framesDir, 'f' + String(i).padStart(6, '0') + '.png'));
                if (i % 20 === 0 || i === totalFrames - 1) {
                    process.stdout.write('\r[browser.record] frame ' + (i + 1) + '/' + totalFrames);
                }
            }
        } catch (e) {
            try { fs.rmSync(framesDir, { recursive: true, force: true }); } catch { /* ignore */ }
            throw e;
        } finally {
            await browser.close();
        }
        process.stdout.write('\n');

        const wantWebm = dest.toLowerCase().endsWith('.webm');
        const args = ['-y', '-framerate', String(fps), '-i', path.join(framesDir, 'f%06d.png')];
        if (wantWebm) args.push('-c:v', 'libvpx-vp9', '-crf', '30', '-b:v', '0', '-pix_fmt', 'yuv420p');
        else args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p');
        args.push(dest);
        await ffmpeg(args);

        try { fs.rmSync(framesDir, { recursive: true, force: true }); } catch { /* ignore */ }
        if (!fs.existsSync(dest)) {
            throw new PluginFailure({ code: 'RECORD_FAILED', message: 'No video was produced.', retryable: true });
        }
        return { outputs: [{ path: dest, kind: 'video', meta: { url: target, frames: totalFrames, fps, width, height } }] };
    },
});
