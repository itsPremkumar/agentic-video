import { definePlugin, PluginFailure } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile } from '../_shared/common.ts';

export default definePlugin({
    id: 'audio.merge',
    name: 'Mix audio tracks',
    category: 'audio',
    description: 'Mix two or more audio files together (e.g. voiceover + background music).',
    inputs: {
        sources: S.array('Array of audio paths to mix', { required: true }),
        weights: S.array('Optional per-source volume multipliers, e.g. [1, 0.25]'),
        duration: S.string('Match length: first, longest, shortest', { default: 'longest' }),
        normalize: S.bool('Run loudnorm on the result', { default: true }),
        out: S.string('Output file name', { default: 'mixed.mp3' }),
    },
    outputs: ['audio'],
    async run({ input, ctx }) {
        const list = Array.isArray(input.sources) ? (input.sources as unknown[]) : [];
        if (list.length < 2) {
            throw new PluginFailure({
                code: 'INVALID_INPUT',
                message: 'sources must contain at least 2 audio paths.',
                input: { sources: input.sources },
                retryable: true,
            });
        }
        const files = list.map((s, i) => requireFile(s, `sources[${i}]`));
        const weights = Array.isArray(input.weights) ? (input.weights as number[]) : files.map(() => 1);

        const inputs: string[] = [];
        for (const f of files) inputs.push('-i', f);
        const labels = files.map((_, i) => `[${i}:a]volume=${weights[i] ?? 1}[a${i}]`).join(';');
        const mix = `${files.map((_, i) => `[a${i}]`).join('')}amix=inputs=${files.length}:duration=${String(input.duration ?? 'longest')}:dropout_transition=0[mixed]`;
        // loudnorm MUST live inside the complex graph -- mixing -af with -filter_complex
        // is rejected by ffmpeg ("Simple and complex filtering cannot be used together").
        const tail =
            input.normalize === false
                ? '[mixed]anull[out]'
                : '[mixed]loudnorm=I=-16:TP=-1.5:LRA=11[out]';
        const af = `${labels};${mix};${tail}`;

        const dest = ctx.out(String(input.out ?? 'mixed.mp3'));
        const args = ['-y', ...inputs, '-filter_complex', af, '-map', '[out]'];
        args.push(dest);
        await ffmpeg(args);
        return { outputs: [{ path: dest, kind: 'audio', meta: { tracks: files.length } }] };
    },
});
