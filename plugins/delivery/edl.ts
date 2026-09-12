import * as fs from 'node:fs';
import * as path from 'node:path';
import { definePlugin, PluginFailure } from '../../core/define.ts';
import { durationOf } from '../../core/media.ts';
import { S, requireFile, resolveOutPath, num } from '../_shared/common.ts';

/**
 * delivery.edl — hand the cut to a real NLE.
 *
 * The last missing handoff document. An edit that only exists as a JSON array
 * cannot be opened in Resolve or Premiere, which means it cannot be reviewed,
 * conformed or finished by anyone who does not use this toolkit. CMX3600 is the
 * interchange format every NLE still reads.
 *
 * Each clip becomes one event with source and record timecodes. Transitions are
 * NOT represented — CMX3600 can describe them, but the overlap means record
 * timecodes stop matching a simple concatenation, and getting that subtly wrong
 * is worse than being explicit about it.
 */
export default definePlugin({
    id: 'delivery.edl',
    name: 'Export EDL',
    category: 'distribute',
    description: 'Write a CMX3600 EDL from a timeline so the cut can be opened in Resolve, Premiere or Avid.',
    inputs: {
        timeline: S.string('Timeline JSON with a "clips" array'),
        clips: S.array('...or an inline clip array of {src, start?, duration?}'),
        fps: S.number('Frame rate for the timecodes', { default: 30 }),
        title: S.string('EDL title', { default: 'AGENTIC VIDEO' }),
        dropFrame: S.bool('Use drop-frame timecode (29.97/59.94 only)', { default: false }),
        out: S.string('Output file name (.edl)', { default: 'cut.edl' }),
    },
    outputs: ['data'],
    async run({ input, ctx }) {
        let clips: Record<string, unknown>[] = [];
        if (Array.isArray(input.clips)) {
            clips = input.clips as Record<string, unknown>[];
        } else if (input.timeline) {
            const p = requireFile(input.timeline, 'timeline');
            const parsed = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
            if (Array.isArray(parsed?.clips)) clips = parsed.clips as Record<string, unknown>[];
        }
        if (!clips.length) {
            throw new PluginFailure({
                code: 'INVALID_INPUT',
                message: 'Provide a timeline with clips, or clips directly.',
                input: { timeline: input.timeline, clips: input.clips },
                retryable: true,
            });
        }

        const fps = num(input.fps, 30);
        if (fps <= 0) {
            throw new PluginFailure({
                code: 'INVALID_INPUT',
                message: 'fps must be greater than 0.',
                input: { fps },
                retryable: true,
            });
        }
        const drop = input.dropFrame === true;
        const title = String(input.title ?? 'AGENTIC VIDEO').toUpperCase();

        /** Frames to HH:MM:SS:FF, with optional drop-frame compensation. */
        const tc = (framesIn: number): string => {
            let f = Math.max(0, Math.round(framesIn));
            if (drop) {
                // Drop-frame skips frames 0 and 1 of every minute except every
                // tenth. Working in whole seconds keeps this exact enough for
                // the rates where it applies.
                const fpsRounded = Math.round(fps);
                const droppedPerMin = fpsRounded >= 50 ? 4 : 2;
                const framesPerMin = fpsRounded * 60 - droppedPerMin;
                const minutes = Math.floor(f / framesPerMin);
                f += droppedPerMin * minutes;
            }
            const ff = f % Math.round(fps);
            const totalSeconds = Math.floor(f / Math.round(fps));
            const ss = totalSeconds % 60;
            const mm = Math.floor(totalSeconds / 60) % 60;
            const hh = Math.floor(totalSeconds / 3600) % 24;
            const pad = (n: number): string => String(n).padStart(2, '0');
            return `${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`;
        };

        const lines: string[] = [];
        lines.push(`TITLE: ${title}`);
        lines.push(`FCM: ${drop ? 'DROP FRAME' : 'NON-DROP FRAME'}`);
        lines.push('');

        let recordFrames = 0;
        let event = 1;
        const events: Record<string, unknown>[] = [];
        const trimmed: string[] = [];

        for (const [i, clip] of clips.entries()) {
            const rawSrc = String(clip?.src ?? '');
            if (!rawSrc) {
                throw new PluginFailure({
                    code: 'INVALID_INPUT',
                    message: `clips[${i}] has no src.`,
                    input: { index: i },
                    retryable: true,
                });
            }
            const src = requireFile(rawSrc, `clips[${i}].src`);
            // A still has no intrinsic length, so a duration is required.
            const declared = num(clip.duration, 0);
            const sourceDuration = await durationOf(src);
            let duration = declared > 0 ? declared : sourceDuration;
            if (!(duration > 0)) {
                throw new PluginFailure({
                    code: 'INVALID_INPUT',
                    message: `clips[${i}] has no duration and none could be measured.`,
                    input: { index: i, src },
                    retryable: true,
                    hint: 'Give each clip an explicit `duration`.',
                });
            }

            const srcStart = num(clip.start, 0);
            // Never let a clip claim more of its source than actually exists.
            if (sourceDuration > 0 && srcStart + duration > sourceDuration + 0.01) {
                const allowed = Math.max(0, sourceDuration - srcStart);
                trimmed.push(`clips[${i}]: trimmed from ${duration.toFixed(2)}s to ${allowed.toFixed(2)}s — it ran past the end of the source.`);
                duration = allowed;
            }
            if (duration <= 0) {
                trimmed.push(`clips[${i}]: skipped — nothing left after trimming.`);
                continue;
            }

            const recIn = recordFrames;
            const recOut = recordFrames + duration * fps;
            const srcIn = srcStart * fps;
            const srcOut = srcIn + duration * fps;

            const num3 = String(event).padStart(3, '0');
            const reel = (path.basename(src).replace(/[^A-Za-z0-9]/g, '').slice(0, 7) || 'AX').toUpperCase().padEnd(7);

            lines.push(
                `${num3}  ${reel} V     C        ` +
                    `${tc(srcIn)} ${tc(srcOut)} ${tc(recIn)} ${tc(recOut)}`,
            );
            lines.push(`* FROM CLIP NAME: ${path.basename(src)}`);
            if (clip.transition) {
                lines.push(`* TRANSITION REQUESTED: ${clip.transition} — not represented in this EDL`);
            }
            lines.push('');

            events.push({
                event: num3,
                src,
                srcIn: tc(srcIn),
                srcOut: tc(srcOut),
                recIn: tc(recIn),
                recOut: tc(recOut),
            });

            recordFrames = recOut;
            event++;
        }

        const dest = resolveOutPath(ctx, String(input.out ?? 'cut.edl'));
        fs.writeFileSync(dest, lines.join('\n'), 'utf8');

        return {
            outputs: [
                {
                    path: dest,
                    kind: 'data',
                    meta: { events: events.length, fps, dropFrame: drop, totalFrames: Math.round(recordFrames) },
                },
            ],
            warnings: trimmed,
        };
    },
});
