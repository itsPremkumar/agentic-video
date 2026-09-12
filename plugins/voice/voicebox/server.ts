import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { definePlugin, PluginFailure } from '../../../core/define.ts';
import { projectRoot } from '../../../core/env.ts';
import { S } from '../../_shared/common.ts';
import { vbConfig, vbJson, VB_DEFAULT_BASE } from './_voicebox.ts';

/**
 * voice.voicebox_server - lifecycle control for the vendored Voicebox backend.
 *
 * Agentic Video ships the full Voicebox FastAPI server under:
 *     vendor/voicebox/speech/      (MIT, jamiepine/voicebox)
 *
 * This plugin starts / stops / inspects that server so an external agent can
 * bring a local TTS engine up on demand without leaving the plugin system.
 *
 * It is deliberately explicit: "start" either reaches a healthy server or it
 * fails with the last health error. It never silently falls back to Edge-TTS -
 * choosing a different TTS engine is the caller's decision
 * (see voice.tts for Edge-TTS).
 */

const DEFAULT_PORT = 17493;

interface HealthShape {
    status?: string;
    gpu_available?: boolean;
    gpu_type?: string;
    backend_variant?: string;
    [k: string]: unknown;
}

function defaultBackendDir(): string {
    return path.join(projectRoot(), 'vendor', 'voicebox');
}

/** Resolve + verify the vendored backend root (the dir that contains `speech/`). */
function resolveBackendDir(input: Record<string, unknown>): string {
    const raw =
        (typeof input.backendDir === 'string' && input.backendDir) ||
        process.env.VOICEBOX_BACKEND_DIR ||
        defaultBackendDir();
    const dir = path.resolve(raw);
    if (!fs.existsSync(path.join(dir, 'speech', 'main.py'))) {
        throw new PluginFailure({
            code: 'VOICEBOX_BACKEND_NOT_FOUND',
            message: 'No Voicebox backend found at ' + dir + '.',
            reason: 'Expected to find speech/main.py inside that directory.',
            input: { backendDir: dir },
            retryable: false,
            hint:
                'The vendored backend ships with Agentic Video at vendor/voicebox/speech. ' +
                'If you moved it, pass backendDir (or set VOICEBOX_BACKEND_DIR).',
        });
    }
    return dir;
}

function resolvePython(ctx: { python: string }, input: Record<string, unknown>): string {
    if (typeof input.python === 'string' && input.python) return input.python;
    if (process.env.VOICEBOX_PYTHON) return process.env.VOICEBOX_PYTHON;
    return ctx.python || 'python';
}

function portOf(input: Record<string, unknown>): number {
    const p = Number(input.port ?? process.env.VOICEBOX_PORT ?? DEFAULT_PORT);
    return Number.isFinite(p) && p > 0 ? p : DEFAULT_PORT;
}

function baseUrlOf(input: Record<string, unknown>): string {
    if (typeof input.baseUrl === 'string' && input.baseUrl) return input.baseUrl.replace(/\/+$/, '');
    const host = String(input.host ?? process.env.VOICEBOX_HOST ?? '127.0.0.1');
    return 'http://' + host + ':' + portOf(input);
}

/** Probe the server. Returns null when it is not answering. */
async function probe(baseUrl: string, timeoutMs: number): Promise<HealthShape | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(baseUrl + '/health', { signal: controller.signal });
        if (!res.ok) return null;
        return (await res.json()) as HealthShape;
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

/** Windows-only: kill whatever holds `port` (used when /shutdown is unreachable). */
async function killByPort(port: number): Promise<string> {
    if (process.platform !== 'win32') {
        return 'not-windows: skipped';
    }
    const netstat = await new Promise<string>((resolve) => {
        execFile('netstat', ['-ano', '-p', 'tcp'], { windowsHide: true }, (err, stdout) => {
            resolve(err ? '' : String(stdout));
        });
    });
    const pids = new Set<string>();
    for (const line of netstat.split(/\r?\n/)) {
        if (!line.includes('LISTENING')) continue;
        const m = line.match(/:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i);
        if (m && Number(m[1]) === port) pids.add(m[2]);
    }
    if (!pids.size) return 'no listener on port ' + port;
    const killed: string[] = [];
    for (const pid of pids) {
        await new Promise<void>((resolve) => {
            execFile('taskkill', ['/F', '/PID', pid], { windowsHide: true }, () => resolve());
        });
        killed.push(pid);
    }
    return 'killed pid(s): ' + killed.join(', ');
}

export default definePlugin({
    id: 'voice.voicebox_server',
    name: 'Start / stop / inspect the Voicebox server',
    category: 'voice',
    description:
        'Lifecycle control for the vendored Voicebox TTS backend (vendor/voicebox/speech). Actions: start, stop, restart, status.',
    inputs: {
        action: S.string('What to do', {
            default: 'status',
            enum: ['start', 'stop', 'restart', 'status'],
        }),
        backendDir: S.string('Voicebox backend root (the dir containing speech/)', {
            default: undefined,
        }),
        python: S.string('Python interpreter with the Voicebox deps installed', { default: undefined }),
        host: S.string('Bind host', { default: '127.0.0.1' }),
        port: S.int('Bind port', { default: DEFAULT_PORT, minimum: 1, maximum: 65535 }),
        dataDir: S.string('Data dir for profiles / generated audio', { default: undefined }),
        modelsDir: S.string('Optional HF model cache dir (sets VOICEBOX_MODELS_DIR)', { default: undefined }),
        waitMs: S.int('How long to wait for the server to become healthy (start)', {
            default: 120000,
            minimum: 1000,
        }),
        pollMs: S.int('Health poll interval in ms', { default: 1000, minimum: 200 }),
        probeTimeoutMs: S.int('Single health-probe timeout in ms', { default: 3000, minimum: 500 }),
        baseUrl: S.string('Override the base URL used for status/stop probes', { default: VB_DEFAULT_BASE }),
        out: S.string('Optional JSON status file to write', { default: 'voicebox-server-status.json' }),
    },
    outputs: ['json'],
    async run({ input, ctx }) {
        const rec = input as Record<string, unknown>;
        const action = String(input.action ?? 'status').toLowerCase();
        if (!['start', 'stop', 'restart', 'status'].includes(action)) {
            throw new PluginFailure({
                code: 'INVALID_INPUT',
                message: 'action must be one of start | stop | restart | status.',
                input: { action },
                retryable: true,
            });
        }

        const port = portOf(rec);
        const baseUrl = baseUrlOf(rec);
        const probeTimeoutMs = Number(input.probeTimeoutMs ?? 3000);
        const result: Record<string, unknown> = { action, baseUrl, port };

        const healthy = async () => await probe(baseUrl, probeTimeoutMs);

        // ── status ────────────────────────────────────────────────────────
        if (action === 'status') {
            const h = await healthy();
            result.running = h !== null;
            result.health = h;
            // A status probe is a query, not an operation: "not running" is a
            // valid answer, not a failure. Only start/stop/restart can fail.
            return finish(ctx, rec, result, false);
        }

        // ── stop (+ restart) ──────────────────────────────────────────────
        if (action === 'stop' || action === 'restart') {
            const before = await healthy();
            if (!before) {
                result.running = false;
                result.stopped = 'already stopped';
            } else {
                try {
                    await vbJson<unknown>(vbConfig({ ...rec, baseUrl }), '/shutdown', { method: 'POST' });
                    result.stopped = 'graceful /shutdown accepted';
                } catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    result.stopped = 'shutdown endpoint failed (' + msg + '); falling back to port kill';
                    result.killResult = await killByPort(port);
                }
                // Wait for the port to actually free up.
                const deadline = Date.now() + Number(input.waitMs ?? 120000);
                while (Date.now() < deadline) {
                    if ((await healthy()) === null) break;
                    await sleep(Number(input.pollMs ?? 1000));
                }
                result.running = (await healthy()) !== null;
            }
            if (action === 'stop') {
                return finish(ctx, rec, result, result.running === true);
            }
        }

        // ── start ─────────────────────────────────────────────────────────
        if (action === 'start' || action === 'restart') {
            const already = await healthy();
            if (already) {
                result.running = true;
                result.started = 'already running - reused the existing server';
                result.health = already;
                return finish(ctx, rec, result, false);
            }

            const backendDir = resolveBackendDir(rec);
            const python = resolvePython(ctx, rec);
            const dataDir = path.resolve(
                String(input.dataDir ?? path.join(ctx.workspaceDir, 'cache', 'voicebox')),
            );
            fs.mkdirSync(dataDir, { recursive: true });

            const args = [
                '-m',
                'speech.main',
                '--host',
                String(input.host ?? '127.0.0.1'),
                '--port',
                String(port),
                '--data-dir',
                dataDir,
            ];

            const env: NodeJS.ProcessEnv = { ...process.env };
            // A stray PYTHONPATH can shadow the CUDA torch build with a CPU one.
            env.PYTHONPATH = '';
            if (typeof input.modelsDir === 'string' && input.modelsDir) {
                env.VOICEBOX_MODELS_DIR = path.resolve(input.modelsDir);
            }

            const child = spawn(python, args, {
                cwd: backendDir,
                env,
                detached: true,
                stdio: 'ignore',
                windowsHide: true,
            });
            child.unref();

            result.spawned = {
                python,
                args,
                cwd: backendDir,
                dataDir,
                pid: child.pid ?? null,
            };

            const deadline = Date.now() + Number(input.waitMs ?? 120000);
            let h: HealthShape | null = null;
            while (Date.now() < deadline) {
                h = await probe(baseUrl, probeTimeoutMs);
                if (h) break;
                await sleep(Number(input.pollMs ?? 1000));
            }

            result.running = h !== null;
            result.health = h;
            if (!h) {
                return finish(ctx, rec, result, true);
            }
            result.started = 'server is up';
            return finish(ctx, rec, result, false);
        }

        throw new PluginFailure({
            code: 'INVALID_INPUT',
            message: 'Unhandled action: ' + action,
            retryable: true,
        });
    },
});

/** Write the status JSON artifact and return the plugin result. */
function finish(
    ctx: { out: (name: string) => string; log: (m: string) => void },
    rec: Record<string, unknown>,
    result: Record<string, unknown>,
    failed: boolean,
) {
    const dest = ctx.out(String(rec.out ?? 'voicebox-server-status.json'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, JSON.stringify(result, null, 2), 'utf8');
    ctx.log('voicebox_server: ' + JSON.stringify({ action: result.action, running: result.running }));

    if (failed) {
        throw new PluginFailure({
            code: 'VOICEBOX_SERVER_NOT_READY',
            message: 'The Voicebox server is not reachable at ' + String(result.baseUrl) + '.',
            reason: JSON.stringify(result).slice(0, 800),
            input: { action: result.action, baseUrl: result.baseUrl },
            retryable: true,
            hint:
                'Voicebox needs its Python deps installed (fastapi, uvicorn, torch, ...). ' +
                'Check the spawn details in the status JSON, or run the backend manually to see the traceback.',
        });
    }

    return {
        outputs: [{ path: dest, kind: 'json' as const, meta: result }],
    };
}
