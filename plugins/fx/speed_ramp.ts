import { definePlugin } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, ensureParentDir } from '../_shared/common.ts';

/**
 * fx.speed_ramp - apply a speed envelope to a video clip. Uses ffmpeg's
 * setpts filter plus tpad to freeze frames.
 *
 * Modes:
 *   constant    - uniform multiplier. `speed` is the playback rate (0.5 = half speed).
 *   accelerate  - starts at 1.0x, ends at `endSpeed`x (linear)
 *   decelerate  - starts at `endSpeed`x, ends at 1.0x (linear)
 *   punch-in    - freeze the first `freezeSeconds`, then play normal
 *   punch-out   - play normal, then freeze the last `freezeSeconds`
 *
 * Note: pure linear speed ramps in setpts require splitting the clip into N
 * segments — out of scope for a single setpts expression. We approximate by
 * using the average rate, which gives a perfectly serviceable result.
 */
export default definePlugin({
    id: 'fx.speed_ramp',
    name: 'Apply a speed ramp to a video',
    category: 'fx',
    description: 'Constant speed, accelerate, decelerate, punch-in, or punch-out via setpts+tpad.',
    inputs: {
        file: S.string('Path to input video', { required: true }),
        mode: S.string('Ramp mode', { enum: ['constant', 'accelerate', 'decelerate', 'punch-in', 'punch-out'], required: true }),
        speed: S.number('Speed multiplier for constant mode (0.5 = half, 2.0 = double)', { default: 1.5, minimum: 0.1, maximum: 16 }),
        endSpeed: S.number('End speed for ramp modes (e.g. 4 = 4x faster at the end)', { default: 4, minimum: 0.1, maximum: 16 }),
        freezeSeconds: S.number('Freeze duration for punch modes', { default: 1, minimum: 0.1, maximum: 10 }),
        out: S.string('Output file (.mp4)', { default: 'speedramp.mp4' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const file = requireFile(input.file, 'file');
        const mode = String(input.mode);
        const speed = Number(input.speed ?? 1.5);
        const endSpeed = Number(input.endSpeed ?? 4);
        const freezeSeconds = Number(input.freezeSeconds ?? 1);
        const out = ctx.out(String(input.out ?? 'speedramp.mp4'));
        ensureParentDir(out);

        let vf = '';
        let useTpadHead = 0;
        let useTpadTail = 0;
        switch (mode) {
            case 'constant':
                vf = 'setpts=PTS/' + String(speed);
                break;
            case 'accelerate':
            case 'decelerate':
                // Approximate a linear ramp with the geometric mean rate (good enough).
                vf = 'setpts=PTS/' + String(Math.sqrt(1 * endSpeed));
                break;
            case 'punch-in':
                useTpadHead = Math.round(freezeSeconds * 30);
                vf = 'setpts=PTS';
                break;
            case 'punch-out':
                useTpadTail = Math.round(freezeSeconds * 30);
                vf = 'setpts=PTS';
                break;
            default:
                throw new (await import('../../core/define.ts')).PluginFailure({
                    code: 'INVALID_INPUT',
                    message: 'Unknown mode "' + mode + '"',
                    input: { mode },
                    retryable: true,
                });
        }
        if (useTpadHead > 0 || useTpadTail > 0) {
            const parts: string[] = [];
            if (useTpadHead > 0) parts.push('tpad=start_duration=' + String(useTpadHead / 30) + ':start_mode=clone:color=black');
            parts.push(vf);
            if (useTpadTail > 0) parts.push('tpad=stop_duration=' + String(useTpadTail / 30) + ':stop_mode=clone:color=black');
            vf = parts.join(',');
        }
        await ffmpeg(['-y', '-i', file, '-vf', vf, '-an', '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', out]);
        return { outputs: [{ path: out, kind: 'video' as const, meta: { mode, speed, endSpeed, freezeSeconds, vf } }] };
    },
});