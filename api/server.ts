#!/usr/bin/env tsx
/**
 * api/server.ts - HTTP surface for Agentic Video.
 *
 *   GET  /health            liveness
 *   GET  /plugins           every plugin manifest
 *   GET  /plugins/:id       one plugin manifest
 *   POST /run               { plugin, input, step? }  -> one OpResult
 *   POST /steps             { steps: [{plugin, input}] } -> OpResult[]
 *
 * This is a thin transport over the same explicit runner the CLI uses.
 * No orchestration, no retry, no fallback. A failed plugin returns HTTP 200
 * with ok:false in the body (the transport succeeded; the operation did not).
 */
import * as http from 'node:http';
import { ensureLoaded, runPlugin } from '../core/runner.ts';
import { all, get } from '../core/registry.ts';
import type { OpResult } from '../core/types.ts';

function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', (c) => {
            data += c;
            if (data.length > 20_000_000) {
                reject(new Error('request body too large'));
                req.destroy();
            }
        });
        req.on('end', () => resolve(data));
        req.on('error', reject);
    });
}

function send(res: http.ServerResponse, status: number, payload: unknown): void {
    const body = JSON.stringify(payload, null, 2);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(body);
}

export async function startServer(port: number): Promise<http.Server> {
    await ensureLoaded();

    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost:' + port);
        const p = url.pathname.replace(/\/+$/, '') || '/';

        try {
            if (req.method === 'GET' && p === '/health') {
                return send(res, 200, { ok: true, plugins: all().length });
            }

            if (req.method === 'GET' && p === '/plugins') {
                return send(res, 200, {
                    ok: true,
                    plugins: all().map((q) => q.manifest),
                });
            }

            if (req.method === 'GET' && p.startsWith('/plugins/')) {
                const id = decodeURIComponent(p.slice('/plugins/'.length));
                const plug = get(id);
                if (!plug) return send(res, 404, { ok: false, error: { code: 'PLUGIN_NOT_FOUND', message: 'No plugin "' + id + '".', retryable: true } });
                return send(res, 200, { ok: true, plugin: plug.manifest });
            }

            if (req.method === 'POST' && p === '/run') {
                const body = JSON.parse((await readBody(req)) || '{}') as {
                    plugin?: string;
                    input?: Record<string, unknown>;
                    step?: number;
                };
                if (!body.plugin) {
                    return send(res, 400, { ok: false, error: { code: 'INVALID_REQUEST', message: 'plugin is required.', retryable: true } });
                }
                const result: OpResult = await runPlugin({
                    id: body.plugin,
                    input: body.input ?? {},
                    step: body.step,
                });
                return send(res, 200, result);
            }

            if (req.method === 'POST' && p === '/steps') {
                const body = JSON.parse((await readBody(req)) || '{}') as {
                    steps?: { plugin: string; input: Record<string, unknown> }[];
                };
                if (!Array.isArray(body.steps)) {
                    return send(res, 400, { ok: false, error: { code: 'INVALID_REQUEST', message: 'steps must be an array.', retryable: true } });
                }
                const results: OpResult[] = [];
                for (let i = 0; i < body.steps.length; i++) {
                    const def = body.steps[i];
                    const r = await runPlugin({ id: def.plugin, input: def.input ?? {}, step: i + 1 });
                    results.push(r);
                    if (!r.ok) break;
                }
                return send(res, 200, { ok: results.every((r) => r.ok), results });
            }

            return send(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: req.method + ' ' + p, retryable: false } });
        } catch (e) {
            const err = e as Error;
            return send(res, 500, {
                ok: false,
                error: {
                    code: 'SERVER_ERROR',
                    message: err?.message ?? String(e),
                    detail: err?.stack,
                    retryable: false,
                },
            });
        }
    });

    return new Promise((resolve) => {
        server.listen(port, () => resolve(server));
    });
}

const portArg = process.argv.indexOf('--port');
const port = portArg >= 0 ? Number(process.argv[portArg + 1]) : Number(process.env.PORT ?? 8787);

if (process.argv[1] && /server\.ts$/.test(process.argv[1])) {
    startServer(port).then(() => {
        console.log('Agentic Video API listening on http://localhost:' + port);
        console.log('  GET  /health');
        console.log('  GET  /plugins');
        console.log('  GET  /plugins/:id');
        console.log('  POST /run   { plugin, input, step? }');
        console.log('  POST /steps { steps: [{ plugin, input }] }');
    });
}
