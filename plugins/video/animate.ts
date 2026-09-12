/**
 * video.animate — AI image-to-video through a local ComfyUI + AnimateDiff server.
 *
 * This is the AI tier of image->video. The zero-cost ffmpeg tier is
 * `video.from_images` (Ken Burns / slideshow) — that one needs nothing.
 * This one needs a running ComfyUI with the AnimateDiff extension.
 *
 * Per the VideoForge contract this plugin never silently degrades: if ComfyUI
 * is unreachable, or AnimateDiff is not installed, it FAILS with a specific
 * code. Choosing a different approach is the caller's decision.
 *
 * Reference: ported from Automated-Video-Generator/src/lib/ai/providers/animatediff.ts
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { definePlugin, PluginFailure } from '../../core/define.ts';
import { S, requireFile, resolveOutPath } from '../_shared/common.ts';

const DEFAULT_COMFY = 'http://127.0.0.1:8188';

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

export default definePlugin({
    id: 'video.animate',
    name: 'AI image-to-video (ComfyUI AnimateDiff)',
    category: 'video',
    description:
        'Animate a still image into a short motion clip using a local ComfyUI server with AnimateDiff. Needs ComfyUI running — for the no-dependency path use video.from_images.',
    inputs: {
        image: S.string('Source image path', { required: true }),
        motionPrompt: S.string('What motion to add', {
            default: 'smooth camera movement, subtle motion, cinematic',
        }),
        negativePrompt: S.string('What to avoid', { default: 'static, frozen, still image, jitter, warping' }),
        durationSec: S.number('Approximate clip length in seconds', { default: 3, minimum: 1, maximum: 8 }),
        fps: S.int('Output frame rate', { default: 16, minimum: 8, maximum: 30 }),
        seed: S.int('Random seed', { default: 42, minimum: 0 }),
        steps: S.int('Sampler steps', { default: 20, minimum: 4, maximum: 60 }),
        cfg: S.number('Classifier-free guidance scale', { default: 7, minimum: 1, maximum: 20 }),
        denoise: S.number('Denoise strength (lower = closer to the source image)', {
            default: 0.8,
            minimum: 0.1,
            maximum: 1,
        }),
        motionScale: S.number('AnimateDiff motion scale', { default: 1.2, minimum: 0.1, maximum: 3 }),
        comfyUrl: S.string('ComfyUI base URL', { default: DEFAULT_COMFY }),
        timeoutMs: S.int('Give up after this many ms', { default: 600000, minimum: 10000 }),
        pollMs: S.int('History poll interval in ms', { default: 2000, minimum: 500 }),
        out: S.string('Output video file (.mp4)', { default: 'animated.mp4' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const image = requireFile(input.image, 'image');
        const base = String(input.comfyUrl ?? process.env.COMFYUI_URL ?? DEFAULT_COMFY).replace(/\/+$/, '');
        const timeoutMs = Number(input.timeoutMs ?? 600000);
        const pollMs = Number(input.pollMs ?? 2000);
        const dest = resolveOutPath(ctx, String(input.out ?? 'animated.mp4'));
        fs.mkdirSync(path.dirname(dest), { recursive: true });

        // ── 1. Is ComfyUI up, and does it have AnimateDiff? ───────────────
        let present = false;
        try {
            const res = await fetchWithTimeout(base + '/object_info', {}, 15000);
            if (res.ok) {
                const info = (await res.json()) as Record<string, unknown>;
                present = Object.keys(info).some(
                    (k) => k.includes('AnimateDiff') || k.includes('ADE_'),
                );
            }
        } catch (e) {
            throw new PluginFailure({
                code: 'COMFYUI_UNREACHABLE',
                message: 'Could not reach ComfyUI at ' + base + '.',
                reason: (e as Error).message,
                input: { comfyUrl: base },
                retryable: true,
                hint: 'Start ComfyUI (default http://127.0.0.1:8188) or pass comfyUrl. For a dependency-free alternative use video.from_images.',
            });
        }
        if (!present) {
            throw new PluginFailure({
                code: 'ANIMATEDIFF_NOT_AVAILABLE',
                message: 'ComfyUI is running but no AnimateDiff nodes were found.',
                reason: 'GET /object_info contained no keys matching "AnimateDiff" or "ADE_".',
                input: { comfyUrl: base },
                retryable: false,
                hint: 'Install the AnimateDiff-Evolved extension in ComfyUI, then restart it.',
            });
        }

        // ── 2. Upload the source image ────────────────────────────────────
        const buf = fs.readFileSync(image);
        const form = new FormData();
        form.append('image', new Blob([buf]), path.basename(image));
        let uploadedName = '';
        try {
            const up = await fetchWithTimeout(base + '/upload/image', { method: 'POST', body: form }, 60000);
            if (!up.ok) {
                throw new Error('HTTP ' + up.status + ' ' + (await up.text()).slice(0, 200));
            }
            const j = (await up.json()) as { name?: string };
            uploadedName = String(j.name ?? '');
        } catch (e) {
            throw new PluginFailure({
                code: 'COMFYUI_UPLOAD_FAILED',
                message: 'Could not upload the source image to ComfyUI.',
                reason: (e as Error).message,
                input: { image },
                retryable: true,
            });
        }
        if (!uploadedName) {
            throw new PluginFailure({
                code: 'COMFYUI_UPLOAD_FAILED',
                message: 'ComfyUI accepted the upload but returned no file name.',
                retryable: true,
            });
        }

        // ── 3. Submit the AnimateDiff workflow ────────────────────────────
        const frames = Math.min(48, Math.max(12, Math.round(Number(input.durationSec ?? 3) * Number(input.fps ?? 16))));
        const workflow = {
            '1': { class_type: 'LoadImage', inputs: { image: uploadedName, type: 'input' } },
            '2': {
                class_type: 'ADE_AnimateDiffLoaderWithContext',
                inputs: { model_name: 'mm_sd_v15.ckpt', beta_schedule: 'sqrt_linear', motion_scale: Number(input.motionScale ?? 1.2) },
            },
            '3': {
                class_type: 'ADE_AnimateDiffUniformContextOptions',
                inputs: { context_length: 16, context_stride: 1, context_overlap: 4 },
            },
            '4': {
                class_type: 'ADE_AnimateDiffApply',
                inputs: { motion_model: ['2', 0], context_options: ['3', 0] },
            },
            '5': {
                class_type: 'CLIPTextEncode',
                inputs: { text: String(input.motionPrompt ?? 'smooth camera movement'), clip: ['4', 1] },
            },
            '6': {
                class_type: 'CLIPTextEncode',
                inputs: { text: String(input.negativePrompt ?? 'static, frozen'), clip: ['4', 1] },
            },
            '7': {
                class_type: 'KSampler',
                inputs: {
                    seed: Number(input.seed ?? 42),
                    steps: Number(input.steps ?? 20),
                    cfg: Number(input.cfg ?? 7),
                    sampler_name: 'euler',
                    scheduler: 'normal',
                    denoise: Number(input.denoise ?? 0.8),
                    model: ['4', 0],
                    positive: ['5', 0],
                    negative: ['6', 0],
                    latent_image: ['1', 0],
                },
            },
            '8': {
                class_type: 'VHS_VideoCombine',
                inputs: {
                    images: ['7', 0],
                    frame_rate: Number(input.fps ?? 16),
                    loop_count: 0,
                    filename_prefix: 'videoforge',
                    format: 'video/h264-mp4',
                },
            },
        };

        let promptId = '';
        try {
            const pr = await fetchWithTimeout(
                base + '/prompt',
                { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: workflow }) },
                60000,
            );
            if (!pr.ok) {
                const body = (await pr.text()).slice(0, 600);
                throw new PluginFailure({
                    code: 'COMFYUI_PROMPT_REJECTED',
                    message: 'ComfyUI rejected the workflow (HTTP ' + pr.status + ').',
                    reason: body,
                    input: { comfyUrl: base, frames },
                    retryable: true,
                    hint: 'Usually a missing model (mm_sd_v15.ckpt) or a renamed node after a ComfyUI update.',
                });
            }
            const j = (await pr.json()) as { prompt_id?: string };
            promptId = String(j.prompt_id ?? '');
        } catch (e) {
            if (e instanceof PluginFailure) throw e;
            throw new PluginFailure({
                code: 'COMFYUI_PROMPT_FAILED',
                message: 'Could not submit the workflow to ComfyUI.',
                reason: (e as Error).message,
                retryable: true,
            });
        }
        if (!promptId) {
            throw new PluginFailure({
                code: 'COMFYUI_NO_PROMPT_ID',
                message: 'ComfyUI accepted the workflow but returned no prompt id.',
                retryable: true,
            });
        }

        // ── 4. Poll for the rendered video ────────────────────────────────
        const deadline = Date.now() + timeoutMs;
        let lastErr = '';
        while (Date.now() < deadline) {
            try {
                const hr = await fetchWithTimeout(base + '/history/' + encodeURIComponent(promptId), {}, 15000);
                if (hr.ok) {
                    const hist = (await hr.json()) as Record<string, any>;
                    const node = hist?.[promptId]?.outputs?.['8'];
                    const vids = node?.gifs ?? node?.videos;
                    if (Array.isArray(vids) && vids.length > 0) {
                        const f = String(vids[0].filename ?? '');
                        const sub = String(vids[0].subfolder ?? '');
                        const vtype = String(vids[0].type ?? 'output');
                        const view =
                            base + '/view?filename=' + encodeURIComponent(f) +
                            '&subfolder=' + encodeURIComponent(sub) +
                            '&type=' + encodeURIComponent(vtype);
                        const vr = await fetchWithTimeout(view, {}, 120000);
                        if (vr.ok) {
                            const out = Buffer.from(await vr.arrayBuffer());
                            fs.writeFileSync(dest, out);
                            return {
                                outputs: [
                                    {
                                        path: dest,
                                        kind: 'video' as const,
                                        meta: {
                                            engine: 'comfyui-animatediff',
                                            promptId,
                                            frames,
                                            fps: Number(input.fps ?? 16),
                                            bytes: out.length,
                                        },
                                    },
                                ],
                            };
                        }
                        lastErr = '/view returned HTTP ' + vr.status;
                    }
                }
            } catch (e) {
                lastErr = (e as Error).message;
            }
            await new Promise((r) => setTimeout(r, pollMs));
        }

        throw new PluginFailure({
            code: 'COMFYUI_TIMEOUT',
            message: 'ComfyUI did not finish the animation within ' + Math.round(timeoutMs / 1000) + 's.',
            reason: lastErr || 'no output appeared on /history/' + promptId,
            input: { promptId, comfyUrl: base },
            retryable: true,
            hint: 'AnimateDiff is slow on CPU. Raise timeoutMs, or check the ComfyUI console for the error.',
        });
    },
});
