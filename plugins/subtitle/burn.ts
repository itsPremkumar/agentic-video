import { definePlugin } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, num } from '../_shared/common.ts';

export default definePlugin({
    id: 'subtitle.burn',
    name: 'Burn subtitles into video',
    category: 'subtitle',
    description: 'Permanently render an SRT/ASS subtitle file onto a video.',
    inputs: {
        src: S.string('Source video path', { required: true }),
        subtitles: S.string('Subtitle file path (.srt / .ass)', { required: true }),
        fontSize: S.int('Font size', { default: 24 }),
        color: S.string('Text colour (ASS format, e.g. &H00FFFFFF)', { default: '&H00FFFFFF' }),
        outlineColor: S.string('Outline colour', { default: '&H00000000' }),
        outline: S.number('Outline thickness 0..4', { default: 2, minimum: 0, maximum: 4 }),
        marginV: S.int('Bottom margin in pixels', { default: 40 }),
        fontName: S.string('Font family name', { default: 'Arial' }),
        out: S.string('Output file name', { default: 'subtitled.mp4' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const subs = requireFile(input.subtitles, 'subtitles');
        const dest = ctx.out(String(input.out ?? 'subtitled.mp4'));
        const style = `FontName=${String(input.fontName ?? 'Arial')},Fontsize=${num(input.fontSize, 24)},` +
            `PrimaryColour=${String(input.color ?? '&H00FFFFFF')},OutlineColour=${String(input.outlineColor ?? '&H00000000')},` +
            `BorderStyle=1,Outline=${num(input.outline, 2)},Shadow=0,MarginV=${num(input.marginV, 40)}`;
        const escaped = subs.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
        await ffmpeg([
            '-y', '-i', src,
            '-vf', `subtitles='${escaped}':force_style='${style}'`,
            '-c:a', 'copy', dest,
        ]);
        return { outputs: [{ path: dest, kind: 'video' }] };
    },
});
