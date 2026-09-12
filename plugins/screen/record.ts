import * as fs from 'node:fs';
import * as os from 'node:os';
import { definePlugin, PluginFailure } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S } from '../_shared/common.ts';

/**
 * screen.record - capture the actual desktop to a video file.
 *
 * Platform tools:
 *   win32  -> ffmpeg gdigrab (desktop, or a window by title)
 *   darwin -> ffmpeg avfoundation
 *   linux  -> ffmpeg x11grab
 *
 * This records the real screen, not a browser. For recording a WEBSITE use
 * browser.record instead - it is frame-exact and does not depend on timing.
 */
export default definePlugin({
    id: 'screen.record',
    name: 'Record the desktop screen',
    category: 'video',
    description: 'Capture the desktop (or one window by title) to MP4 using the platform screen-grabber.',
    inputs: {
        duration: S.number('Recording length in seconds', { default: 10, minimum: 1, maximum: 600 }),
        fps: S.int('Frames per second', { default: 25, minimum: 1, maximum: 60 }),
        windowTitle: S.string('Record only this window (win32). Omit for the whole desktop.'),
        offsetX: S.int('Capture region left offset', { default: 0, minimum: 0 }),
        offsetY: S.int('Capture region top offset', { default: 0, minimum: 0 }),
        width: S.int('Capture width (0 = full screen)', { default: 0, minimum: 0 }),
        height: S.int('Capture height (0 = full screen)', { default: 0, minimum: 0 }),
        withAudio: S.bool('Also capture system audio (win32: requires a loopback device)', { default: false }),
        out: S.string('Output file name (.mp4)', { default: 'screen.mp4' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const platform = os.platform();
        const duration = Math.max(1, Number(input.duration ?? 10));
        const fps = Math.max(1, Math.min(60, Math.round(Number(input.fps ?? 25))));
        const dest = ctx.out(String(input.out ?? 'screen.mp4'));
        fs.mkdirSync(dest.slice(0, Math.max(dest.lastIndexOf('\\'), dest.lastIndexOf('/'))), { recursive: true });

        const args: string[] = ['-y'];
        if (platform === 'win32') {
            args.push('-f', 'gdigrab', '-framerate', String(fps));
            if (input.windowTitle) args.push('-i', 'title=' + String(input.windowTitle));
            else args.push('-i', 'desktop');
            if (input.withAudio) args.push('-f', 'dshow', '-i', 'audio=virtual-audio-capturer');
        } else if (platform === 'darwin') {
            args.push('-f', 'avfoundation', '-framerate', String(fps), '-i', input.withAudio ? '1:0' : '1:none');
        } else if (platform === 'linux') {
            const wh = Number(input.width) > 0 && Number(input.height) > 0
                ? '+' + String(input.offsetX ?? 0) + ',' + String(input.offsetY ?? 0)
                : '';
            args.push('-f', 'x11grab', '-framerate', String(fps), '-video_size',
                (Number(input.width) > 0 ? String(input.width) : '1920') + 'x' + (Number(input.height) > 0 ? String(input.height) : '1080'),
                '-i', ':0.0' + wh);
            if (input.withAudio) args.push('-f', 'pulse', '-i', 'default');
        } else {
            throw new PluginFailure({
                code: 'PLATFORM_UNSUPPORTED',
                message: 'screen.record does not support platform "' + platform + '".',
                retryable: false,
                hint: 'Use browser.record to capture web content instead.',
            });
        }
        args.push('-t', String(duration));
        args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p');
        if (input.withAudio) args.push('-c:a', 'aac', '-shortest');
        args.push(dest);

        await ffmpeg(args, { timeoutMs: (duration + 120) * 1000 });
        if (!fs.existsSync(dest)) {
            throw new PluginFailure({ code: 'SCREEN_RECORD_FAILED', message: 'No video was produced.', retryable: true });
        }
        return { outputs: [{ path: dest, kind: 'video', meta: { platform, duration, fps } }] };
    },
});
