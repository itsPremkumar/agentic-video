import * as fs from 'node:fs';
import { definePlugin, PluginFailure } from '../../core/define.ts';
import { S } from '../_shared/common.ts';

function srtTime(t: number): string {
    // Integer-millisecond math: the ms field must never round up to 1000.
    const totalMs = Math.max(0, Math.round((Number.isFinite(t) ? t : 0) * 1000));
    const h = Math.floor(totalMs / 3600000);
    const m = Math.floor((totalMs % 3600000) / 60000);
    const s = Math.floor((totalMs % 60000) / 1000);
    const ms = totalMs % 1000;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function vttTime(t: number): string {
    return srtTime(t).replace(',', '.');
}

export default definePlugin({
    id: 'subtitle.create',
    name: 'Create subtitle file',
    category: 'subtitle',
    description: 'Build an SRT or VTT subtitle file from timed cues.',
    inputs: {
        cues: S.array('Array of {start, end, text} with times in seconds', { required: true }),
        format: S.string('Subtitle format', { enum: ['srt', 'vtt'], default: 'srt' }),
        out: S.string('Output file name'),
    },
    outputs: ['subtitle'],
    async run({ input, ctx }) {
        const cues = Array.isArray(input.cues) ? (input.cues as Record<string, unknown>[]) : [];
        if (!cues.length) {
            throw new PluginFailure({
                code: 'INVALID_INPUT',
                message: 'cues must be a non-empty array of {start, end, text}.',
                input: { cues: input.cues },
                retryable: true,
            });
        }
        const format = String(input.format ?? 'srt');
        const lines: string[] = [];
        if (format === 'vtt') lines.push('WEBVTT', '');

        cues.forEach((c, i) => {
            const start = Number(c.start ?? 0);
            const end = Number(c.end ?? start + 2);
            const text = String(c.text ?? '').trim();
            if (!text) return;
            const fmt = format === 'vtt' ? vttTime : srtTime;
            if (format === 'srt') lines.push(String(i + 1));
            lines.push(`${fmt(start)} --> ${fmt(end)}`, text, '');
        });

        const dest = ctx.out(String(input.out ?? `subtitles.${format}`));
        fs.writeFileSync(dest, lines.join('\n'), 'utf8');
        return { outputs: [{ path: dest, kind: 'subtitle', meta: { cues: cues.length, format } }] };
    },
});
