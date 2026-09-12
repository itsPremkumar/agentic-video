/**
 * core/runner.ts — executes exactly one plugin, one time, and returns an
 * unambiguous OpResult. It never retries, never substitutes another plugin,
 * and never falls back to an alternative implementation.
 */
import * as path from 'node:path';
import { loadPlugins } from './loader.ts';
import { get } from './registry.ts';
import { validateInputs } from './validate.ts';
import { fail, succeed, started, PluginFailure } from './result.ts';
import { MissingBinary, resolveFfmpeg, resolveFfprobe, resolvePython } from './media.ts';
import { makeOut, mimeFor, workspaceDir, fileSize } from './artifacts.ts';
import { projectRoot } from './env.ts';
import type { Artifact, OpError, OpResult, Plugin, PluginManifest } from './types.ts';

let loaded = false;
export async function ensureLoaded(): Promise<void> {
    if (!loaded) {
        await loadPlugins();
        loaded = true;
    }
}

function normaliseArtifacts(raw: unknown, ws: string): Artifact[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter((a): a is Record<string, unknown> => typeof a === 'object' && a !== null)
        .map((a) => {
            const p = String(a.path ?? '');
            return {
                path: p,
                kind: (a.kind as Artifact['kind']) ?? 'data',
                mime: (a.mime as string) ?? mimeFor(p),
                meta: { ...(a.meta as Record<string, unknown> ?? {}), bytes: fileSize(p) },
            };
        });
}

export function toOpError(err: unknown, input: Record<string, unknown>, pluginId: string): OpError {
    const withOpError = err as Error & { opError?: OpError };
    if (withOpError?.opError) return withOpError.opError;

    if (err instanceof PluginFailure) {
        return {
            code: err.code,
            message: err.message,
            reason: err.reason,
            input: err.input ?? input,
            detail: err.detail,
            retryable: err.retryable,
            // Bad input is always diagnosable the same way, so supply the hint
            // centrally instead of every plugin repeating this exact string.
            hint:
                err.hint ??
                (err.code === 'INVALID_INPUT'
                    ? `Run: forge describe ${pluginId}  (to see the accepted inputs)`
                    : undefined),
        };
    }
    if (err instanceof MissingBinary) {
        return {
            code: 'MISSING_BINARY',
            message: err.message,
            reason: 'A required external binary is not installed or not on PATH.',
            input,
            retryable: false,
            hint: 'Install ffmpeg (provides ffmpeg + ffprobe) and make sure it is on PATH.',
        };
    }
    const e = err as Error & { ffmpegArgs?: string[]; detail?: string };
    return {
        code: 'PLUGIN_ERROR',
        message: e?.message ?? String(err),
        reason: `${pluginId} raised an unexpected error.`,
        input,
        detail: [e?.detail, e?.ffmpegArgs ? `ffmpeg args: ${e.ffmpegArgs.join(' ')}` : null, e?.stack]
            .filter(Boolean)
            .join('\n'),
        retryable: false,
    };
}

export interface RunOptions {
    id: string;
    input?: Record<string, unknown>;
    step?: number;
    workspace?: string;
}

export async function runPlugin(opts: RunOptions): Promise<OpResult> {
    await ensureLoaded();
    const input = opts.input ?? {};
    const step = opts.step;
    const ws = opts.workspace ? path.resolve(opts.workspace) : workspaceDir(projectRoot());
    const args = { input, step } as Parameters<Plugin['run']>[0];

    const plugin = get(opts.id);
    if (!plugin) {
        const available = (await import('./registry.ts')).all().map((p) => p.manifest.id);
        return fail(
            { id: opts.id, name: opts.id, category: 'export', description: '', version: '-', engine: 'ts', inputs: {}, outputs: [] } as PluginManifest,
            args as never,
            started(),
            {
                code: 'PLUGIN_NOT_FOUND',
                message: `No plugin with id "${opts.id}".`,
                reason: 'The requested plugin id is not registered.',
                input: { id: opts.id },
                detail: `Available: ${available.join(', ')}`,
                retryable: true,
                hint: 'Run: forge list',
            },
        );
    }

    const t0 = started();
    const ctx = {
        workspaceDir: ws,
        out: makeOut(ws, plugin.manifest.id),
        ffmpeg: safe(() => resolveFfmpeg(), ''),
        ffprobe: safe(() => resolveFfprobe(), ''),
        python: resolvePython(),
        env: process.env,
        log: (m: string) => console.error(`  · ${m}`),
    };

    try {
        const validated = validateInputs(plugin.manifest, input);
        const res = await plugin.run({ input: validated, ctx, step });
        return succeed(plugin.manifest, { input: validated, step } as never, t0, normaliseArtifacts(res.outputs, ws), res.warnings ?? []);
    } catch (err) {
        return fail(plugin.manifest, { input, step } as never, t0, toOpError(err, input, plugin.manifest.id));
    }
}

function safe<T>(fn: () => T, fallback: T): T {
    try {
        return fn();
    } catch {
        return fallback;
    }
}
