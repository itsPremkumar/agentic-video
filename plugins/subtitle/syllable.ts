import { definePlugin } from '../../core/define.ts';
import { tokenize, splitSentences } from '../text/_shared.ts';
import { S } from '../_shared/common.ts';

/**
 * subtitle.syllable - synthesise per-syllable caption timings from raw text.
 *
 * Heuristic (the industry-standard "165 ms per syllable" rule, capped at
 * [120, 600] ms). Inter-word gaps default to 40 ms. The result is a .srt and
 * an 8-style CSS palette (caption look) so the external agent can route the
 * timings straight into a drawtext-style renderer.
 *
 * Input text is split into:
 *   1. lines (by \n)
 *   2. sentences (by . ! ?)
 *   3. words within sentences
 *   4. syllables within words (rough vowel-cluster split)
 *
 * Each syllable becomes one caption cue, groupable up to `maxWordsPerCue` for
 * karaoke-style "two words at a time" rendering.
 */
export default definePlugin({
    id: 'subtitle.syllable',
    name: 'Syllable-timed captions (SRT + caption-style palette)',
    category: 'subtitle',
    description:
        'Synthesise per-syllable caption timings (165 ms/syllable, clamped [120,600], 40 ms inter-word gap). Emits .srt and an 8-style CSS palette.',
    inputs: {
        script: S.string('Raw script text (one caption line per sentence)', { required: true }),
        msPerSyllable: S.int('Average ms per syllable', { default: 165, minimum: 80, maximum: 400 }),
        minMs: S.int('Minimum cue length (ms)', { default: 120, minimum: 50, maximum: 400 }),
        maxMs: S.int('Maximum cue length (ms)', { default: 600, minimum: 200, maximum: 2000 }),
        gapMs: S.int('Inter-word gap (ms)', { default: 40, minimum: 0, maximum: 400 }),
        maxWordsPerCue: S.int('Group up to N words into one cue (1 = per-word)', {
            default: 2,
            minimum: 1,
            maximum: 6,
        }),
        out: S.string('Output SRT path', { default: 'captions.srt' }),
        styleOut: S.string('Output JSON path for caption-style palette', { default: 'caption-style.json' }),
        stylePreset: S.string('Caption style preset', {
            enum: ['bold-yellow', 'soft-white', 'kinetic-pop', 'editorial', 'podcast', 'tiktok-caption', 'news-lowerthird', 'karaoke'],
            default: 'bold-yellow',
        }),
    },
    outputs: ['subtitle', 'json'],
    async run({ input, ctx }) {
        const script = String(input.script ?? '').trim();
        if (!script) return { outputs: [], warnings: ['Empty script.'] };

        const ms = Math.max(80, Math.min(400, Number(input.msPerSyllable ?? 165)));
        const minMs = Math.max(50, Math.min(400, Number(input.minMs ?? 120)));
        const maxMs = Math.max(200, Math.min(2000, Number(input.maxMs ?? 600)));
        const gapMs = Math.max(0, Math.min(400, Number(input.gapMs ?? 40)));
        const maxWords = Math.max(1, Math.min(6, Number(input.maxWordsPerCue ?? 2)));
        const srtPath = ctx.out(String(input.out ?? 'captions.srt'));
        const stylePath = ctx.out(String(input.styleOut ?? 'caption-style.json'));
        const preset = String(input.stylePreset ?? 'bold-yellow');

        // Sentence-by-sentence, then words, then syllable groups.
        const sentences = splitSentences(script);
        type Cue = { idx: number; start: number; end: number; text: string };
        const cues: Cue[] = [];
        let t = 0; // seconds
        let idx = 1;

        const sylCount = (word: string): number => {
            const w = word.toLowerCase().replace(/[^a-z]/g, '');
            if (!w) return 1;
            // Rough vowel-cluster split. Count contiguous vowel runs >=1 char.
            const m = w.match(/[aeiouy]+/g);
            return Math.max(1, (m ? m.length : 0) || 1);
        };

        for (const sentence of sentences) {
            const words = tokenize(sentence);
            for (let i = 0; i < words.length; i += maxWords) {
                const group = words.slice(i, i + maxWords);
                const totalSyl = group.reduce((acc, w) => acc + sylCount(w), 0);
                const durMs = Math.min(maxMs, Math.max(minMs, totalSyl * ms));
                const durS = durMs / 1000;
                cues.push({
                    idx,
                    start: t,
                    end: Math.min(t + durS, 1000 * 60 * 60),
                    text: group.join(' '),
                });
                idx++;
                t += durS;
                // Inter-word gap (only between cues that are not the last in a sentence).
                if (i + maxWords < words.length) t += gapMs / 1000;
            }
            // Sentence gap = 1.6 * the longest single-word time of the sentence.
            if (sentences.indexOf(sentence) < sentences.length - 1) {
                const longest = Math.max(1, ...words.map((w) => sylCount(w))) * ms;
                t += Math.min(0.6, Math.max(0.1, (longest * 2) / 1000));
            }
        }

        // SRT format
        const fmtTime = (s: number): string => {
            // Work in integer milliseconds so the ms field can never round up to 1000.
            const totalMs = Math.max(0, Math.round((Number.isFinite(s) ? s : 0) * 1000));
            const hh = Math.floor(totalMs / 3600000);
            const mm = Math.floor((totalMs % 3600000) / 60000);
            const ss = Math.floor((totalMs % 60000) / 1000);
            const ms2 = totalMs % 1000;
            return (
                String(hh).padStart(2, '0') + ':' +
                String(mm).padStart(2, '0') + ':' +
                String(ss).padStart(2, '0') + ',' +
                String(ms2).padStart(3, '0')
            );
        };
        const srt = cues
            .map(
                (c) =>
                    String(c.idx) + '\n' +
                    fmtTime(c.start) + ' --> ' + fmtTime(c.end) + '\n' +
                    c.text + '\n',
            )
            .join('\n');

        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        await fs.mkdir(path.dirname(srtPath), { recursive: true });
        await fs.writeFile(srtPath, srt, 'utf8');

        const palette = PALETTE(preset, stylePath);
        await fs.writeFile(stylePath, JSON.stringify(palette, null, 2), 'utf8');

        return {
            outputs: [
                { path: srtPath, kind: 'subtitle' as const, meta: { cues: cues.length, totalSeconds: t, preset } },
                { path: stylePath, kind: 'json' as const, meta: { preset, fontFamily: palette.fontFamily } },
            ],
        };
    },
});

/** 8 caption-style presets: font, colour, background, size, position, weight, shadow, alignment. */
function PALETTE(preset: string, _p: string) {
    const base = {
        fontFamily: 'Inter',
        fontWeight: 700,
        textTransform: 'uppercase',
        textShadow: '0 2px 8px rgba(0,0,0,0.8)',
        alignment: 'center',
        marginV: 60,
    };
    switch (preset) {
        case 'soft-white':
            return { ...base, fontColor: '#ffffff', background: 'rgba(0,0,0,0.45)', fontSize: 42, fontWeight: 600, textTransform: 'none' };
        case 'kinetic-pop':
            return { ...base, fontColor: '#ffffff', background: 'rgba(255,0,128,0.85)', fontSize: 56, fontWeight: 800, letterSpacing: '0.02em' };
        case 'editorial':
            return { ...base, fontColor: '#fafafa', background: 'transparent', fontSize: 38, fontWeight: 500, textTransform: 'none', textShadow: '0 1px 2px rgba(0,0,0,0.9)' };
        case 'podcast':
            return { ...base, fontColor: '#ffe8b0', background: 'rgba(0,0,0,0.6)', fontSize: 44, fontWeight: 500, textTransform: 'none', alignment: 'left', marginV: 80 };
        case 'tiktok-caption':
            return { ...base, fontColor: '#ffffff', background: 'rgba(0,0,0,0.75)', fontSize: 52, fontWeight: 800, textTransform: 'none' };
        case 'news-lowerthird':
            return { ...base, fontColor: '#ffffff', background: 'rgba(20,20,30,0.9)', fontSize: 36, fontWeight: 700, textTransform: 'none', alignment: 'left', marginV: 70 };
        case 'karaoke':
            return { ...base, fontColor: '#ffffff', background: 'rgba(0,0,0,0.55)', fontSize: 56, fontWeight: 800, textTransform: 'none', highlightColor: '#ffd84a' };
        case 'bold-yellow':
        default:
            return { ...base, fontColor: '#ffd84a', background: 'rgba(0,0,0,0.55)', fontSize: 52 };
    }
}