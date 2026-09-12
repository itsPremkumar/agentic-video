#!/usr/bin/env tsx
/**
 * mcp/server.ts - Model Context Protocol (stdio) server for Agentic Video.
 *
 * Each Agentic Video plugin is exposed as one MCP tool. Inputs become the tool's
 * inputSchema. tool results are the formatted OpResult ack.
 *
 * Run:
 *   npx tsx mcp/server.ts
 * Then talk JSON-RPC to stdin/stdout.
 */
import * as readline from 'node:readline';
import { ensureLoaded, runPlugin } from '../core/runner.ts';
import { all } from '../core/registry.ts';
import { formatAck } from '../core/result.ts';
import type { OpResult } from '../core/types.ts';

const SERVER_INFO = { name: 'agentic-video', version: '0.1.0' };

function jsonSchemaFor(spec: { type: string; description?: string; required?: boolean; enum?: string[]; minimum?: number; maximum?: number; default?: unknown }): Record<string, unknown> {
    const s: Record<string, unknown> = {};
    if (spec.description) s.description = spec.description;
    if (spec.enum) s.enum = spec.enum;
    switch (spec.type) {
        case 'string': s.type = 'string'; break;
        case 'number': s.type = 'number'; break;
        case 'integer': s.type = 'integer'; break;
        case 'boolean': s.type = 'boolean'; break;
        case 'array': s.type = 'array'; s.items = { type: 'string' }; break;
        case 'object': s.type = 'object'; s.additionalProperties = true; break;
    }
    if (spec.minimum !== undefined) s.minimum = spec.minimum;
    if (spec.maximum !== undefined) s.maximum = spec.maximum;
    return s;
}

function buildTools() {
    return all().map((p) => {
        const props: Record<string, unknown> = {};
        const required: string[] = [];
        for (const [k, v] of Object.entries(p.manifest.inputs)) {
            props[k] = jsonSchemaFor(v);
            if (v.required) required.push(k);
        }
        return {
            name: p.manifest.id,
            description: p.manifest.description,
            inputSchema: { type: 'object', properties: props, required, additionalProperties: false },
        };
    });
}

function reply(id: number | string | null, result: unknown): string {
    return JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n';
}
function replyErr(id: number | string | null, code: number, message: string, detail?: unknown): string {
    return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message, data: detail } }) + '\n';
}

async function handle(line: string, tools: ReturnType<typeof buildTools>): Promise<string | null> {
    let req: { jsonrpc?: string; id?: number | string; method?: string; params?: Record<string, unknown> };
    try {
        req = JSON.parse(line);
    } catch {
        return replyErr(null, -32700, 'Parse error');
    }
    const id: number | string | null = req.id ?? null;
    try {
        switch (req.method) {
            case 'initialize':
                return reply(id, {
                    protocolVersion: '2024-11-05',
                    capabilities: { tools: {} },
                    serverInfo: SERVER_INFO,
                });
            case 'notifications/initialized':
                return null; // no reply for notifications
            case 'tools/list':
                return reply(id, { tools });
            case 'tools/call': {
                const params = (req.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
                if (!params.name) return replyErr(id, -32602, 'Missing tool name');
                const result: OpResult = await runPlugin({
                    id: params.name,
                    input: params.arguments ?? {},
                });
                const text = formatAck(result) + (result.outputs?.length ? '\n' + JSON.stringify(result.outputs, null, 2) : '');
                return reply(id, { content: [{ type: 'text', text }], isError: !result.ok });
            }
            default:
                return replyErr(id, -32601, 'Method not found: ' + req.method);
        }
    } catch (e) {
        return replyErr(id, -32603, (e as Error)?.message ?? String(e));
    }
}

async function main(): Promise<void> {
    await ensureLoaded();
    const tools = buildTools();
    const rl = readline.createInterface({ input: process.stdin, terminal: false });
    rl.on('line', async (line) => {
        const out = await handle(line, tools);
        if (out) process.stdout.write(out);
    });
    rl.on('close', () => process.exit(0));
}

main().catch((e) => {
    process.stderr.write('mcp server crashed: ' + (e?.stack ?? e) + '\n');
    process.exit(1);
});
