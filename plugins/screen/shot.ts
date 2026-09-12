import * as fs from 'node:fs';
import * as os from 'node:os';
import { definePlugin, PluginFailure } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S } from '../_shared/common.ts';

/** screen.shot - grab a single still of the desktop. */
export default definePlugin({
    id: 'screen.shot',
    name: 'Capture the desktop screen',
    category: 'image',
    description: 'Take one still screenshot of the desktop (or one window by title).',
    inputs: {
        windowTitle: S.string('Capture only this window (win32). Omit for the whole desktop.'),
        out: S.string('Output file name (.png)', { default: 'screen.png' }),
    },
    outputs: ['image'],
    async run({ input, ctx }) {
        const platform = os.platform();
        const dest = ctx.out(String(input.out ?? 'screen.png'));
        fs.mkdirSync(dest.slice(0, Math.max(dest.lastIndexOf('\\'), dest.lastIndexOf('/'))), { recursive: true });
        const args: string[] = ['-y'];
        if (platform === 'win32') {
            args.push('-f', 'gdigrab', '-frames:v', '1');
            args.push('-i', input.windowTitle ? 'title=' + String(input.windowTitle) : 'desktop');
        } else if (platform === 'darwin') {
            args.push('-f', 'avfoundation', '-frames:v', '1', '-i', '1:none');
        } else if (platform === 'linux') {
            args.push('-f', 'x11grab', '-frames:v', '1', '-i', ':0.0');
        } else {
            throw new PluginFailure({
                code: 'PLATFORM_UNSUPPORTED',
                message: 'screen.shot does not support platform "' + platform + '".',
                retryable: false,
                hint: 'Use browser.screenshot to capture web content instead.',
            });
        }
        args.push(dest);
        await ffmpeg(args, { timeoutMs: 60_000 });
        if (!fs.existsSync(dest)) {
            throw new PluginFailure({ code: 'SCREEN_SHOT_FAILED', message: 'No image was produced.', retryable: true });
        }
        return { outputs: [{ path: dest, kind: 'image', meta: { platform } }] };
    },
});
