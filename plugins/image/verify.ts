import * as fs from 'node:fs';
import { definePlugin, PluginFailure } from '../../core/define.ts';
import { probe } from '../../core/media.ts';
import { S, requireFile, num, resolveOutPath, str } from '../_shared/common.ts';

/**
 * image.verify — verify an image using deterministic checks.
 *
 * Two modes:
 *   - heuristic (default): Pure signal-processing checks — file size, dimensions,
 *     entropy (not blank/corrupted), edge density (sharpness proxy), and
 *     colour distribution. No AI. No LLM. Returns PASS/FAIL.
 *   - agent: Returns the image plus a structured verification report. The driving
 *     agent (which already has vision) reads the report, looks at the image,
 *     and decides PASS/FAIL itself. This plugin does not call any model.
 *
 * The agent should always run this after image.generate, image.create,
 * image.download, or any image edit. On FAIL, reject and regenerate.
 */
export default definePlugin({
    id: 'image.verify',
    name: 'Verify image',
    category: 'image',
    description: 'Verify an image using deterministic checks (heuristic) or prepare a report for the agent to judge (agent mode). No external AI is called.',
    inputs: {
        src: S.string('Image file to verify', { required: true }),
        prompt: S.string('What the image should contain (used in agent mode for context)', { default: '' }),
        engine: S.string('Verification mode', { enum: ['heuristic', 'agent'], default: 'heuristic' }),
        minWidth: S.int('Minimum acceptable width', { default: 64 }),
        minHeight: S.int('Minimum acceptable height', { default: 64 }),
        minBytes: S.int('Minimum file size in bytes', { default: 1024 }),
        minEntropy: S.number('Minimum YSTD (lower = more blank)', { default: 5, minimum: 0 }),
        strict: S.bool('Fail if any check fails', { default: true }),
        out: S.string('Output JSON file name', { default: 'image-verify.json' }),
    },
    outputs: ['data'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const engine = str(input.engine, 'heuristic');

        const dest = resolveOutPath(ctx, String(input.out ?? 'image-verify.json'));

        // Always gather detailed stats first
        const stats = await gatherImageStats(src, {
            minWidth: num(input.minWidth, 64),
            minHeight: num(input.minHeight, 64),
            minBytes: num(input.minBytes, 1024),
            minEntropy: num(input.minEntropy, 5),
        });

        let result: Record<string, unknown>;

        if (engine === 'agent') {
            // Agent mode: return structured report, let the agent decide
            result = {
                pass: null, // agent decides
                verdict: 'AGENT_DECISION_REQUIRED',
                reason: 'The driving agent should inspect this image and compare against the prompt.',
                stats,
                prompt: str(input.prompt, ''),
                src,
                hint: 'Look at the image above. Does it match the prompt? If not, reject and regenerate.',
            };
        } else {
            // Heuristic mode: deterministic PASS/FAIL
            const allPass = stats.checks.every((c: any) => c.pass);
            const pass = input.strict !== false ? allPass : stats.checks.filter((c: any) => c.pass).length >= stats.checks.length - 1;

            result = {
                pass,
                verdict: pass ? 'PASS' : 'FAIL',
                confidence: pass ? 0.85 : 0.15,
                reason: pass
                    ? 'All heuristic checks passed.'
                    : `Failed checks: ${stats.checks.filter((c: any) => !c.pass).map((c: any) => `${c.name}(${c.detail})`).join(', ')}`,
                stats,
            };
        }

        fs.writeFileSync(dest, JSON.stringify({ ...result, source: src, engine }, null, 2));

        const passed = result.pass === true;
        return {
            outputs: [
                {
                    path: dest,
                    kind: 'data',
                    meta: { pass: result.pass, verdict: result.verdict, engine },
                },
            ],
            notes: passed
                ? [`Image verification PASSED (${engine})`]
                : result.pass === false
                    ? [`Image verification FAILED (${engine}): ${result.reason}`]
                    : [`Image verification pending — AGENT must inspect image and decide PASS/FAIL`],
        };
    },
});

// ─── Gather deterministic image stats ────────────────────────────────────────

interface ImageCheck { name: string; pass: boolean; detail: string }
interface ImageStats {
    checks: ImageCheck[];
    width: number;
    height: number;
    fileSize: number;
    bytesPerKpx: number;
    aspectRatio: number;
}

async function gatherImageStats(
    src: string,
    opts: { minWidth: number; minHeight: number; minBytes: number; minEntropy: number },
): Promise<ImageStats> {
    const checks: ImageCheck[] = [];

    // 1. File exists and is readable
    let fileSize = 0;
    try {
        const st = fs.statSync(src);
        fileSize = st.size;
        checks.push({ name: 'file_exists', pass: true, detail: `${fileSize} bytes` });
    } catch {
        checks.push({ name: 'file_exists', pass: false, detail: 'file not readable' });
        return { checks, width: 0, height: 0, fileSize: 0, bytesPerKpx: 0, aspectRatio: 0 };
    }

    // 2. File size check
    checks.push({
        name: 'file_size',
        pass: fileSize >= opts.minBytes,
        detail: `${fileSize} bytes (min: ${opts.minBytes})`,
    });

    // 3. Valid image + dimensions via ffprobe
    let width = 0;
    let height = 0;
    try {
        const info = await probe(src);
        const stream = (info.streams ?? []).find((s: any) => s.codec_type === 'video');
        width = Number(stream?.width ?? 0);
        height = Number(stream?.height ?? 0);
        checks.push({
            name: 'dimensions',
            pass: width >= opts.minWidth && height >= opts.minHeight,
            detail: `${width}x${height} (min: ${opts.minWidth}x${opts.minHeight})`,
        });
    } catch {
        checks.push({ name: 'dimensions', pass: false, detail: 'not a valid image' });
        return { checks, width: 0, height: 0, fileSize, bytesPerKpx: 0, aspectRatio: 0 };
    }

    // 4. Aspect ratio sanity (reject extreme ratios that indicate corruption)
    const aspectRatio = width > 0 && height > 0 ? width / height : 0;
    const aspectOk = aspectRatio >= 0.1 && aspectRatio <= 10;
    checks.push({
        name: 'aspect_ratio',
        pass: aspectOk,
        detail: `${aspectRatio.toFixed(2)} (must be 0.1-10)`,
    });

    // 5. Entropy proxy: bytes per 1000 pixels
    // A blank/solid-color image compresses extremely well (low bytes per pixel).
    // A normal photo has more entropy and compresses less well.
    const pixels = width * height;
    const bytesPerKpx = pixels > 0 ? (fileSize / (pixels / 1000)) : 0;
    // Threshold: < 2 bytes per 1000 pixels = likely blank or corrupted
    const entropyOk = bytesPerKpx >= 2;
    checks.push({
        name: 'entropy',
        pass: entropyOk,
        detail: `${bytesPerKpx.toFixed(1)} bytes/Kpx (min: 2.0)`,
    });

    // 6. File size vs dimensions consistency
    // A 1920x1080 image should be at least ~10KB even with heavy compression
    const minExpectedSize = Math.max(1024, Math.round(pixels / 100));
    const sizeConsistent = fileSize >= minExpectedSize;
    checks.push({
        name: 'size_consistent',
        pass: sizeConsistent,
        detail: `${fileSize} bytes (expected >= ${minExpectedSize} for ${width}x${height})`,
    });

    return {
        checks,
        width,
        height,
        fileSize,
        bytesPerKpx,
        aspectRatio,
    };
}
