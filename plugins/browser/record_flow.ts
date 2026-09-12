import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { definePlugin, PluginFailure } from '../../core/define.ts';
import { launch, runActions, videoPath, type Action } from '../../core/playwright.ts';
import { S } from '../_shared/common.ts';

/**
 * browser.record_flow — record a video of a website being used.
 *
 * This is the "open the site, scroll it, click around, and film it" plugin.
 * Playwright records the page natively while the actions run, so the result is
 * a real walkthrough rather than a slideshow of screenshots.
 *
 * Two details matter and are easy to get wrong:
 *  - the video file only exists AFTER the browser context is closed, so the
 *    path is read after close, never before;
 *  - recording alone is not the goal — `scroll` actions move in increments so
 *    the footage shows the page travelling instead of teleporting.
 */
export default definePlugin({
    id: 'browser.record_flow',
    name: 'Record a website walkthrough',
    category: 'video',
    description: 'Record video of a website while driving it (navigate, scroll, click, type). Produces MP4 via Playwright + ffmpeg.',
    inputs: {
        actions: S.array('Ordered list of actions to perform while recording', { required: true }),
        url: S.string('Optional start URL (shorthand for a leading navigate action)'),
        width: S.int('Viewport width', { default: 1280, minimum: 200 }),
        height: S.int('Viewport height', { default: 720, minimum: 200 }),
        headless: S.bool('Run headless', { default: true }),
        slowMo: S.int('Slow each action by N ms — makes the recording readable', { default: 120, minimum: 0 }),
        darkMode: S.bool('Emulate prefers-color-scheme: dark', { default: false }),
        settleMs: S.int('Hold on the final state before stopping, ms', { default: 800, minimum: 0 }),
        toMp4: S.bool('Transcode the Playwright .webm to MP4 (H.264)', { default: true }),
        out: S.string('Output file name', { default: 'flow.mp4' }),
    },
    outputs: ['video', 'json'],
    async run({ input, ctx }) {
        const raw = input.actions;
        if (!Array.isArray(raw) || !raw.length) {
            throw new PluginFailure({
                code: 'INVALID_INPUT',
                message: '"actions" must be a non-empty array.',
                retryable: true,
                hint: 'e.g. [{type:"navigate",url:"https://example.com"},{type:"scroll",dy:2000},{type:"click",target:{text:"Docs"}}]',
            });
        }
        const actions = raw as Action[];
        if (input.url) actions.unshift({ type: 'navigate', url: String(input.url) });

        const width = Number(input.width ?? 1280);
        const height = Number(input.height ?? 720);
        const videoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenticvideo-video-'));
        const warnings: string[] = [];

        const session = await launch({
            width, height,
            headless: input.headless !== false,
            slowMo: Number(input.slowMo ?? 120),
            videoDir,
            colorScheme: input.darkMode ? 'dark' : undefined,
        });

        let log: { index: number; type: string; ok: boolean; detail?: string }[] = [];
        let finalUrl = '';
        let videoRef: unknown = null;
        let truncated = false;
        try {
            const { page } = session;
            // Capture the Video object BEFORE close — after close the page is
            // detached and page.video() may return undefined.
            videoRef = page.video();
            try {
                log = await runActions(page, actions, {
                    outDir: ctx.workspaceDir,
                    out: (name: string) => ctx.out(name),
                });
                if (Number(input.settleMs ?? 0) > 0) await page.waitForTimeout(Number(input.settleMs));
            } catch (e) {
                // The recording itself succeeded; only the scripted actions
                // stopped early. Ship the partial video with a warning so the
                // calling agent can retry the failed interaction in isolation.
                truncated = true;
                warnings.push(`Flow stopped at action ${log.length + 1}: ${(e as Error).message}`);
            }
            finalUrl = page.url();
        } finally {
            await session.close();
        }

        const src = await videoPath(videoRef as never);
        if (!src || !fs.existsSync(src)) {
            throw new PluginFailure({
                code: 'RECORD_FAILED',
                message: 'Playwright did not produce a video file.',
                reason: 'No video was written for this browser context.',
                input: { url: input.url, actions: actions.length },
                retryable: true,
                hint: 'Ensure at least one navigate action runs and the page is not closed before recording finishes.',
            });
        }

        const dest = ctx.out(String(input.out ?? 'flow.mp4'));
        if (input.toMp4 !== false) {
            const { ffmpeg } = await import('../../core/media.ts');
            await ffmpeg([
                '-y', '-i', src,
                '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
                '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
                '-vf', `scale=trunc(iw/2)*2:trunc(ih/2)*2`,
                dest,
            ]);
        } else {
            fs.copyFileSync(src, dest);
            warnings.push('Output is Playwright-native .webm (toMp4=false).');
        }

        const logPath = ctx.out('flow-actions.json');
        fs.writeFileSync(logPath, JSON.stringify({ url: finalUrl, truncated, actions: log }, null, 2), 'utf8');

        return {
            outputs: [
                { path: dest, kind: 'video' as const, meta: { url: finalUrl, actions: log.length, truncated } },
                { path: logPath, kind: 'json' as const, meta: { actions: log.length } },
            ],
            warnings: warnings.length ? warnings : undefined,
        };
    },
});
