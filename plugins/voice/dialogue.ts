import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { definePlugin, PluginFailure } from '../../core/define.ts';
import { runPlugin } from '../../core/runner.ts';
import { ffmpeg } from '../../core/media.ts';
import { S, resolveOutPath, num, invalidInput } from '../_shared/common.ts';

/**
 * voice.dialogue — several different voices in one audio track.
 *
 * The toolkit could already synthesise a voice, but not hold a conversation.
 * Doing it by hand means calling voice.tts once per line, then working out the
 * silence, ordering and levels yourself — and audio.merge mixes tracks
 * *simultaneously*, which is the wrong operation for dialogue.
 *
 * This takes the script and produces one sequenced track: each line synthesised
 * with its own speaker's voice, laid end to end with the pauses you asked for.
 *
 * A line's voice comes from either:
 *   - `voice`   — an Edge-TTS voice id, e.g. en-US-AriaNeural (no setup needed)
 *   - `profile` — a Voicebox profile name (cloned or preset; needs the backend)
 *
 * Speakers are just labels, so the same speaker across several lines resolves to
 * the same voice without repeating it on every line.
 */
export default definePlugin({
    id: 'voice.dialogue',
    name: 'Multi-speaker dialogue',
    category: 'voice',
    description: 'Synthesise a multi-speaker script into one sequenced audio track, with a different voice per speaker.',
    inputs: {
        lines: S.array('Array of {speaker, text, voice?, profile?, engine?, pauseBefore?, pauseAfter?, gain?}', { required: true }),
        speakers: S.object('Map of speaker label -> {voice} or {profile}, so you set each voice once', { default: {} }),
        defaultVoice: S.string('Edge-TTS voice used when a line names no voice or profile', { default: 'en-US-JennyNeural' }),
        gapSeconds: S.number('Silence between lines when no pause is specified', { default: 0.35, minimum: 0 }),
        sampleRate: S.int('Output sample rate', { default: 44100, minimum: 8000 }),
        out: S.string('Output file name (.wav)', { default: 'dialogue.wav' }),
    },
    outputs: ['audio'],
    async run({ input, ctx }) {
        const lines = Array.isArray(input.lines) ? (input.lines as Record<string, unknown>[]) : [];
        if (!lines.length) {
            invalidInput('Provide at least one line.', {
                field: 'lines',
                hint: 'e.g. [{"speaker":"narrator","text":"Hello."},{"speaker":"guest","text":"Hi there."}]',
            });
        }

        const speakers = (input.speakers && typeof input.speakers === 'object' ? input.speakers : {}) as Record<
            string,
            Record<string, unknown>
        >;
        const defaultVoice = String(input.defaultVoice ?? 'en-US-JennyNeural');
        const gap = num(input.gapSeconds, 0.35);
        const rate = num(input.sampleRate, 44100);

        const work = fs.mkdtempSync(path.join(os.tmpdir(), 'agenticvideo-dialogue-'));
        const segments: { file: string | null; gain: number; seconds: number }[] = [];

        try {
            for (const [i, line] of lines.entries()) {
                const text = String(line?.text ?? '').trim();
                if (!text) {
                    invalidInput(`Line ${i} has no text.`, { field: 'lines', value: line });
                }

                const label = String(line?.speaker ?? 'speaker');
                const preset = speakers[label] ?? {};
                // Line-level settings win; otherwise fall back to the speaker map.
                const profile = line?.profile ?? preset.profile;
                const voice = line?.voice ?? preset.voice ?? (profile ? undefined : defaultVoice);
                const engine = line?.engine ?? preset.engine;

                const pauseBefore = num(line?.pauseBefore, i === 0 ? 0 : gap);
                if (pauseBefore > 0) {
                    segments.push({ file: null, gain: 1, seconds: pauseBefore });
                }

                const lineOut = path.join(work, `line-${String(i).padStart(3, '0')}.wav`);
                const result = profile
                    ? await runPlugin({
                          id: 'voice.voicebox_speak',
                          input: {
                              text,
                              profile: String(profile),
                              ...(engine ? { engine: String(engine) } : {}),
                              out: lineOut,
                          },
                      })
                    : await runPlugin({
                          id: 'voice.tts',
                          input: {
                              text,
                              voice: String(voice),
                              ...(line?.rate ? { rate: String(line.rate) } : {}),
                              ...(line?.pitch ? { pitch: String(line.pitch) } : {}),
                              out: lineOut,
                          },
                      });

                if (!result.ok) {
                    const e = result.error;
                    throw new PluginFailure({
                        code: e?.code ?? 'DIALOGUE_LINE_FAILED',
                        message: `Line ${i} (${label}) failed to synthesise.`,
                        reason: e?.reason ?? e?.message ?? 'the speech plugin reported a failure',
                        input: { line: i, speaker: label, profile: profile ?? undefined, voice: voice ?? undefined },
                        retryable: e?.retryable ?? true,
                        hint:
                            profile
                                ? 'Check the Voicebox profile name with voice.voicebox_profiles --input action=list.'
                                : 'Check the Edge-TTS voice id — e.g. en-US-AriaNeural, en-GB-RyanNeural.',
                    });
                }

                const produced = (result.outputs ?? []).map((o) => o.path).filter(Boolean) as string[];
                if (!produced.length) {
                    throw new PluginFailure({
                        code: 'DIALOGUE_LINE_FAILED',
                        message: `Line ${i} (${label}) produced no audio file.`,
                        input: { line: i, speaker: label },
                        retryable: true,
                    });
                }

                segments.push({ file: produced[0], gain: num(line?.gain, 1), seconds: 0 });

                const pauseAfter = num(line?.pauseAfter, i === lines.length - 1 ? 0 : 0);
                if (pauseAfter > 0) {
                    segments.push({ file: null, gain: 1, seconds: pauseAfter });
                }
            }

            // Trim trailing silence segments — a gap after the last line is noise.
            while (segments.length && segments[segments.length - 1].file === null) segments.pop();

            const dest = resolveOutPath(ctx, String(input.out ?? 'dialogue.wav'));
            const args: string[] = ['-y'];
            const chains: string[] = [];
            const labels: string[] = [];

            for (const [i, seg] of segments.entries()) {
                if (seg.file) {
                    args.push('-i', seg.file);
                } else {
                    args.push('-f', 'lavfi', '-t', String(seg.seconds), '-i', `anullsrc=r=${rate}:cl=mono`);
                }
                chains.push(
                    `[${i}:a]aresample=${rate},aformat=sample_fmts=s16:channel_layouts=mono,volume=${seg.gain}[a${i}]`,
                );
                labels.push(`[a${i}]`);
            }

            const filter = `${chains.join(';')};${labels.join('')}concat=n=${segments.length}:v=0:a=1[out]`;

            await ffmpeg([...args, '-filter_complex', filter, '-map', '[out]', '-c:a', 'pcm_s16le', dest]);

            const speakerCount = new Set(lines.map((l) => String(l?.speaker ?? 'speaker'))).size;
            return {
                outputs: [
                    {
                        path: dest,
                        kind: 'audio',
                        meta: { lines: lines.length, speakers: speakerCount, segments: segments.length },
                    },
                ],
            };
        } finally {
            fs.rmSync(work, { recursive: true, force: true });
        }
    },
});
