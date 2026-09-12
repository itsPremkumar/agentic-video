import { definePlugin } from '../../core/define.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, requireFile, ensureParentDir } from '../_shared/common.ts';

/**
 * audio.duck - automatically duck (lower) a background music bed underneath a
 * voiceover, so the voice stays intelligible without manual automation.
 *
 * Two modes:
 *   sidechain - real compressor keyed on the voice signal (smoothest)
 *   envelope  - volume envelope: full level where the voice is silent,
 *               ducked level while the voice is speaking (deterministic
 *               `volume=...:enable=between(...)` segments)
 */
export default definePlugin({
    id: 'audio.duck',
    name: 'Auto-duck music under a voiceover',
    category: 'audio',
    description: 'Sidechain-compress or volume-envelope a music bed so the voiceover stays clear.',
    inputs: {
        music: S.string('Path to the music/bed file', { required: true }),
        voice: S.string('Path to the voiceover file', { required: true }),
        mode: S.string('Ducking mode', { enum: ['sidechain', 'envelope'], default: 'sidechain' }),
        duckDb: S.number('How far to duck the music in dB (negative)', { default: -14 }),
        threshold: S.number('Sidechain threshold (0.0 - 1.0)', { default: 0.03 }),
        ratio: S.number('Sidechain ratio', { default: 20 }),
        attack: S.number('Attack in ms', { default: 100 }),
        release: S.number('Release in ms', { default: 1000 }),
        out: S.string('Output file (.m4a)', { default: 'ducked.m4a' }),
    },
    outputs: ['audio'],
    async run({ input, ctx }) {
        const music = requireFile(input.music, 'music');
        const voice = requireFile(input.voice, 'voice');
        const mode = String(input.mode ?? 'sidechain');
        const duckDb = Number(input.duckDb ?? -14);
        const threshold = Number(input.threshold ?? 0.03);
        const ratio = Number(input.ratio ?? 20);
        const attack = Number(input.attack ?? 100);
        const release = Number(input.release ?? 1000);
        const out = ctx.out(String(input.out ?? 'ducked.m4a'));
        ensureParentDir(out);

        if (mode === 'sidechain') {
            // [0]=music, [1]=voice. sidechaincompress keys on the 2nd input.
            const filter =
                '[1:a]asplit=2[sc][v];' +
                '[0:a][sc]sidechaincompress=threshold=' + String(threshold) +
                ':ratio=' + String(ratio) +
                ':attack=' + String(attack) +
                ':release=' + String(release) +
                ':makeup=1[ducked];' +
                '[ducked][v]amix=inputs=2:duration=first:dropout_transition=0[out]';
            await ffmpeg([
                '-y', '-i', music, '-i', voice,
                '-filter_complex', filter,
                '-map', '[out]', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', out,
            ]);
        } else {
            // Envelope mode: detect voice activity with silencedetect, then
            // apply a volume dip while the voice is speaking.
            const detect = await ffmpeg([
                '-i', voice, '-af', 'silencedetect=n=-40dB:d=0.25', '-f', 'null', '-',
            ]);
            const starts: number[] = [];
            const ends: number[] = [];
            for (const line of detect.stderr.split(/\r?\n/)) {
                const s = /silence_start: ([\d.]+)/.exec(line);
                if (s) starts.push(Number(s[1]));
                const e = /silence_end: ([\d.]+)/.exec(line);
                if (e) ends.push(Number(e[1]));
            }
            // Spoken spans are the inverse of the silence spans.
            const spoken: Array<[number, number]> = [];
            let cursor = 0;
            for (let i = 0; i < starts.length; i++) {
                spoken.push([cursor, starts[i]]);
                cursor = ends[i] ?? cursor;
            }
            spoken.push([cursor, 86400]); // open-ended tail

            const gain = Math.pow(10, duckDb / 20);
            const parts: string[] = [];
            for (const [a, b] of spoken) {
                if (b - a < 0.05) continue;
                // between() contains commas, which ffmpeg's filter parser would
                // treat as filter separators — quote the whole expression.
                parts.push(
                    'volume=' + gain.toFixed(4) + ":enable='between(t," + a.toFixed(3) + ',' + b.toFixed(3) + ")'",
                );
            }
            const musicFilter = parts.length > 0 ? parts.join(',') : 'anull';
            const filter = '[0:a]' + musicFilter + '[m];[m][1:a]amix=inputs=2:duration=first:dropout_transition=0[out]';
            await ffmpeg([
                '-y', '-i', music, '-i', voice,
                '-filter_complex', filter,
                '-map', '[out]', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', out,
            ]);
        }

        return {
            outputs: [{
                path: out,
                kind: 'audio' as const,
                meta: { mode, duckDb, threshold, ratio, attack, release },
            }],
        };
    },
});