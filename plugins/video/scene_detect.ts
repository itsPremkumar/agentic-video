import * as fs from 'node:fs';
import { definePlugin } from '../../core/define.ts';
import { probe, resolveFfmpeg, run } from '../../core/media.ts';
import { S, requireFile, ensureParentDir } from '../_shared/common.ts';

/**
 * video.scene_detect - find natural cut points in a video using ffmpeg's
 * scene-change detection.
 *
 * `sensitivity` 0..1 maps to the ffmpeg `select='gt(scene,TH)'` threshold:
 *   TH = 1 - sensitivity   (0.3 sensitivity -> TH 0.70)
 * Higher sensitivity = more cuts.
 *
 * Returns a JSON list of {index, time, score} plus the implied segment
 * boundaries. Optionally re-cut the video into conformed segments (min/max
 * length clamped) and concat them back together.
 */
export default definePlugin({
    id: 'video.scene_detect',
    name: 'Detect scene changes / natural cut points',
    category: 'analyze',
    description: 'Deterministic scene-change detection via ffmpeg select=gt(scene,TH). Returns cut times + optional smart re-assembly.',
    inputs: {
        file: S.string('Path to input video', { required: true }),
        sensitivity: S.number('Detection sensitivity 0..1 (higher = more cuts)', { default: 0.3, minimum: 0, maximum: 1 }),
        smartAssemble: S.bool('Re-cut into clamped segments and concat', { default: false }),
        minSegment: S.number('Minimum segment length in seconds (smartAssemble)', { default: 1.0 }),
        maxSegment: S.number('Maximum segment length in seconds (smartAssemble)', { default: 5.0 }),
        targetDuration: S.number('Optional target total duration in seconds (smartAssemble)'),
        out: S.string('Output JSON path', { default: 'scenes.json' }),
        videoOut: S.string('Re-assembled video path (smartAssemble only)', { default: 'smartcut.mp4' }),
    },
    outputs: ['json'],
    async run({ input, ctx }) {
        const file = requireFile(input.file, 'file');
        const sensitivity = Math.max(0, Math.min(1, Number(input.sensitivity ?? 0.3)));
        const threshold = Number((1 - sensitivity).toFixed(4));
        const info = await probe(file);
        const duration = Number(info.format?.duration ?? 0);

        // `metadata=print` emits the frame's pts_time AND its scene_score at
        // `info` level, interleaved:
        //     frame:0    pts:76800   pts_time:6
        //     lavfi.scene_score=1.000000
        // Use the raw runner so -loglevel info isn't suppressed.
        const res = await run(resolveFfmpeg(), [
            '-hide_banner', '-v', 'info',
            '-i', file,
            '-vf', "select='gt(scene," + String(threshold) + ")',metadata=print:file=-",
            '-f', 'null', '-',
        ], { timeoutMs: 600_000 });

        const scenes: Array<{ index: number; time: number; score: number }> = [];
        let lastTime = 0;
        // metadata=print:file=- writes to STDOUT, not stderr — scan both.
        for (const line of (res.stdout + '\n' + res.stderr).split(/\r?\n/)) {
            const t = /pts_time:([\d.]+)/.exec(line);
            if (t) {
                lastTime = Number(t[1]);
                continue;
            }
            const s = /lavfi\.scene_score=([\d.eE+-]+)/.exec(line);
            if (s) {
                scenes.push({ index: scenes.length, time: lastTime, score: Number(s[1]) });
            }
        }

        // Implied segment boundaries: 0, each cut, and the end.
        const boundaries = [0, ...scenes.map((s) => s.time)];
        if (duration > 0) boundaries.push(duration);
        const segments = boundaries.slice(0, -1).map((b, i) => ({
            index: i,
            start: Number(b.toFixed(3)),
            end: Number((boundaries[i + 1] ?? duration).toFixed(3)),
            duration: Number(((boundaries[i + 1] ?? duration) - b).toFixed(3)),
        }));

        const report = {
            file,
            duration,
            sensitivity,
            threshold,
            sceneCount: scenes.length,
            scenes,
            segmentCount: segments.length,
            segments,
        };

        const out = ctx.out(String(input.out ?? 'scenes.json'));
        ensureParentDir(out);
        fs.writeFileSync(out, JSON.stringify(report, null, 2));

        const outputs: Array<{ path: string; kind: 'json' | 'video'; meta?: Record<string, unknown> }> = [
            { path: out, kind: 'json' as const, meta: { sceneCount: scenes.length, segmentCount: segments.length, duration } },
        ];

        if (input.smartAssemble === true && segments.length > 0) {
            const minSeg = Math.max(0.1, Number(input.minSegment ?? 1.0));
            const maxSeg = Math.max(minSeg, Number(input.maxSegment ?? 5.0));
            const target = Number(input.targetDuration ?? 0);

            // Conform each scene: clamp length, then trim to fit the target.
            const conformed = segments
                .map((s) => {
                    let dur = Math.min(maxSeg, Math.max(minSeg, s.duration));
                    return { start: s.start, duration: dur };
                })
                .filter((s) => s.start + s.duration <= duration + 0.05);

            let chosen = conformed;
            if (target > 0) {
                chosen = [];
                let acc = 0;
                for (const c of conformed) {
                    if (acc + c.duration > target) {
                        const remaining = target - acc;
                        if (remaining > 0.2) chosen.push({ start: c.start, duration: remaining });
                        break;
                    }
                    chosen.push(c);
                    acc += c.duration;
                }
            }

            if (chosen.length === 0) {
                throw new (await import('../../core/define.ts')).PluginFailure({
                    code: 'NO_SEGMENTS',
                    message: 'smartAssemble produced no usable segments.',
                    input: { segments: segments.length, minSegment: minSeg, maxSegment: maxSeg, targetDuration: target },
                    retryable: true,
                    hint: 'Loosen min/max segment length, or raise targetDuration.',
                });
            }

            const videoOut = ctx.out(String(input.videoOut ?? 'smartcut.mp4'));
            ensureParentDir(videoOut);

            // Build one trim per segment, then concat.
            const parts: string[] = [];
            const args: string[] = ['-y'];
            for (let i = 0; i < chosen.length; i++) {
                args.push('-ss', String(chosen[i].start), '-t', String(chosen[i].duration), '-i', file);
                parts.push('[' + String(i) + ':v]setpts=PTS-STARTPTS,scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=30[v' + String(i) + ']');
            }
            const vTags = chosen.map((_, i) => '[v' + String(i) + ']').join('');
            const filter = parts.join(';') + ';' + vTags + 'concat=n=' + String(chosen.length) + ':v=1:a=0[outv]';
            args.push('-filter_complex', filter, '-map', '[outv]', '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-an', videoOut);

            await ffmpegSafe(args);
            outputs.push({ path: videoOut, kind: 'video' as const, meta: { segments: chosen.length, targetDuration: target } });
        }

        return { outputs, warnings: scenes.length === 0 ? ['no scene changes detected — try raising sensitivity'] : [] };
    },
});

async function ffmpegSafe(args: string[]): Promise<void> {
    const { ffmpeg } = await import('../../core/media.ts');
    await ffmpeg(args);
}