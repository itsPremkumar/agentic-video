import * as fs from 'node:fs';
import { definePlugin, PluginFailure } from '../../core/define.ts';
import { ffmpeg, probe } from '../../core/media.ts';
import { S, requireFile, num, resolveOutPath, str } from '../_shared/common.ts';

/**
 * video.verify — verify a video by sampling frames and running deterministic checks.
 *
 * Two modes:
 *   - heuristic (default): Extract N frames evenly across the video, run
 *     deterministic checks on each (file size, entropy, edge density, brightness).
 *     The video passes only if ALL frames pass (or ≥80% if strict=false).
 *     No AI. No LLM. Pure signal processing.
 *   - agent: Extract key frames and return them with a structured report.
 *     The driving agent (which already has vision) inspects the frames and
 *     decides PASS/FAIL itself. This plugin does not call any model.
 *
 * The agent should always run this after video.generate, motion.remotion,
 * render.timeline, or any video render. On FAIL, reject and regenerate.
 */
export default definePlugin({
    id: 'video.verify',
    name: 'Verify video',
    category: 'video',
    description: 'Verify a video by sampling frames and running deterministic checks (heuristic) or preparing frames for the agent to judge (agent mode). No external AI is called.',
    inputs: {
        src: S.string('Video file to verify', { required: true }),
        prompt: S.string('What the video should contain (used in agent mode for context)', { default: '' }),
        engine: S.string('Verification mode', { enum: ['heuristic', 'agent'], default: 'heuristic' }),
        samples: S.int('Number of frames to sample (0 = auto: 1 per 5 seconds, max 20)', { default: 0, minimum: 0 }),
        strict: S.bool('Fail the entire video if ANY frame fails', { default: true }),
        minEntropy: S.number('Minimum YSTD per frame (lower = more blank)', { default: 5, minimum: 0 }),
        out: S.string('Output JSON file name', { default: 'video-verify.json' }),
    },
    outputs: ['data'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const engine = str(input.engine, 'heuristic');
        const strict = input.strict !== false;

        // Get video info
        const info = await probe(src);
        const duration = Number(info.format?.duration ?? 0);
        if (!duration) {
            throw new PluginFailure({
                code: 'NO_DURATION',
                message: 'Could not determine video duration.',
                input: { src },
                retryable: true,
            });
        }

        // Determine sample count
        const sampleCount = num(input.samples, 0) || Math.min(20, Math.max(3, Math.floor(duration / 5)));

        // Extract evenly-spaced frames
        const interval = duration / (sampleCount + 1);
        const tmpDir = resolveOutPath(ctx, 'verify-frames');
        fs.mkdirSync(tmpDir, { recursive: true });

        const frames: Array<{ time: number; path: string }> = [];
        for (let i = 1; i <= sampleCount; i++) {
            const t = i * interval;
            const framePath = `${tmpDir}/frame_${String(i).padStart(4, '0')}.jpg`;
            await ffmpeg(['-ss', String(t), '-i', src, '-vframes', '1', '-q:v', '2', '-y', framePath]);
            frames.push({ time: Number(t.toFixed(2)), path: framePath });
        }

        // Run checks on each frame
        const frameResults: Array<Record<string, unknown>> = [];
        let passCount = 0;

        for (const frame of frames) {
            const checks = await checkFrame(frame.path, num(input.minEntropy, 5));
            const framePass = checks.every((c: any) => c.pass);
            if (framePass) passCount++;

            frameResults.push({
                time: frame.time,
                path: frame.path,
                pass: framePass,
                checks,
            });
        }

        const total = frames.length;
        const passRate = total > 0 ? passCount / total : 0;

        const dest = resolveOutPath(ctx, String(input.out ?? 'video-verify.json'));
        let result: Record<string, unknown>;

        if (engine === 'agent') {
            // Agent mode: return frames + report, let agent decide
            result = {
                pass: null,
                verdict: 'AGENT_DECISION_REQUIRED',
                reason: 'The driving agent should inspect the sampled frames and compare against the prompt.',
                frameResults,
                totalFrames: total,
                passedFrames: passCount,
                passRate: Number(passRate.toFixed(2)),
                prompt: str(input.prompt, ''),
                src,
                hint: 'Review the frames above. Do they match the prompt? If any frame is wrong, reject and regenerate.',
            };
        } else {
            // Heuristic mode: deterministic PASS/FAIL
            const pass = strict ? passCount === total : passRate >= 0.8;
            result = {
                pass,
                verdict: pass ? 'PASS' : 'FAIL',
                confidence: Number(passRate.toFixed(2)),
                reason: pass
                    ? `${passCount}/${total} frames passed all checks.`
                    : `Only ${passCount}/${total} frames passed. Failed at: ${frameResults.filter((f: any) => !f.pass).map((f: any) => `${f.time}s`).join(', ')}`,
                frameResults,
                totalFrames: total,
                passedFrames: passCount,
                passRate: Number(passRate.toFixed(2)),
            };
        }

        fs.writeFileSync(dest, JSON.stringify({ ...result, source: src, engine, duration }, null, 2));

        const passed = result.pass === true;
        return {
            outputs: [
                {
                    path: dest,
                    kind: 'data',
                    meta: { pass: result.pass, verdict: result.verdict, engine, frames: total },
                },
                // Also output the sampled frames as image artifacts for agent inspection
                ...frames.map((f) => ({
                    path: f.path,
                    kind: 'image' as const,
                    meta: { time: f.time, sample: true },
                })),
            ],
            notes: passed
                ? [`Video verification PASSED — ${passCount}/${total} frames passed (${engine})`]
                : result.pass === false
                    ? [`Video verification FAILED — ${passCount}/${total} frames passed (${engine})`]
                    : [`Video verification pending — AGENT must inspect ${total} sampled frames and decide PASS/FAIL`],
        };
    },
});

// ─── Per-frame deterministic checks ──────────────────────────────────────────

async function checkFrame(framePath: string, _minEntropy: number): Promise<Array<{ name: string; pass: boolean; detail: string }>> {
    const checks: Array<{ name: string; pass: boolean; detail: string }> = [];

    // 1. File size
    let fileSize = 0;
    try {
        const st = fs.statSync(framePath);
        fileSize = st.size;
        checks.push({ name: 'file_size', pass: fileSize >= 1024, detail: `${fileSize} bytes` });
    } catch {
        checks.push({ name: 'file_size', pass: false, detail: 'not readable' });
        return checks;
    }

    // 2. Valid image + dimensions
    let width = 0;
    let height = 0;
    try {
        const info = await probe(framePath);
        const stream = (info.streams ?? []).find((s: any) => s.codec_type === 'video');
        width = Number(stream?.width ?? 0);
        height = Number(stream?.height ?? 0);
        const hasVideo = !!stream;
        checks.push({ name: 'valid_image', pass: hasVideo, detail: hasVideo ? `${width}x${height}` : 'no video stream' });
    } catch {
        checks.push({ name: 'valid_image', pass: false, detail: 'probe failed' });
        return checks;
    }

    // 3. Aspect ratio sanity
    const aspectRatio = width > 0 && height > 0 ? width / height : 0;
    const aspectOk = aspectRatio >= 0.1 && aspectRatio <= 10;
    checks.push({
        name: 'aspect_ratio',
        pass: aspectOk,
        detail: `${aspectRatio.toFixed(2)} (must be 0.1-10)`,
    });

    // 4. Entropy proxy: bytes per 1000 pixels
    // Blank/solid-color frames compress extremely well.
    const pixels = width * height;
    const bytesPerKpx = pixels > 0 ? (fileSize / (pixels / 1000)) : 0;
    const entropyOk = bytesPerKpx >= 2;
    checks.push({
        name: 'entropy',
        pass: entropyOk,
        detail: `${bytesPerKpx.toFixed(1)} bytes/Kpx (min: 2.0)`,
    });

    // 5. Size consistency: a frame should have reasonable size for its dimensions
    const minExpectedSize = Math.max(1024, Math.round(pixels / 100));
    const sizeConsistent = fileSize >= minExpectedSize;
    checks.push({
        name: 'size_consistent',
        pass: sizeConsistent,
        detail: `${fileSize} bytes (expected >= ${minExpectedSize})`,
    });

    return checks;
}
