import * as fs from 'node:fs';
import { definePlugin } from '../../core/define.ts';
import { ffmpeg, probe } from '../../core/media.ts';
import { S, requireFile, ensureParentDir } from '../_shared/common.ts';

/**
 * export.derivative - re-render a finished video to one or more aspect ratios
 * for multi-platform distribution (9:16 for reels/stories, 16:9 for YouTube,
 * 1:1 for Instagram), plus extract a thumbnail.
 *
 * The video is fit-scaled and letterboxed/pillarboxed onto the new canvas.
 */
export default definePlugin({
    id: 'export.derivative',
    name: 'Re-render a video to multiple aspect ratios + extract a thumbnail',
    category: 'distribute',
    description: 'One input, many outputs: 9:16, 16:9, 1:1, plus thumbnail PNG.',
    inputs: {
        file: S.string('Path to the master video', { required: true }),
        aspects: S.array('Target aspect ratios to render', { default: ['16:9', '9:16', '1:1'] }),
        thumbAt: S.number('Frame time for the thumbnail in seconds', { default: 1 }),
        thumbWidth: S.int('Thumbnail width', { default: 1280 }),
        bg: S.string('Letterbox/pillarbox background colour', { default: '#000000' }),
        prefix: S.string('Output file name prefix', { default: 'der' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const file = requireFile(input.file, 'file');
        const info = await probe(file);
        const streams = (info.streams ?? []) as Array<Record<string, unknown>>;
        const v = streams.find((s) => s.codec_type === 'video');
        const srcW = Number(v?.width ?? 1280);
        const srcH = Number(v?.height ?? 720);
        const aspects = (Array.isArray(input.aspects) ? input.aspects : ['16:9', '9:16', '1:1']).map((s) => String(s));
        const prefix = String(input.prefix ?? 'der');
        const bg = String(input.bg ?? '#000000');
        const thumbAt = Math.max(0, Number(input.thumbAt ?? 1));
        const thumbW = Math.max(64, Number(input.thumbWidth ?? 1280));

        const outputs: Array<{ path: string; kind: 'video' | 'image'; meta?: Record<string, unknown> }> = [];

        // Derive each aspect ratio
        for (const asp of aspects) {
            const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(asp);
            if (!m) continue;
            const aw = Number(m[1]);
            const ah = Number(m[2]);
            const outW = aw >= ah ? 1280 : Math.round(1280 * aw / ah);
            const outH = aw >= ah ? Math.round(1280 * ah / aw) : 1280;
            const fileName = prefix + '-' + asp.replace(':', 'x') + '.mp4';
            const dest = ctx.out(fileName);
            ensureParentDir(dest);
            // fit source into output with letterbox/pillarbox
            const srcAr = srcW / srcH;
            const dstAr = outW / outH;
            let scaleW: number; let scaleH: number;
            if (srcAr > dstAr) {
                scaleW = outW;
                scaleH = Math.round(outW / srcAr);
            } else {
                scaleH = outH;
                scaleW = Math.round(outH * srcAr);
            }
            const padX = Math.round((outW - scaleW) / 2);
            const padY = Math.round((outH - scaleH) / 2);
            const filter = 'scale=' + String(scaleW) + ':' + String(scaleH) + ':force_original_aspect_ratio=decrease,' +
                'pad=' + String(outW) + ':' + String(outH) + ':' + String(padX) + ':' + String(padY) + ':' + bg;
            await ffmpeg(['-y', '-i', file, '-vf', filter, '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-c:a', 'copy', dest]);
            outputs.push({ path: dest, kind: 'video' as const, meta: { aspect: asp, width: outW, height: outH, bytes: fs.statSync(dest).size } });
        }

        // Thumbnail
        const thumbDest = ctx.out(prefix + '-thumb.png');
        ensureParentDir(thumbDest);
        await ffmpeg(['-y', '-ss', String(thumbAt), '-i', file, '-vf', 'scale=' + String(thumbW) + ':-1', '-frames:v', '1', thumbDest]);
        outputs.push({ path: thumbDest, kind: 'image' as const, meta: { width: thumbW, sourceAt: thumbAt } });

        return { outputs };
    },
});