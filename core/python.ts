/**
 * core/python.ts — bridge to Python plugins.
 *
 * Protocol:
 *   describe : python python/run_plugin.py describe <module.py> [<module.py> ...]
 *              → JSON array of manifests on stdout
 *   run      : python python/run_plugin.py run <module.py> <request.json> <out.json>
 *              → writes the plugin's result JSON to <out.json>
 *
 * Failures are propagated verbatim (stderr + traceback); nothing is retried or
 * substituted with another implementation.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { run, resolvePython } from './media.ts';
import { projectRoot } from './env.ts';
import type { PluginManifest } from './types.ts';

const RUNNER = () => path.join(projectRoot(), 'python', 'run_plugin.py');

export async function describePythonPlugins(modules: string[]): Promise<PluginManifest[]> {
    if (!modules.length) return [];
    const res = await run(resolvePython(), [RUNNER(), 'describe', ...modules], { timeoutMs: 120_000 });
    if (res.code !== 0) {
        throw new Error(`Python plugin discovery failed (exit ${res.code}):\n${res.stderr.trim()}`);
    }
    try {
        return JSON.parse(res.stdout) as PluginManifest[];
    } catch {
        throw new Error(`Python plugin discovery returned invalid JSON:\n${res.stdout.slice(0, 500)}`);
    }
}

export interface PythonRunOutput {
    outputs: { path: string; kind: string; mime?: string; meta?: Record<string, unknown> }[];
    warnings: string[];
}

export interface PythonRunFailure {
    code: string;
    message: string;
    reason?: string;
    input?: unknown;
    detail?: string;
    retryable: boolean;
    hint?: string;
}

export interface PythonRunResult {
    ok: boolean;
    outputs?: PythonRunOutput['outputs'];
    warnings?: string[];
    error?: PythonRunFailure;
}

export async function runPythonPlugin(
    modulePath: string,
    payload: Record<string, unknown>,
    ctx: { workspaceDir: string; out: string; ffmpeg: string; ffprobe: string; step?: number },
): Promise<PythonRunResult> {
    const reqPath = path.join(ctx.workspaceDir, `_req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.json`);
    const outPath = reqPath.replace(/\.json$/, '.out.json');
    fs.writeFileSync(reqPath, JSON.stringify({ input: payload, ctx: { ...ctx, out: undefined } }), 'utf8');

    let res;
    try {
        res = await run(resolvePython(), [RUNNER(), 'run', modulePath, reqPath, outPath], {
            timeoutMs: 600_000,
        });
    } finally {
        try {
            fs.unlinkSync(reqPath);
        } catch {
            /* ignore */
        }
    }

    // A non-zero exit is expected when the plugin raised PluginFailure: the
    // runner still writes a structured result file. Always prefer that over a
    // generic "exited with code N", so the caller learns WHAT failed and WHY.
    const hasResult = fs.existsSync(outPath);
    if (res.code !== 0 && hasResult) {
        try {
            const parsedFailure = JSON.parse(fs.readFileSync(outPath, 'utf8')) as PythonRunResult;
            if (parsedFailure.error) {
                fs.unlinkSync(outPath);
                return { ok: false, error: { input: payload, ...parsedFailure.error } };
            }
        } catch {
            /* fall through to the generic error below */
        }
    }

    if (res.code !== 0) {
        return {
            ok: false,
            error: {
                code: 'PYTHON_PLUGIN_FAILED',
                message: `Python plugin "${modulePath}" exited with code ${res.code}`,
                reason: res.stderr.trim().split('\n').slice(-3).join(' | ') || 'no stderr',
                input: payload,
                detail: res.stderr.trim(),
                retryable: false,
                hint: 'Check that the Python dependencies for this plugin are installed.',
            },
        };
    }

    if (!hasResult) {
        return {
            ok: false,
            error: {
                code: 'PYTHON_PLUGIN_NO_RESULT',
                message: `Python plugin "${modulePath}" produced no result file`,
                reason: 'The plugin did not write its result JSON.',
                input: payload,
                detail: res.stdout.trim(),
                retryable: false,
            },
        };
    }

    let parsed: PythonRunResult;
    try {
        parsed = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    } catch (e) {
        return {
            ok: false,
            error: {
                code: 'PYTHON_PLUGIN_BAD_RESULT',
                message: `Python plugin "${modulePath}" returned invalid JSON`,
                reason: String(e),
                detail: fs.readFileSync(outPath, 'utf8').slice(0, 500),
                retryable: false,
            },
        };
    } finally {
        try {
            fs.unlinkSync(outPath);
        } catch {
            /* ignore */
        }
    }
    return parsed;
}
