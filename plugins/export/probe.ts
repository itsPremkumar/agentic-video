import * as fs from 'node:fs';
import { definePlugin } from '../../core/define.ts';
import { probe, ffmpeg, durationOf } from '../../core/media.ts';
import { S, requireFile } from '../_shared/common.ts';

/** export.probe — full technical report on a media file (quality gate helper). */
export default definePlugin({
    id: 'export.probe',
    name: 'Probe media file',
    category: 'export',
    description: 'Report duration, size, codecs, streams, and run a black-frame check.',
    inputs: {
        src: S.string('Media file path', { required: true }),
        blackCheck: S.bool('Also scan for black frames', { default: true }),
    },
    outputs: ['data'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const info = await probe(src);
        const duration = await durationOf(src);
        const video = (info.streams ?? []).find((s: Record<string, unknown>) => s.codec_type === 'video');
        const audio = (info.streams ?? []).find((s: Record<string, unknown>) => s.codec_type === 'audio');

        const warnings: string[] = [];
        if (!video) warnings.push('No video stream found.');
        if (!audio) warnings.push('No audio stream found.');
        if (duration <= 0) warnings.push('Duration is zero — the file may be empty.');

        let blackFrames: string[] = [];
        if (input.blackCheck !== false && video) {
            const res = await ffmpegCapture(src);
            blackFrames = res;
            if (blackFrames.length) warnings.push(`${blackFrames.length} black segment(s) detected.`);
        }

        const meta = {
            path: src,
            duration,
            bytes: fs.statSync(src).size,
            format: info.format?.format_name ?? null,
            video: video
                ? { codec: video.codec_name, width: video.width, height: video.height, fps: video.r_frame_rate }
                : null,
            audio: audio ? { codec: audio.codec_name, sampleRate: audio.sample_rate, channels: audio.channels } : null,
            blackFrames,
        };
        const dest = ctx.out(`probe_${Date.now()}.json`);
        fs.writeFileSync(dest, JSON.stringify(meta, null, 2), 'utf8');
        return { outputs: [{ path: dest, kind: 'data', meta }], warnings };
    },
});

async function ffmpegCapture(src: string): Promise<string[]> {
    const { run, resolveFfmpeg } = await import('../../core/media.ts');
    const res = await run(resolveFfmpeg(), [
        '-i', src, '-vf', 'blackdetect=d=0.5:pix_th=0.05', '-f', 'null', '-',
    ]);
    return (res.stderr.match(/blackdetect[^\\n]*/g) ?? []).slice(0, 20);
}
