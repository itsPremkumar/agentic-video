import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { definePlugin, PluginFailure } from '../../core/define.ts';
import { runPlugin } from '../../core/runner.ts';
import { ffmpeg, durationOf } from '../../core/media.ts';
import { S, requireFile, num, resolveOutPath } from '../_shared/common.ts';

/**
 * voice.dub — replace dialogue with another voice, at the original timings.
 *
 * Localisation and ADR without an NLE. Given cue timings and the text for each
 * cue, it synthesises each line and places it exactly where the original was,
 * so the dub lands on the same cuts as the picture.
 *
 * This does NOT translate. There is no model here, and inventing one would be
 * exactly the silent substitution this project refuses to do. You supply the
 * text per cue — translated, rewritten, or the same words for a same-language
 * re-voice — and this places and levels it.
 *
 * Lines that run long are reported rather than silently trimmed: a dub that
 * overruns its cue is a real editorial problem, not something to hide.
 */
export default definePlugin({
    id: 'voice.dub',
    name: 'Dub dialogue',
    category: 'voice',
    description: 'Replace dialogue with synthesised speech at the original cue timings, for localisation or ADR.',
    inputs: {
        cues: S.array('Array of {start, end, text} — text is what will be said', { required: true }),
        voice: S.string('Edge-TTS voice id for the target language', { default: 'en-US-JennyNeural' }),
        profile: S.string('...or a Voicebox profile name (overrides voice)'),
        rate: S.string('Rate adjust for every line, e.g. -10%', { default: '+0%' }),
        pitch: S.string('Pitch adjust for every line, e.g. +2Hz', { default: '+0Hz' }),
        src: S.string('Original media — used for length, and to mix under the dub'),
        mixOriginal: S.bool('Keep the original audio underneath at low level', { default: false }),
        originalVolume: S.number('Level of the original when kept', { default: 0.08, minimum: 0 }),
        tailSeconds: S.number('Silence added after the last cue', { default: 0.5, minimum: 0 }),
        out: S.string('Output file name (.wav, or .mp4 when mixing with src)', { default: 'dub.wav' }),
    },
    outputs: ['audio'],
    async run({ input, ctx }) {
        const cues = Array.isArray(input.cues) ? (input.cues as Record<string, unknown>[]) : [];
        if (!cues.length) {
            throw new PluginFailure({
                code: 'INVALID_INPUT',
                message: 'cues must be a non-empty array of {start, end, text}.',
                input: { cues: input.cues },
                retryable: true,
                hint: 'Take {start, end} from voice.stt and supply your own `text` for each cue.',
            });
        }

        const voice = String(input.voice ?? 'en-US-JennyNeural');
        const profile = input.profile ? String(input.profile) : null;
        const rate = String(input.rate ?? '+0%');
        const pitch = String(input.pitch ?? '+0Hz');
        const tail = num(input.tailSeconds, 0.5);

        // The timeline length is the last cue's end, unless real media says
        // otherwise — a dub usually has to cover the whole picture.
        const lastEnd = Math.max(...cues.map((c) => num(c?.end, 0)));
        let total = lastEnd + tail;
        if (input.src) {
            const srcDur = await durationOf(requireFile(input.src, 'src'));
            if (srcDur > 0) total = Math.max(total, srcDur);
        }
        if (!(total > 0)) {
            throw new PluginFailure({
                code: 'INVALID_INPUT',
                message: 'Could not determine a timeline length.',
                reason: 'The cues have no usable end times and no src was given.',
                input: { cues: cues.length },
                retryable: true,
                hint: 'Give each cue an `end`, or pass `src` so the length can be taken from the media.',
            });
        }

        const work = fs.mkdtempSync(path.join(os.tmpdir(), 'agenticvideo-dub-'));
        const segments: { file: string; start: number; cueEnd: number; text: string }[] = [];
        const warnings: string[] = [];

        try {
            for (const [i, cue] of cues.entries()) {
                const text = String(cue?.text ?? '').trim();
                const start = num(cue?.start, 0);
                const end = num(cue?.end, 0);
                if (!text) {
                    warnings.push(`cues[${i}]: no text, skipped.`);
                    continue;
                }
                if (end <= start) {
                    throw new PluginFailure({
                        code: 'INVALID_INPUT',
                        message: `cues[${i}]: end must be after start.`,
                        input: { index: i, start, end },
                        retryable: true,
                    });
                }

                const lineOut = path.join(work, `line-${String(i).padStart(3, '0')}.wav`);
                const result = profile
                    ? await runPlugin({ id: 'voice.voicebox_speak', input: { text, profile, out: lineOut } })
                    : await runPlugin({ id: 'voice.tts', input: { text, voice, rate, pitch, out: lineOut } });

                if (!result.ok) {
                    const e = result.error;
                    throw new PluginFailure({
                        code: e?.code ?? 'DUB_LINE_FAILED',
                        message: `cues[${i}] failed to synthesise.`,
                        reason: e?.reason ?? e?.message ?? 'the speech plugin reported a failure',
                        input: { index: i, voice, profile },
                        retryable: e?.retryable ?? true,
                        hint: profile ? 'Check the Voicebox profile name.' : 'Check the Edge-TTS voice id for this language.',
                    });
                }

                const produced = (result.outputs ?? []).map((o) => o.path).filter(Boolean) as string[];
                if (!produced.length) continue;

                const dur = await durationOf(produced[0]);
                if (dur > end - start + 0.05) {
                    warnings.push(
                        `cues[${i}]: synthesis is ${dur.toFixed(2)}s but the cue is ${(end - start).toFixed(2)}s — it will overrun. Shorten the text or raise the rate.`,
                    );
                }
                segments.push({ file: produced[0], start, cueEnd: end, text });
            }

            if (!segments.length) {
                throw new PluginFailure({
                    code: 'NO_SEGMENTS',
                    message: 'No dub lines were produced.',
                    reason: warnings.join(' ') || 'Every cue was skipped.',
                    input: { cues: cues.length },
                    retryable: true,
                });
            }

            // Place each line at its cue start, then mix. adelay is in
            // milliseconds per channel; apad pads to a common length.
            const chains: string[] = [];
            const labels: string[] = [];
            const args: string[] = ['-y'];
            segments.forEach((seg, i) => {
                args.push('-i', seg.file);
                const delayMs = Math.max(0, Math.round(seg.start * 1000));
                chains.push(`[${i}:a]aformat=sample_fmts=fltp:channel_layouts=mono,aresample=48000,adelay=${delayMs}|${delayMs},apad[a${i}]`);
                labels.push(`[a${i}]`);
            });

            let filter = chains.join(';');
            if (input.src && input.mixOriginal === true) {
                const srcIndex = segments.length;
                args.push('-i', requireFile(input.src, 'src'));
                const vol = num(input.originalVolume, 0.08);
                filter += `;[${srcIndex}:a]aformat=sample_fmts=fltp:channel_layouts=mono,aresample=48000,volume=${vol},apad[aorig]`;
                labels.push('[aorig]');
            }
            filter += `;${labels.join('')}amix=inputs=${labels.length}:duration=longest:normalize=0[dub]`;

            const dest = resolveOutPath(ctx, String(input.out ?? 'dub.wav'));
            if (input.src && input.mixOriginal === true && /\.mp4$/i.test(dest)) {
                args.push('-i', requireFile(input.src, 'src'));
            }

            args.push('-filter_complex', filter, '-map', '[dub]', '-t', String(total), '-ar', '48000');

            if (/\.mp4$/i.test(dest)) {
                args.push('-c:v', 'copy', '-c:a', 'aac');
            }
            args.push(dest);

            await ffmpeg(args);

            return {
                outputs: [
                    {
                        path: dest,
                        kind: 'audio',
                        meta: { cues: cues.length, lines: segments.length, totalSeconds: Number(total.toFixed(2)), voice: profile ?? voice },
                    },
                ],
                warnings,
            };
        } finally {
            fs.rmSync(work, { recursive: true, force: true });
        }
    },
});
