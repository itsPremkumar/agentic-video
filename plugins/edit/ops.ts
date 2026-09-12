import { definePlugin } from '../../core/define.ts';
import { S, ensureParentDir } from '../_shared/common.ts';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * edit.ops - atomic batch operations on a JSON timeline spec.
 *
 * The timeline spec is a list of segments:
 *   [
 *     { "id": "intro", "file": "...", "in": 0, "out": 5 },
 *     { "id": "main",  "file": "...", "in": 0, "out": 12 },
 *     { "id": "outro", "file": "...", "in": 0, "out": 4 }
 *   ]
 *
 * Operations (apply in order):
 *   - delete      [index]            - remove a segment by index
 *   - insert      [index, seg]       - insert a segment at index
 *   - reorder     [from, to]         - move segment from index to index
 *   - update      [index, partial]   - merge partial fields into segment
 *   - retime      [index, {in, out}] - set the in/out times
 *
 * Input is a JSON object: { "timeline": [...], "ops": [...] }
 * Output is the new timeline.
 */
export default definePlugin({
    id: 'edit.ops',
    name: 'Atomic batch operations on a JSON timeline spec',
    category: 'edit',
    description:
        'Apply a batch of timeline operations (delete/insert/reorder/update/retime) to a JSON timeline spec. Returns the new timeline + a log of applied ops.',
    inputs: {
        timelineJson: S.string('JSON file containing {timeline, ops}', { required: true }),
        out: S.string('Output JSON path', { default: 'timeline.ops.json' }),
    },
    outputs: ['json'],
    async run({ input, ctx }) {
        const src = String(input.timelineJson ?? '');
        const out = ctx.out(String(input.out ?? 'timeline.ops.json'));
        ensureParentDir(out);

        const raw = JSON.parse(await fs.readFile(src, 'utf8'));
        if (!Array.isArray(raw.timeline)) {
            return { outputs: [], warnings: ['Input JSON has no "timeline" array.'] };
        }
        const timeline: any[] = raw.timeline.slice();
        const ops: any[] = Array.isArray(raw.ops) ? raw.ops : [];
        const log: { op: string; ok: boolean; detail?: string }[] = [];

        for (const op of ops) {
            const name = Object.keys(op || {})[0];
            if (!name) continue;
            const args = op[name];
            try {
                switch (name) {
                    case 'delete': {
                        const [i] = args as [number];
                        if (i < 0 || i >= timeline.length)
                            throw new Error(`delete index ${i} out of range — timeline has ${timeline.length} segment(s), valid 0..${timeline.length - 1}`);
                        const removed = timeline.splice(i, 1)[0];
                        log.push({ op: 'delete[' + i + ']', ok: true, detail: 'removed id=' + (removed?.id ?? '?') });
                        break;
                    }
                    case 'insert': {
                        const [i, seg] = args as [number, any];
                        if (i < 0 || i > timeline.length)
                            throw new Error(`insert index ${i} out of range — valid 0..${timeline.length}`);
                        if (!seg || typeof seg !== 'object')
                            throw new Error('insert needs a segment object as its 2nd argument');
                        timeline.splice(i, 0, seg);
                        log.push({ op: 'insert[' + i + ']', ok: true, detail: 'inserted id=' + (seg.id ?? '?') });
                        break;
                    }
                    case 'reorder': {
                        const [from, to] = args as [number, number];
                        if (from < 0 || from >= timeline.length)
                            throw new Error(`reorder from=${from} out of range — valid 0..${timeline.length - 1}`);
                        if (to < 0 || to >= timeline.length)
                            throw new Error(`reorder to=${to} out of range — valid 0..${timeline.length - 1}`);
                        const [seg] = timeline.splice(from, 1);
                        timeline.splice(to, 0, seg);
                        log.push({ op: 'reorder[' + from + '->' + to + ']', ok: true });
                        break;
                    }
                    case 'update': {
                        const [i, partial] = args as [number, any];
                        if (i < 0 || i >= timeline.length)
                            throw new Error(`update index ${i} out of range — valid 0..${timeline.length - 1}`);
                        if (!partial || typeof partial !== 'object')
                            throw new Error('update needs an object of fields to patch as its 2nd argument');
                        timeline[i] = { ...timeline[i], ...partial };
                        log.push({ op: 'update[' + i + ']', ok: true, detail: 'fields=' + Object.keys(partial).join(',') });
                        break;
                    }
                    case 'retime': {
                        const [i, t] = args as [number, { in?: number; out?: number }];
                        if (i < 0 || i >= timeline.length)
                            throw new Error(`retime index ${i} out of range — valid 0..${timeline.length - 1}`);
                        if (typeof t.in === 'number') timeline[i].in = t.in;
                        if (typeof t.out === 'number') timeline[i].out = t.out;
                        log.push({ op: 'retime[' + i + ']', ok: true });
                        break;
                    }
                    default:
                        log.push({ op: name, ok: false, detail: 'UNKNOWN_OP' });
                }
            } catch (e: any) {
                log.push({ op: name, ok: false, detail: e?.message || String(e) });
            }
        }

        const out0 = {
            timeline,
            appliedOps: log,
            appliedCount: log.filter((l) => l.ok).length,
            failedCount: log.filter((l) => !l.ok).length,
        };
        await fs.writeFile(out, JSON.stringify(out0, null, 2), 'utf8');
        return { outputs: [{ path: out, kind: 'json' as const, meta: { appliedCount: out0.appliedCount, failedCount: out0.failedCount } }] };
    },
});