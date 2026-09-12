import { definePlugin } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, ensureParentDir } from '../_shared/common.ts';

/**
 * fx.vintage - apply a stylised colour/look filter. Quick presets that pair well
 * with motion graphics or B-roll. Each preset composes ffmpeg filters.
 */
const LOOKS: Record<string, string> = {
    vintage: 'curves=preset=darker,eq=saturation=0.7:contrast=0.95,colorbalance=rs=0.05:bh=0.03,vignette=PI/4',
    sepia: 'colorbalance=rs=0.15:gs=0.07:bs=-0.15,eq=saturation=0.6,vignette=PI/4',
    bleach: 'eq=contrast=1.25:saturation=0.4:brightness=1.08,curves=preset=darker',
    noir: 'eq=contrast=1.4:saturation=0,curves=preset=darker',
    polaroid: 'colorbalance=rs=0.06:gs=0.03:bs=-0.04,eq=saturation=0.85:contrast=1.05:brightness=1.03',
    film70s: 'curves=preset=increase_contrast,colorbalance=rs=0.08:gs=0.04:bs=-0.06,eq=saturation=0.85',
    film80s: 'colorbalance=rs=0.05:bs=-0.05:gh=0.04,eq=saturation=0.9:contrast=1.05',
    vhs: 'curves=preset=darker,eq=saturation=1.1:gamma=1.1,noise=alls=15:allf=t+u,hue=s=5',
    dreamy: 'curves=preset=lighter,eq=saturation=0.8:brightness=1.05:contrast=0.95,colorbalance=gh=0.05',
    cold: 'colorbalance=bs=0.05:rs=-0.03,eq=contrast=1.05:gamma=0.95',
    warm: 'colorbalance=rs=0.05:bs=-0.05,eq=contrast=1.05:gamma=1.05',
    punchy: 'eq=contrast=1.2:saturation=1.3:brightness=1.05',
    pastel: 'eq=saturation=0.6:contrast=0.85:brightness=1.1',
    mono: 'hue=s=0',
};

export default definePlugin({
    id: 'fx.vintage',
    name: 'Apply a vintage / stylised look',
    category: 'fx',
    description: 'Vintage, sepia, bleach, noir, polaroid, 70s, 80s, VHS, dreamy, cold, warm, punchy, pastel, or mono.',
    inputs: {
        file: S.string('Path to input video', { required: true }),
        look: S.string('Look name', { enum: Object.keys(LOOKS), required: true }),
        out: S.string('Output file (.mp4)', { default: 'fx-look.mp4' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const file = requireFile(input.file, 'file');
        const look = String(input.look);
        const filter = LOOKS[look];
        if (!filter) {
            throw new (await import('../../core/define.ts')).PluginFailure({
                code: 'UNKNOWN_LOOK',
                message: 'Unknown look "' + look + '"',
                input: { look },
                retryable: true,
            });
        }
        const out = ctx.out(String(input.out ?? 'fx-look.mp4'));
        ensureParentDir(out);
        await ffmpeg(['-y', '-i', file, '-vf', filter, '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-c:a', 'copy', out]);
        return { outputs: [{ path: out, kind: 'video' as const, meta: { look, filter } }] };
    },
});