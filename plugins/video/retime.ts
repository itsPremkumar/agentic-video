import { definePlugin, PluginFailure } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, num, resolveOutPath } from '../_shared/common.ts';

/**
 * video.retime — real slow motion.
 *
 * `video.speed` retimes by dropping or duplicating frames. At 0.25x that means
 * every frame held four times, which reads as stutter, not slow motion. Proper
 * slow motion needs new frames between the ones you have: motion-compensated
 * interpolation.
 *
 * `minterpolate` is expensive, so it is opt-in via `mode`. `blend` is the cheap
 * middle ground (frame blending) and is a reasonable default for gentle ramps.
 */
export default definePlugin({
    id: 'video.retime',
    name: 'Retime with interpolation',
    category: 'video',
    description: 'Slow down or speed up with motion-compensated interpolation, so slow motion is smooth instead of stuttery.',
    inputs: {
        src: S.string('Source video', { required: true }),
        factor: S.number('Speed multiplier: 0.25 = quarter speed, 2 = twice as fast', { default: 0.5, minimum: 0.05 }),
        mode: S.string('Interpolation method — mci is best and slowest, blend is cheap, none is plain duplicating', {
            enum: ['mci', 'blend', 'none'],
            default: 'mci',
        }),
        fps: S.int('Output fps (0 = source fps)', { default: 0 }),
        adjustAudio: S.bool('Retime the audio to match', { default: true }),
        out: S.string('Output file name (.mp4)', { default: 'retimed.mp4' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const factor = num(input.factor, 0.5);
        const mode = String(input.mode ?? 'mci');
        const fps = num(input.fps, 0);
        const adjustAudio = input.adjustAudio !== false;

        if (factor <= 0) {
            throw new PluginFailure({
                code: 'INVALID_INPUT',
                message: 'factor must be greater than 0.',
                input: { factor },
                retryable: true,
                hint: '0.25 = quarter speed, 0.5 = half speed, 2 = twice as fast.',
            });
        }

        /**
         * atempo accepts 0.5–2.0 only, so anything outside is chained.
         * (Same approach as the per-clip speed in render.timeline.)
         */
        const atempo = (f: number): string => {
            const steps: string[] = [];
            let s = f;
            while (s > 2) {
                steps.push('atempo=2');
                s /= 2;
            }
            while (s < 0.5) {
                steps.push('atempo=0.5');
                s /= 0.5;
            }
            steps.push(`atempo=${Number(s.toFixed(6))}`);
            return steps.join(',');
        };

        // Slow the picture first, then generate the frames in between. Doing it
        // the other way round interpolates to the wrong cadence.
        const vf: string[] = [`setpts=${(1 / factor).toFixed(6)}*PTS`];
        if (mode === 'mci') {
            // vsbmc gives noticeably better results on camera motion, at a cost.
            vf.push(`minterpolate=fps=${fps || 30}:mi_mode=mci:mc_mode=aobmc:vsbmc=1`);
        } else if (mode === 'blend') {
            vf.push(`minterpolate=fps=${fps || 30}:mi_mode=blend`);
        } else if (fps) {
            vf.push(`fps=${fps}`);
        }

        const dest = resolveOutPath(ctx, String(input.out ?? 'retimed.mp4'));
        const args = ['-y', '-i', src, '-vf', vf.join(',')];
        if (adjustAudio) args.push('-af', atempo(factor));
        args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p');
        args.push(adjustAudio ? '-c:a' : '-an', ...(adjustAudio ? ['aac'] : []));
        args.push(dest);

        await ffmpeg(args);

        return {
            outputs: [
                {
                    path: dest,
                    kind: 'video',
                    meta: { factor, mode, fps: fps || 'source', interpolated: mode !== 'none' },
                },
            ],
            notes:
                mode === 'mci'
                    ? ['Motion-compensated interpolation is slow — expect several minutes per minute of 1080p footage.']
                    : [],
        };
    },
});
