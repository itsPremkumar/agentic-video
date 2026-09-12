import { definePlugin } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, num } from '../_shared/common.ts';

const ROTATIONS: Record<string, string> = {
    '90': 'transpose=1',
    '90ccw': 'transpose=2',
    '180': 'transpose=1,transpose=1',
    '270': 'transpose=2,transpose=2,transpose=2',
};

export default definePlugin({
    id: 'video.rotate',
    name: 'Rotate video',
    category: 'video',
    description: 'Rotate a video by 90 / 180 / 270 degrees, or an arbitrary angle.',
    inputs: {
        src: S.string('Source video path', { required: true }),
        angle: S.number('Degrees: 90, 180, 270, or any angle for free rotation', { required: true }),
        background: S.string('Fill colour for free rotation', { default: 'black' }),
        out: S.string('Output file name', { default: 'rotated.mp4' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const angle = num(input.angle, 0);
        const key = String(angle);
        const vf = ROTATIONS[key]
            ? ROTATIONS[key]
            : `rotate=${(angle * Math.PI) / 180}:fillcolor=${String(input.background ?? 'black')}`;
        const dest = ctx.out(String(input.out ?? 'rotated.mp4'));
        await ffmpeg(['-y', '-i', src, '-vf', vf, '-c:a', 'copy', dest]);
        return { outputs: [{ path: dest, kind: 'video' }] };
    },
});
