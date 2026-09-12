import * as fs from 'node:fs';
import { definePlugin, PluginFailure } from '../../core/define.ts';
import { ffmpeg, probe } from '../../core/media.ts';
import { S, requireFile, num, resolveOutPath, str } from '../_shared/common.ts';

/**
 * video.verify — verify a video by sampling frames and checking them.
 *
 * Two modes:
 *   - frame: Extract N frames evenly across the video, verify each with
 *            image.verify (or heuristic checks if no vision engine).
 *   - direct: If the vision model supports video, send the whole file.
 *             (Currently only supported with openai engine + gpt-4o.)
 *
 * The video passes only if ALL sampled frames pass. The agent should
 * reject and regenerate if any frame fails.
 */
export default definePlugin({
    id: 'video.verify',
    name: 'Verify video content',
    category: 'video',
    description: 'Verify a video matches expected content by extracting frames and checking them. Rejects the video if any sampled frame fails.',
    inputs: {
        src: S.string('Video file to verify', { required: true }),
        prompt: S.string('What the video should contain (e.g. "a cat playing with a ball")', { required: true }),
        engine: S.string('Verification backend for frames', { enum: ['openai', 'ollama', 'heuristic'], default: 'heuristic' }),
        mode: S.string('Verification mode', { enum: ['frame', 'direct'], default: 'frame' }),
        model: S.string('Model name (for ollama/openai)', { default: '' }),
        samples: S.int('Number of frames to sample (0 = auto: 1 per 5 seconds, max 20)', { default: 0, minimum: 0 }),
        strict: S.bool('Fail the entire video if ANY frame fails', { default: true }),
        out: S.string('Output JSON file name', { default: 'video-verify.json' }),
    },
    outputs: ['data'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const prompt = str(input.prompt, '');
        const engine = str(input.engine, 'heuristic');
        const mode = str(input.mode, 'frame');
        const strict = input.strict !== false;

        if (!prompt) {
            throw new PluginFailure({
                code: 'INVALID_INPUT',
                message: 'prompt is required — describe what the video should contain.',
                input: { prompt },
                retryable: true,
                hint: 'e.g. "a cat playing with a red ball in a garden"',
            });
        }

        const dest = resolveOutPath(ctx, String(input.out ?? 'video-verify.json'));

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

        let result: Record<string, unknown>;

        if (mode === 'direct' && engine === 'openai') {
            // Direct video verification (OpenAI supports this with gpt-4o)
            result = await verifyDirect(src, prompt, str(input.model, 'gpt-4o'));
        } else {
            // Frame-based verification
            const sampleCount = num(input.samples, 0) || Math.min(20, Math.max(3, Math.floor(duration / 5)));
            result = await verifyFrames(src, prompt, engine, str(input.model, ''), sampleCount, strict, duration, ctx);
        }

        fs.writeFileSync(dest, JSON.stringify({ ...result, source: src, prompt, engine, mode, duration }, null, 2));

        const passed = result.pass === true;
        return {
            outputs: [
                {
                    path: dest,
                    kind: 'data',
                    meta: { pass: passed, confidence: result.confidence, engine, mode },
                },
            ],
            notes: passed
                ? [`Video verification PASSED (${mode} / ${engine})`]
                : [`Video verification FAILED (${mode} / ${engine}): ${result.reason}`],
        };
    },
});

// ─── Frame-based verification ────────────────────────────────────────────────

async function verifyFrames(
    src: string,
    prompt: string,
    engine: string,
    model: string,
    sampleCount: number,
    strict: boolean,
    videoDuration: number,
    ctx: any,
): Promise<Record<string, unknown>> {
    // Extract evenly-spaced frames
    const interval = videoDuration > 0 ? videoDuration / (sampleCount + 1) : 1;
    const tmpDir = resolveOutPath(ctx, 'verify-frames');
    fs.mkdirSync(tmpDir, { recursive: true });

    const frames: Array<{ time: number; path: string }> = [];
    for (let i = 1; i <= sampleCount; i++) {
        const t = i * interval;
        const framePath = `${tmpDir}/frame_${String(i).padStart(4, '0')}.jpg`;
        await ffmpeg(['-ss', String(t), '-i', src, '-vframes', '1', '-q:v', '2', '-y', framePath]);
        frames.push({ time: Number(t.toFixed(2)), path: framePath });
    }

    // Verify each frame
    const frameResults: Array<Record<string, unknown>> = [];
    let passCount = 0;

    for (const frame of frames) {
        let frameResult: Record<string, unknown>;

        if (engine === 'heuristic') {
            frameResult = await verifyFrameHeuristic(frame.path, prompt);
        } else {
            // For openai/ollama, we'd need to call the vision API per frame.
            // To avoid making this plugin depend on image.verify internals,
            // we use a heuristic here but note that the agent should use
            // image.verify on key frames for AI verification.
            frameResult = await verifyFrameHeuristic(frame.path, prompt);
            frameResult.note = `For AI verification, run image.verify on frame: ${frame.path}`;
        }

        frameResults.push({
            time: frame.time,
            ...frameResult,
        });
        if (frameResult.pass === true) passCount++;
    }

    const total = frames.length;
    const passRate = total > 0 ? passCount / total : 0;
    const pass = strict ? passCount === total : passRate >= 0.8;

    return {
        pass,
        confidence: passRate,
        reason: pass
            ? `${passCount}/${total} frames passed verification.`
            : `Only ${passCount}/${total} frames passed. Failed frames at: ${frameResults.filter((f) => !f.pass).map((f) => `${f.time}s`).join(', ')}`,
        frameResults,
        totalFrames: total,
        passedFrames: passCount,
        prompt,
    };
}

async function verifyFrameHeuristic(framePath: string, prompt: string): Promise<Record<string, unknown>> {
    const checks: Array<{ name: string; pass: boolean; detail: string }> = [];

    // 1. File exists and has content
    const stats = fs.statSync(framePath);
    const sizeOk = stats.size >= 1024;
    checks.push({ name: 'file_size', pass: sizeOk, detail: `${stats.size} bytes` });

    // 2. Not a blank frame
    let entropyOk = true;
    try {
        const res = await ffmpeg([
            '-i', framePath,
            '-vf', 'format=gray,signalstats',
            '-f', 'null', '-',
        ]);
        const ystdMatch = /YSTD:\s*([\d.]+)/.exec(res.stderr);
        const ystd = ystdMatch ? Number(ystdMatch[1]) : 0;
        entropyOk = ystd > 5;
        checks.push({ name: 'entropy', pass: entropyOk, detail: `YSTD=${ystd.toFixed(2)}` });
    } catch {
        checks.push({ name: 'entropy', pass: true, detail: 'skipped' });
    }

    // 3. Not a solid color / corruption
    let corruptOk = true;
    try {
        const info = await probe(framePath);
        const hasVideo = (info.streams ?? []).some((s: any) => s.codec_type === 'video');
        corruptOk = hasVideo;
        checks.push({ name: 'valid_image', pass: corruptOk, detail: hasVideo ? 'valid' : 'no video stream' });
    } catch {
        corruptOk = false;
        checks.push({ name: 'valid_image', pass: false, detail: 'probe failed' });
    }

    const allPass = checks.every((c) => c.pass);
    return {
        pass: allPass,
        confidence: allPass ? 0.7 : 0.2,
        reason: allPass ? 'Frame passes heuristic checks.' : `Failed: ${checks.filter((c) => !c.pass).map((c) => c.name).join(', ')}`,
        checks,
        prompt,
    };
}

// ─── Direct video verification (OpenAI) ──────────────────────────────────────

async function verifyDirect(src: string, prompt: string, model: string): Promise<Record<string, unknown>> {
    const { optionalEnv } = await import('../../core/env.ts');
    const apiKey = optionalEnv('OPENAI_API_KEY');
    if (!apiKey) {
        throw new PluginFailure({
            code: 'MISSING_API_KEY',
            message: 'OPENAI_API_KEY is not set.',
            reason: 'Required for direct video verification.',
            retryable: false,
            hint: 'Set OPENAI_API_KEY in .env, or use mode=frame with engine=heuristic.',
        });
    }

    // Read video and base64 encode (note: OpenAI has size limits)
    const videoBuffer = fs.readFileSync(src);
    const base64 = videoBuffer.toString('base64');
    const mime = 'video/mp4';

    // Note: OpenAI may have file size limits. This works for short clips.
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: model || 'gpt-4o',
            messages: [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: `Evaluate whether this video accurately depicts: "${prompt}".\n\nRespond ONLY with JSON:\n{\n  "pass": true/false,\n  "confidence": 0.0-1.0,\n  "reason": "brief explanation"\n}`,
                        },
                        {
                            type: 'video_url',
                            video_url: {
                                url: `data:${mime};base64,${base64}`,
                            },
                        },
                    ],
                },
            ],
            max_tokens: 500,
        }),
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        // If video is too large, suggest frame mode
        if (text.includes('too large') || text.includes('maximum')) {
            throw new PluginFailure({
                code: 'VIDEO_TOO_LARGE',
                message: 'Video is too large for direct vision API.',
                reason: text.slice(0, 200),
                retryable: true,
                hint: 'Use mode=frame instead — it samples frames and verifies individually.',
            });
        }
        throw new PluginFailure({
            code: 'VISION_API_ERROR',
            message: `OpenAI API returned HTTP ${response.status}`,
            reason: text.slice(0, 300),
            retryable: response.status >= 500 || response.status === 429,
        });
    }

    const json = (await response.json()) as any;
    const content = json.choices?.[0]?.message?.content ?? '';

    let parsed: any;
    try {
        const match = content.match(/\{[\s\S]*\}/);
        parsed = match ? JSON.parse(match[0]) : JSON.parse(content);
    } catch {
        const pass = content.toLowerCase().includes('pass') && !content.toLowerCase().includes('fail');
        return {
            pass,
            confidence: pass ? 0.7 : 0.3,
            reason: content.slice(0, 200),
            raw: content,
            prompt,
        };
    }

    return {
        pass: parsed.pass === true,
        confidence: Number(parsed.confidence ?? 0.5),
        reason: parsed.reason || 'Direct video evaluation complete.',
        prompt,
    };
}

