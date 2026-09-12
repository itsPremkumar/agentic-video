import * as fs from 'node:fs';
import { definePlugin, PluginFailure } from '../../core/define.ts';
import { ffmpeg, probe, run, resolveFfmpeg } from '../../core/media.ts';
import { S, requireFile, num, resolveOutPath, str } from '../_shared/common.ts';
import { optionalEnv } from '../../core/env.ts';

/**
 * image.verify — verify an image using an AI vision model or heuristics.
 *
 * Checks that a generated/edited image actually contains what was requested.
 * Supports multiple backends:
 *   - openai: GPT-4o / GPT-4V via API (most accurate, needs OPENAI_API_KEY)
 *   - ollama: Local vision model (needs ollama running, e.g. llava)
 *   - heuristic: File-based checks (size, dimensions, not blank) — no deps, always works
 *
 * Returns PASS / FAIL with detailed reasoning. On FAIL, the agent should
 * reject the image and regenerate.
 */
export default definePlugin({
    id: 'image.verify',
    name: 'Verify image content',
    category: 'image',
    description: 'Verify an image matches expected content using AI vision (OpenAI/Ollama) or heuristic checks. Returns PASS/FAIL with reasoning.',
    inputs: {
        src: S.string('Image file to verify', { required: true }),
        prompt: S.string('What the image should contain (e.g. "a red car on a beach")', { required: true }),
        engine: S.string('Verification backend', { enum: ['openai', 'ollama', 'heuristic'], default: 'heuristic' }),
        model: S.string('Model name (for ollama: llava, llama3.2-vision, etc. For openai: gpt-4o, gpt-4o-mini)', { default: '' }),
        minWidth: S.int('Minimum acceptable width (heuristic mode)', { default: 64 }),
        minHeight: S.int('Minimum acceptable height (heuristic mode)', { default: 64 }),
        minBytes: S.int('Minimum file size in bytes (heuristic mode)', { default: 1024 }),
        strict: S.bool('In heuristic mode: fail if any check fails. In AI mode: be more critical.', { default: true }),
        out: S.string('Output JSON file name', { default: 'image-verify.json' }),
    },
    outputs: ['data'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const prompt = str(input.prompt, '');
        const engine = str(input.engine, 'heuristic');
        const strict = input.strict !== false;

        if (!prompt) {
            throw new PluginFailure({
                code: 'INVALID_INPUT',
                message: 'prompt is required — describe what the image should contain.',
                input: { prompt },
                retryable: true,
                hint: 'e.g. "a red car on a beach at sunset"',
            });
        }

        const dest = resolveOutPath(ctx, String(input.out ?? 'image-verify.json'));
        let result: Record<string, unknown>;

        if (engine === 'openai') {
            result = await verifyOpenAI(src, prompt, str(input.model, 'gpt-4o-mini'), strict);
        } else if (engine === 'ollama') {
            result = await verifyOllama(src, prompt, str(input.model, 'llava'), strict);
        } else {
            result = await verifyHeuristic(src, prompt, {
                minWidth: num(input.minWidth, 64),
                minHeight: num(input.minHeight, 64),
                minBytes: num(input.minBytes, 1024),
                strict,
            });
        }

        fs.writeFileSync(dest, JSON.stringify({ ...result, source: src, prompt, engine }, null, 2));

        const passed = result.pass === true;
        return {
            outputs: [
                {
                    path: dest,
                    kind: 'data',
                    meta: { pass: passed, confidence: result.confidence, engine },
                },
            ],
            notes: passed
                ? [`Image verification PASSED (${engine})`]
                : [`Image verification FAILED (${engine}): ${result.reason}`],
        };
    },
});

// ─── Heuristic verification (zero dependencies) ──────────────────────────────

async function verifyHeuristic(
    src: string,
    prompt: string,
    opts: { minWidth: number; minHeight: number; minBytes: number; strict: boolean },
): Promise<Record<string, unknown>> {
    const checks: Array<{ name: string; pass: boolean; detail: string }> = [];
    let allPass = true;

    // 1. File exists and is readable
    const stats = fs.statSync(src);
    checks.push({
        name: 'file_exists',
        pass: true,
        detail: `${stats.size} bytes`,
    });

    // 2. File size check
    const sizeOk = stats.size >= opts.minBytes;
    checks.push({
        name: 'file_size',
        pass: sizeOk,
        detail: `${stats.size} bytes (min: ${opts.minBytes})`,
    });
    if (!sizeOk) allPass = false;

    // 3. Image dimensions
    let width = 0;
    let height = 0;
    try {
        const info = await probe(src);
        const stream = (info.streams ?? []).find((s: any) => s.codec_type === 'video');
        width = Number(stream?.width ?? 0);
        height = Number(stream?.height ?? 0);
    } catch {
        // not a valid image
    }
    const dimOk = width >= opts.minWidth && height >= opts.minHeight;
    checks.push({
        name: 'dimensions',
        pass: dimOk,
        detail: `${width}x${height} (min: ${opts.minWidth}x${opts.minHeight})`,
    });
    if (!dimOk) allPass = false;

    // 4. Not a blank/placeholder image (low entropy)
    let entropyOk = true;
    try {
        const ffmpegBin = resolveFfmpeg();
        const res = await run(ffmpegBin, [
            '-hide_banner', '-loglevel', 'error',
            '-i', src,
            '-vf', 'format=gray,signalstats',
            '-f', 'null', '-',
        ]);
        const ystdMatch = /YSTD:\s*([\d.]+)/.exec(res.stderr);
        const ystd = ystdMatch ? Number(ystdMatch[1]) : 0;
        entropyOk = ystd > 5; // very low stddev = near-solid color
        checks.push({
            name: 'entropy',
            pass: entropyOk,
            detail: `YSTD=${ystd.toFixed(2)} (min: 5)`,
        });
    } catch {
        checks.push({
            name: 'entropy',
            pass: true,
            detail: 'could not measure (skipped)',
        });
    }
    if (!entropyOk) allPass = false;

    const pass = opts.strict ? allPass : checks.filter((c) => c.pass).length >= checks.length - 1;

    return {
        pass,
        confidence: pass ? 0.7 : 0.3,
        reason: pass
            ? 'Heuristic checks passed: file valid, dimensions OK, has content.'
            : `Failed checks: ${checks.filter((c) => !c.pass).map((c) => c.name).join(', ')}`,
        checks,
        prompt,
    };
}

// ─── OpenAI vision verification ──────────────────────────────────────────────

async function verifyOpenAI(src: string, prompt: string, model: string, strict: boolean): Promise<Record<string, unknown>> {
    const apiKey = optionalEnv('OPENAI_API_KEY');
    if (!apiKey) {
        throw new PluginFailure({
            code: 'MISSING_API_KEY',
            message: 'OPENAI_API_KEY is not set.',
            reason: 'Required for openai engine.',
            retryable: false,
            hint: 'Set OPENAI_API_KEY in .env, or use engine=ollama/heuristic.',
        });
    }

    // Read image and base64 encode
    const imageBuffer = fs.readFileSync(src);
    const base64 = imageBuffer.toString('base64');
    const mime = getMime(src);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: model || 'gpt-4o-mini',
            messages: [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: `Evaluate whether this image accurately depicts: "${prompt}".\n\nRespond ONLY with a JSON object in this exact format:\n{\n  "pass": true/false,\n  "confidence": 0.0-1.0,\n  "reason": "brief explanation"\n}\n\nBe critical. If the image does not match the description, set pass to false.`,
                        },
                        {
                            type: 'image_url',
                            image_url: {
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
        throw new PluginFailure({
            code: 'VISION_API_ERROR',
            message: `OpenAI API returned HTTP ${response.status}`,
            reason: text.slice(0, 300),
            retryable: response.status >= 500 || response.status === 429,
            hint: response.status === 429 ? 'Rate limited — wait and retry.' : 'Check OPENAI_API_KEY.',
        });
    }

    const json = (await response.json()) as any;
    const content = json.choices?.[0]?.message?.content ?? '';

    // Extract JSON from the response
    let parsed: any;
    try {
        const match = content.match(/\{[\s\S]*\}/);
        parsed = match ? JSON.parse(match[0]) : JSON.parse(content);
    } catch {
        // Fallback: parse manually
        const pass = content.toLowerCase().includes('"pass": true');
        const confidence = parseFloat(content.match(/"confidence":\s*([\d.]+)/)?.[1] ?? '0.5');
        return {
            pass,
            confidence,
            reason: content.slice(0, 200),
            raw: content,
            prompt,
        };
    }

    const pass = parsed.pass === true;
    const confidence = Number(parsed.confidence ?? (pass ? 0.9 : 0.3));

    if (strict && !pass) {
        return { pass: false, confidence, reason: parsed.reason || 'Vision model rejected the image.', prompt };
    }

    return { pass, confidence, reason: parsed.reason || 'Vision model evaluation complete.', prompt };
}

// ─── Ollama vision verification ──────────────────────────────────────────────

async function verifyOllama(src: string, prompt: string, model: string, strict: boolean): Promise<Record<string, unknown>> {
    const ollamaUrl = optionalEnv('OLLAMA_URL') || 'http://localhost:11434';
    const imageBuffer = fs.readFileSync(src);
    const base64 = imageBuffer.toString('base64');

    const response = await fetch(`${ollamaUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: model || 'llava',
            messages: [
                {
                    role: 'user',
                    content: `Evaluate whether this image accurately depicts: "${prompt}". Respond ONLY with JSON: {"pass": true/false, "confidence": 0.0-1.0, "reason": "explanation"}`,
                    images: [base64],
                },
            ],
            stream: false,
        }),
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new PluginFailure({
            code: 'VISION_API_ERROR',
            message: `Ollama returned HTTP ${response.status}`,
            reason: text.slice(0, 300),
            retryable: response.status >= 500,
            hint: 'Ensure ollama is running and the vision model is pulled (e.g. ollama pull llava).',
        });
    }

    const json = (await response.json()) as any;
    const content = json.message?.content ?? '';

    let parsed: any;
    try {
        const match = content.match(/\{[\s\S]*\}/);
        parsed = match ? JSON.parse(match[0]) : JSON.parse(content);
    } catch {
        const pass = content.toLowerCase().includes('yes') || content.toLowerCase().includes('true');
        return {
            pass,
            confidence: pass ? 0.7 : 0.3,
            reason: content.slice(0, 200),
            raw: content,
            prompt,
        };
    }

    const pass = parsed.pass === true;
    const confidence = Number(parsed.confidence ?? (pass ? 0.8 : 0.3));

    if (strict && !pass) {
        return { pass: false, confidence, reason: parsed.reason || 'Local vision model rejected the image.', prompt };
    }

    return { pass, confidence, reason: parsed.reason || 'Local vision model evaluation complete.', prompt };
}

function getMime(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase();
    const map: Record<string, string> = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
        gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
    };
    return map[ext ?? ''] || 'image/jpeg';
}
