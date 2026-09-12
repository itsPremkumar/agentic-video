import * as fs from 'node:fs';
import * as path from 'node:path';
import { definePlugin, PluginFailure } from '../../core/define.ts';
import { S } from '../_shared/common.ts';

/**
 * image.generate — CREATE an image using an AI text-to-image API.
 *
 * This plugin intentionally does NOT fall back to anything when the key is
 * missing or the call fails. It is a real tool against real APIs (fal.ai +
 * Replicate), and the caller gets a clear FAILED with the upstream error.
 *
 * Add credentials via env (FAL_KEY, REPLICATE_API_TOKEN) or pass apiKey in
 * the input. The plugin surfaces the EXACT reason it failed so a retry or
 * an alternative model can be chosen explicitly.
 */

const FAL_MODELS: Record<string, { endpoint: string; defaults: Record<string, unknown>; imageField: string }> = {
    'flux-schnell': {
        endpoint: 'fal-ai/flux/schnell',
        defaults: { image_size: 'square_hd', num_images: 1, enable_safety_checker: true },
        imageField: 'images',
    },
    'flux-dev': {
        endpoint: 'fal-ai/flux/dev',
        defaults: { image_size: 'square_hd', num_images: 1, enable_safety_checker: true },
        imageField: 'images',
    },
    'recraft-v3': {
        endpoint: 'fal-ai/recraft/v3/text-to-image',
        defaults: { image_size: 'square_hd' },
        imageField: 'images',
    },
    'ideogram-v2': {
        endpoint: 'fal-ai/ideogram/v2',
        defaults: { aspect_ratio: '1:1' },
        imageField: 'images',
    },
};

const REPLICATE_MODELS: Record<string, string> = {
    'sdxl': 'stability-ai/sdxl:39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b',
};

function getKey(name: string, input: Record<string, unknown>): string {
    if (typeof input.apiKey === 'string' && input.apiKey) return input.apiKey;
    const fromEnv = process.env[name];
    if (fromEnv) return fromEnv;
    throw new PluginFailure({
        code: 'API_KEY_MISSING',
        message: `${name} is required for image.generate.`,
        reason: 'No API key was provided in input.apiKey or in the environment.',
        retryable: true,
        hint:
            name === 'FAL_KEY'
                ? 'Get a key from https://fal.ai/dashboard/keys and put it in your .env (FAL_KEY=...).'
                : 'Get a token from https://replicate.com/account/api-tokens and put it in REPLICATE_API_TOKEN.',
    });
}

async function runFal(model: string, input: Record<string, unknown>, apiKey: string): Promise<{ url: string; mime: string }[]> {
    const spec = FAL_MODELS[model];
    if (!spec) throw new PluginFailure({ code: 'UNKNOWN_MODEL', message: `Unknown fal model "${model}".`, retryable: true });
    const body = { ...spec.defaults, ...input };
    delete (body as Record<string, unknown>).model;
    delete (body as Record<string, unknown>).apiKey;
    delete (body as Record<string, unknown>).provider;
    delete (body as Record<string, unknown>).out;

    const submit = await fetch(`https://queue.fal.run/${spec.endpoint}`, {
        method: 'POST',
        headers: { Authorization: `Key ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!submit.ok) {
        const text = await submit.text();
        throw new PluginFailure({
            code: 'UPSTREAM_ERROR',
            message: `fal.ai returned ${submit.status} for ${model}.`,
            reason: text.slice(0, 800),
            retryable: submit.status >= 500,
            hint: 'See https://fal.ai/models for the model input schema.',
        });
    }
    const { request_id } = (await submit.json()) as { request_id: string };

    const deadline = Date.now() + 5 * 60_000;
    while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1500));
        const status = await fetch(`https://queue.fal.run/${spec.endpoint}/requests/${request_id}/status`, {
            headers: { Authorization: `Key ${apiKey}` },
        });
        const statusJson = (await status.json()) as { status?: string };
        if (statusJson.status === 'COMPLETED') break;
        if (statusJson.status === 'FAILED') {
            throw new PluginFailure({
                code: 'UPSTREAM_FAILED',
                message: `fal.ai reported FAILED for ${model}.`,
                retryable: true,
                hint: 'Adjust the prompt or try a different model.',
            });
        }
    }

    const result = (await (
        await fetch(`https://queue.fal.run/${spec.endpoint}/requests/${request_id}`, {
            headers: { Authorization: `Key ${apiKey}` },
        })
    ).json()) as Record<string, unknown>;
    const field = (result as Record<string, unknown>)[spec.imageField] as { url: string; content_type?: string }[] | undefined;
    if (!field?.length) {
        throw new PluginFailure({ code: 'BAD_UPSTREAM_RESULT', message: `fal.ai returned no ${spec.imageField}.`, reason: JSON.stringify(result).slice(0, 400), retryable: true });
    }
    return field.map((i) => ({ url: i.url, mime: i.content_type ?? 'image/png' }));
}

async function runReplicate(modelId: string, input: Record<string, unknown>, apiKey: string): Promise<{ url: string; mime: string }[]> {
    const body = { input: { prompt: input.prompt, ...((input as Record<string, unknown>).opts as object ?? {}) } };
    const submit = await fetch('https://api.replicate.com/v1/predictions', {
        method: 'POST',
        headers: { Authorization: `Token ${apiKey}`, 'Content-Type': 'application/json', Prefer: 'wait' },
        body: JSON.stringify({ version: modelId, ...body }),
    });
    if (!submit.ok) {
        const text = await submit.text();
        throw new PluginFailure({ code: 'UPSTREAM_ERROR', message: `Replicate returned ${submit.status}.`, reason: text.slice(0, 800), retryable: submit.status >= 500 });
    }
    const pred = (await submit.json()) as { output?: string[]; status: string; error?: string };
    if (pred.status !== 'succeeded' || !pred.output?.length) {
        throw new PluginFailure({
            code: 'UPSTREAM_FAILED',
            message: 'Replicate did not produce an image.',
            reason: pred.error ?? `status=${pred.status}`,
            retryable: true,
        });
    }
    return pred.output.map((url) => ({ url, mime: 'image/png' }));
}

export default definePlugin({
    id: 'image.generate',
    name: 'Generate image from prompt',
    category: 'image',
    description: 'Create an image via fal.ai or Replicate text-to-image. Requires a key. Does NOT auto-fallback.',
    inputs: {
        prompt: S.string('What to draw', { required: true }),
        provider: S.string('Which provider', { default: 'fal', enum: ['fal', 'replicate'] }),
        model: S.string('Model identifier (see README for the list)', { default: 'flux-schnell' }),
        apiKey: S.string('Override API key (otherwise uses FAL_KEY or REPLICATE_API_TOKEN env)'),
        width: S.int('Output width (when the model supports it)'),
        height: S.int('Output height'),
        numImages: S.int('How many to generate', { default: 1, minimum: 1, maximum: 4 }),
        out: S.string('Output file name', { default: 'generated.png' }),
    },
    outputs: ['image'],
    async run({ input, ctx }) {
        const prompt = String(input.prompt ?? '').trim();
        if (!prompt) throw new PluginFailure({ code: 'INVALID_INPUT', message: 'prompt is required.', retryable: true });
        const provider = String(input.provider ?? 'fal');
        const model = String(input.model ?? 'flux-schnell');
        const dest = ctx.out(String(input.out ?? 'generated.png'));
        fs.mkdirSync(path.dirname(dest), { recursive: true });

        if (provider === 'fal') {
            const apiKey = getKey('FAL_KEY', input as Record<string, unknown>);
            const falInput: Record<string, unknown> = { prompt, num_images: input.numImages };
            if (input.width) falInput.image_size = `${input.width}x${input.height ?? input.width}`;
            const images = await runFal(model, falInput, apiKey);
            const dl = await fetch(images[0].url);
            if (!dl.ok) throw new PluginFailure({ code: 'DOWNLOAD_FAILED', message: 'Could not download generated image.', reason: `HTTP ${dl.status}`, retryable: true });
            fs.writeFileSync(dest, Buffer.from(await dl.arrayBuffer()));
            return { outputs: [{ path: dest, kind: 'image', meta: { provider, model, prompt } }] };
        }

        if (provider === 'replicate') {
            const apiKey = getKey('REPLICATE_API_TOKEN', input as Record<string, unknown>);
            const modelId = REPLICATE_MODELS[model];
            if (!modelId) throw new PluginFailure({ code: 'UNKNOWN_MODEL', message: `Unknown replicate model "${model}". Available: ${Object.keys(REPLICATE_MODELS).join(', ')}`, retryable: true });
            const images = await runReplicate(modelId, { prompt, opts: { width: input.width, height: input.height } }, apiKey);
            const dl = await fetch(images[0].url);
            if (!dl.ok) throw new PluginFailure({ code: 'DOWNLOAD_FAILED', message: 'Could not download generated image.', reason: `HTTP ${dl.status}`, retryable: true });
            fs.writeFileSync(dest, Buffer.from(await dl.arrayBuffer()));
            return { outputs: [{ path: dest, kind: 'image', meta: { provider, model, prompt } }] };
        }

        throw new PluginFailure({ code: 'INVALID_INPUT', message: `Unknown provider "${provider}".`, retryable: true });
    },
});