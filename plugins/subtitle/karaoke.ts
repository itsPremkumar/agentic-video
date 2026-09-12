import * as fs from 'node:fs';
import { definePlugin } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, ensureParentDir } from '../_shared/common.ts';
import { fontfileArg } from '../_shared/font.ts';

/**
 * subtitle.karaoke - generate timed caption subtitles and optionally burn them
 * into a video. Two modes:
 *
 *   1. words[] + duration  -> distribute the words evenly across the duration
 *                             (no ASR available, deterministic)
 *   2. cues[]              -> {text, start, end} pairs (use any SRT/VTT the
 *                             agent produces)
 *
 * Returns both the .srt file and (if burnIn=true) the captioned .mp4.
 */
interface Cue { text: string; start: number; end: number }

export default definePlugin({
    id: 'subtitle.karaoke',
    name: 'Generate timed captions (SRT) and optionally burn them into video',
    category: 'subtitle',
    description: 'Even-distributed word captions from a word list, or precise cues from an SRT-shaped array.',
    inputs: {
        words: S.array('Plain words (even distribution by duration)'),
        cues: S.array('Pre-timed cues: [{text, start, end}]'),
        duration: S.number('Total audio/video duration in seconds (required for words mode)'),
        gap: S.number('Inter-cue gap in seconds (for words mode)', { default: 0.05 }),
        burnIn: S.bool('Also burn the captions into a video', { default: false }),
        file: S.string('Video to burn captions into (required if burnIn=true)'),
        width: S.int('Caption font size as fraction of video height', { default: 7 }),
        position: S.string('Caption position', { enum: ['bottom', 'top', 'middle'], default: 'bottom' }),
        color: S.string('Caption colour (hex)', { default: '#ffffff' }),
        bg: S.string('Caption background colour (hex)', { default: '#000000' }),
        bgOpacity: S.number('Caption background opacity (0-1)', { default: 0.6 }),
        srtOut: S.string('Output SRT path', { default: 'captions.srt' }),
        videoOut: S.string('Output video path (only if burnIn=true)', { default: 'captioned.mp4' }),
    },
    outputs: ['subtitle'],
    async run({ input, ctx }) {
        const gap = Math.max(0, Number(input.gap ?? 0.05));
        const duration = Number(input.duration ?? 0);
        const words = Array.isArray(input.words) ? (input.words as unknown[]).map((w) => String(w)) : [];
        const rawCues = Array.isArray(input.cues) ? (input.cues as Array<Record<string, unknown>>) : [];

        let cues: Cue[];
        if (rawCues.length > 0) {
            cues = rawCues.map((c) => ({
                text: String(c.text ?? ''),
                start: Number(c.start ?? 0),
                end: Number(c.end ?? 0),
            }));
        } else if (words.length > 0 && duration > 0) {
            const slot = (duration - gap * (words.length - 1)) / words.length;
            cues = words.map((w, i) => ({
                text: w,
                start: i * (slot + gap),
                end: i * (slot + gap) + slot,
            }));
        } else {
            throw new (await import('../../core/define.ts')).PluginFailure({
                code: 'INVALID_INPUT',
                message: 'Provide either `words` + `duration`, or `cues` array.',
                input: { hasWords: words.length, duration },
                retryable: true,
            });
        }

        const srt = toSrt(cues);
        const srtOut = ctx.out(String(input.srtOut ?? 'captions.srt'));
        ensureParentDir(srtOut);
        fs.writeFileSync(srtOut, srt);

        const outputs: Array<{ path: string; kind: 'subtitle' | 'video'; meta?: Record<string, unknown> }> = [
            { path: srtOut, kind: 'subtitle' as const, meta: { cueCount: cues.length, duration: cues.length ? cues[cues.length - 1].end : 0 } },
        ];

        if (input.burnIn === true) {
            const file = requireFile(input.file, 'file');
            const fontSizePct = Math.max(2, Math.min(15, Number(input.width ?? 7)));
            const position = String(input.position ?? 'bottom');
            const color = String(input.color ?? '#ffffff');
            const bg = String(input.bg ?? '#000000');
            const bgOpacity = Math.max(0, Math.min(1, Number(input.bgOpacity ?? 0.6)));
            const ff = fontfileArg();

            const videoOut = ctx.out(String(input.videoOut ?? 'captioned.mp4'));
            ensureParentDir(videoOut);

            const probeRes = await ffmpeg(['-i', file, '-hide_banner'], { timeoutMs: 30_000 }).catch((e) => ({ stderr: String(e), code: -1, stdout: '' }));
            const h = probeH(probeRes.stderr);
            const fontSize = Math.max(16, Math.round((h || 720) * fontSizePct / 100));
            const yPos = position === 'top' ? 60 : position === 'middle' ? `(h-${String(fontSize * 2)})/2` : `h-${String(fontSize * 2)}-80`;
            const boxY = position === 'top' ? 50 : position === 'middle' ? `(h-${String(fontSize * 2)})/2-10` : `h-${String(fontSize * 2)}-90`;

            // Build a drawbox+drawn text per cue using enable=between(t,start,end)
            const filterParts: string[] = [];
            for (let i = 0; i < cues.length; i++) {
                const c = cues[i];
                const escaped = c.text.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
                const enable = "enable='between(t," + c.start.toFixed(3) + "," + c.end.toFixed(3) + ")'";
                filterParts.push(
                    'drawbox=x=(w-' + String(Math.round(fontSize * 12)) + ')/2:y=' + boxY +
                    ':w=' + String(Math.round(fontSize * 12)) + ':h=' + String(fontSize * 2 + 20) +
                    ':color=' + bg + '@' + bgOpacity.toFixed(2) + ':t=fill:' + enable,
                );
                filterParts.push(
                    'drawtext=' + ff + 'text=' + escaped + ':fontsize=' + String(fontSize) + ':fontcolor=' + color +
                    ':x=(w-text_w)/2:y=' + yPos + ':' + enable,
                );
            }
            const filter = filterParts.join(',');

            await ffmpeg(['-y', '-i', file, '-vf', filter, '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-c:a', 'copy', videoOut]);
            outputs.push({ path: videoOut, kind: 'video' as const, meta: { cues: cues.length, burnedIn: true } });
        }

        return { outputs };
    },
});

function toSrt(cues: Cue[]): string {
    const blocks: string[] = [];
    for (let i = 0; i < cues.length; i++) {
        const c = cues[i];
        blocks.push(String(i + 1));
        blocks.push(formatSrtTime(c.start) + ' --> ' + formatSrtTime(c.end));
        blocks.push(c.text);
        blocks.push('');
    }
    return blocks.join('\n');
}

function formatSrtTime(t: number): string {
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = Math.floor(t % 60);
    const ms = Math.round((t - Math.floor(t)) * 1000);
    return pad(h) + ':' + pad(m) + ':' + pad(s) + ',' + pad(ms, 3);
}
function pad(n: number, w = 2): string {
    return String(n).padStart(w, '0');
}
function probeH(stderr: string): number {
    const m = /, (\d+)x(\d+)[ ,]/.exec(stderr);
    if (!m) return 0;
    return Number(m[2]);
}