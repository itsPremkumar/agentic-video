import * as fs from 'node:fs';
import { definePlugin, PluginFailure } from '../../core/define.ts';
import { S, requireFile, num } from '../_shared/common.ts';

interface Cue {
    start: number;
    end: number;
    text: string;
}

function parseSrt(content: string): Cue[] {
    const blocks = content.replace(/\r/g, '').split(/\n{2,}/);
    const cues: Cue[] = [];
    for (const block of blocks) {
        const lines = block.split('\n').filter((l) => l.trim());
        if (lines.length < 2) continue;
        const timeLine = lines.find((l) => l.includes('-->'));
        if (!timeLine) continue;
        const [startRaw, endRaw] = timeLine.split('-->').map((s) => s.trim());
        const toSec = (t: string): number => {
            const m = t.replace(',', '.').match(/(\d+):(\d+):(\d+(?:\.\d+)?)/);
            if (!m) return 0;
            return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
        };
        const text = lines.slice(lines.indexOf(timeLine) + 1).join('\n').trim();
        if (!text) continue;
        cues.push({ start: toSec(startRaw), end: toSec(endRaw), text });
    }
    return cues;
}

export default definePlugin({
    id: 'subtitle.convert',
    name: 'Convert subtitles (format / retime)',
    category: 'subtitle',
    description: 'Convert SRT↔VTT and optionally shift every cue by an offset.',
    inputs: {
        src: S.string('Subtitle file path', { required: true }),
        format: S.string('Target format', { enum: ['srt', 'vtt'], required: true }),
        shift: S.number('Shift all cues by this many seconds', { default: 0 }),
        out: S.string('Output file name'),
    },
    outputs: ['subtitle'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const format = String(input.format);
        const shift = num(input.shift, 0);
        const cues = parseSrt(fs.readFileSync(src, 'utf8'));
        if (!cues.length) {
            throw new PluginFailure({
                code: 'PARSE_FAILED',
                message: `No subtitle cues could be parsed from ${src}.`,
                reason: 'The file does not contain recognisable SRT blocks.',
                input: { src },
                retryable: true,
                hint: 'Only SRT input is supported for conversion.',
            });
        }
        const fmt = (t: number): string => {
            const v = Math.max(0, t + shift);
            // Integer-millisecond math: the ms field must never round up to 1000.
            const totalMs = Math.max(0, Math.round((Number.isFinite(v) ? v : 0) * 1000));
            const h = Math.floor(totalMs / 3600000);
            const m = Math.floor((totalMs % 3600000) / 60000);
            const s = Math.floor((totalMs % 60000) / 1000);
            const ms = totalMs % 1000;
            const sep = format === 'vtt' ? '.' : ',';
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${sep}${String(ms).padStart(3, '0')}`;
        };
        const lines: string[] = [];
        if (format === 'vtt') lines.push('WEBVTT', '');
        cues.forEach((c, i) => {
            if (format === 'srt') lines.push(String(i + 1));
            lines.push(`${fmt(c.start)} --> ${fmt(c.end)}`, c.text, '');
        });
        const dest = ctx.out(String(input.out ?? `converted.${format}`));
        fs.writeFileSync(dest, lines.join('\n'), 'utf8');
        return { outputs: [{ path: dest, kind: 'subtitle', meta: { cues: cues.length, shift } }] };
    },
});
