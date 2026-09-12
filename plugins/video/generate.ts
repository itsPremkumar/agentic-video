import * as fs from 'node:fs';
import * as path from 'node:path';
import { definePlugin, PluginFailure } from '../../core/define.ts';
import { S } from '../_shared/common.ts';

/**
 * video.generate — CREATE a video using an AI text-to-video or image-to-video
 * API (fal.ai). Requires FAL_KEY. No fallback: missing key, network error,
 * upstream rejection - every case returns an explicit PluginFailure so the
 * caller can decide what to do.
 */

interface FalModelSpec {
    endpoint: string;
    inputField: string;
    defaults: Record<string, unknown>;
    needsImage?: boolean;
}

const FAL_MODELS: Record<string, FalModelSpec> = {
    'wan-t2v': {
        endpoint: 'fal-ai/wan-t2v',
        inputField: 'video',
        defaults: { num_inference_steps: 30, aspect_ratio: '16:9' },
    },
    'wan-i2v': {
        endpoint: 'fal-ai/wan-i2v',
        inputField: 'video',
        defaults: { num_inference_steps: 30 },
        needsImage: true,
    },
    'luma-ray': {
        endpoint: 'fal-ai/luma-dream-machine',
        inputField: 'video',
        defaults: { loop: false, aspect_ratio: '16:9' },
    },
    'kling-video': {
        endpoint: 'fal-ai/kling-video/v1.6/standard/text-to-video',
        inputField: 'video',
        defaults: { duration: '5', aspect_ratio: '16:9' },
    },
};

function getFalKey(input: Record<string, unknown>): string {
    if (typeof input.apiKey === 'string' && input.apiKey) return input.apiKey;
    const env = process.env.FAL_KEY;
    if (env) return env;
    throw new PluginFailure({
        code: 'API_KEY_MISSING',
        message: 'FAL_KEY is required for video.generate.',
        retryable: true,
        hint: 'Get a key from https://fal.ai/dashboard/keys and put it in your .env (FAL_KEY=...).',
    });
}

export default definePlugin({
    id: 'video.generate',
    name: 'Generate video from prompt/image',
    category: 'video',
    description: 'Create a video via fal.ai text-to-video or image-to-video. Requires FAL_KEY.',
    inputs: {
        prompt: S.string('What the video should show', { required: true }),
        model: S.string('Model identifier', { default: 'wan-t2v', enum: Object.keys(FAL_MODELS) }),
        apiKey: S.string('Override FAL_KEY'),
        initImage: S.string('Optional image path for image-to-video models'),
        duration: S.number('Duration in seconds (when the model supports it)'),
        aspectRatio: S.string('Aspect ratio (e.g. 16:9, 9:16, 1:1)', { default: '9:16' }),
        out: S.string('Output file name (.mp4)', { default: 'generated.mp4' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const prompt = String(input.prompt ?? '').trim();
        if (!prompt) throw new PluginFailure({ code: 'INVALID_INPUT', message: 'prompt is required.', retryable: true });
        const modelName = String(input.model ?? 'wan-t2v');
        const spec = FAL_MODELS[modelName];
        if (!spec) throw new PluginFailure({ code: 'UNKNOWN_MODEL', message: 'Unknown video model "' + modelName + '".', retryable: true });
        if (spec.needsImage && !input.initImage) {
            throw new PluginFailure({ code: 'MISSING_INIT_IMAGE', message: 'Model "' + modelName + '" needs initImage.', retryable: true });
        }
        const apiKey = getFalKey(input as Record<string, unknown>);
        const dest = ctx.out(String(input.out ?? 'generated.mp4'));
        fs.mkdirSync(path.dirname(dest), { recursive: true });

        const body: Record<string, unknown> = Object.assign({}, spec.defaults, { prompt });
        if (input.aspectRatio) body.aspect_ratio = String(input.aspectRatio);
        if (input.duration !== undefined) body.duration = String(input.duration);
        if (input.initImage) {
            const imgPath = path.resolve(String(input.initImage));
            if (!fs.existsSync(imgPath)) throw new PluginFailure({ code: 'FILE_NOT_FOUND', message: 'initImage not found: ' + imgPath, retryable: true });
            const b64 = fs.readFileSync(imgPath).toString('base64');
            body.image_url = 'data:image/png;base64,' + b64;
        }

        const submit = await fetch('https://queue.fal.run/' + spec.endpoint, {
            method: 'POST',
            headers: { Authorization: 'Key ' + apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!submit.ok) {
            const text = await submit.text();
            throw new PluginFailure({ code: 'UPSTREAM_ERROR', message: 'fal.ai returned ' + submit.status + '.', reason: text.slice(0, 800), retryable: submit.status >= 500 });
        }
        const submitJson = (await submit.json()) as { request_id: string };
        const requestId = submitJson.request_id;

        const deadline = Date.now() + 10 * 60_000;
        let lastStatus = '';
        while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 3000));
            const statusRes = await fetch('https://queue.fal.run/' + spec.endpoint + '/requests/' + requestId + '/status', {
                headers: { Authorization: 'Key ' + apiKey },
            });
            const statusJson = (await statusRes.json()) as { status?: string };
            lastStatus = String(statusJson.status ?? '');
            if (lastStatus === 'COMPLETED') break;
            if (lastStatus === 'FAILED') {
                throw new PluginFailure({ code: 'UPSTREAM_FAILED', message: 'fal.ai reported FAILED.', retryable: true, hint: 'Adjust the prompt or model and retry.' });
            }
        }
        if (lastStatus !== 'COMPLETED') {
            throw new PluginFailure({ code: 'UPSTREAM_TIMEOUT', message: 'fal.ai still ' + lastStatus + ' after 10 minutes.', retryable: true });
        }

        const resultRes = await fetch('https://queue.fal.run/' + spec.endpoint + '/requests/' + requestId, {
            headers: { Authorization: 'Key ' + apiKey },
        });
        const result = (await resultRes.json()) as Record<string, unknown>;
        const field = result[spec.inputField] as { url?: string } | string | undefined;
        const videoUrl = typeof field === 'string' ? field : field?.url;
        if (!videoUrl) {
            throw new PluginFailure({ code: 'BAD_UPSTREAM_RESULT', message: 'fal.ai returned no video URL.', reason: JSON.stringify(result).slice(0, 400), retryable: true });
        }
        const dl = await fetch(videoUrl);
        if (!dl.ok) throw new PluginFailure({ code: 'DOWNLOAD_FAILED', message: 'Failed to download generated video (HTTP ' + dl.status + ').', retryable: true });
        fs.writeFileSync(dest, Buffer.from(await dl.arrayBuffer()));
        return { outputs: [{ path: dest, kind: 'video', meta: { provider: 'fal', model: modelName, prompt } }] };
    },
});
