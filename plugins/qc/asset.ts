import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import { definePlugin } from '../../core/define.ts';
import { probe } from '../../core/media.ts';
import { S, requireFile, ensureParentDir } from '../_shared/common.ts';

/**
 * qc.asset - quality-control a single media file before it's used in a render.
 *
 * Validates:
 *   - exists + readable
 *   - minWidth / minHeight (for image/video)
 *   - aspectRatio close to expected (optional)
 *   - duration within tolerance of expectedDuration (optional, for video/audio)
 *   - sha256 fingerprint (used for dedup across a manifest)
 *   - codec/format sanity
 *
 * Returns a JSON QC verdict {ok, problems[], fingerprint}. Does NOT fail the
 * step by default - the external agent decides what to do. Set `failOnProblem`
 * to throw instead.
 */
export default definePlugin({
    id: 'qc.asset',
    name: 'QC a media file before use',
    category: 'qc',
    description: 'Validate one media file: min resolution, aspect ratio, duration, codec, sha256.',
    inputs: {
        file: S.string('Path to the asset file', { required: true }),
        kind: S.string('Asset kind', { enum: ['image', 'video', 'audio'], required: true }),
        minWidth: S.int('Minimum width (image/video)'),
        minHeight: S.int('Minimum height (image/video)'),
        aspectRatio: S.string('Expected aspect ratio e.g. "16:9", "9:16", "1:1"'),
        expectedDuration: S.number('Expected duration in seconds (video/audio)'),
        durationTolerance: S.number('Duration tolerance (s)', { default: 0.5 }),
        failOnProblem: S.bool('Throw PluginFailure if problems found', { default: false }),
        out: S.string('Output JSON path', { default: 'asset-qc.json' }),
    },
    outputs: ['json'],
    async run({ input, ctx }) {
        const file = requireFile(input.file, 'file');
        const kind = String(input.kind);
        const buf = fs.readFileSync(file);
        const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
        const info = await probe(file);
        const streams = (info.streams ?? []) as Array<Record<string, unknown>>;
        const v = streams.find((s) => s.codec_type === 'video');
        const a = streams.find((s) => s.codec_type === 'audio');
        const duration = Number(info.format?.duration ?? 0);
        const size = Number(info.format?.size ?? 0);

        const problems: string[] = [];
        const width = v ? Number(v.width ?? 0) : 0;
        const height = v ? Number(v.height ?? 0) : 0;
        if ((kind === 'image' || kind === 'video') && v) {
            if (input.minWidth !== undefined && width < Number(input.minWidth)) problems.push('width ' + String(width) + ' < minWidth ' + String(input.minWidth));
            if (input.minHeight !== undefined && height < Number(input.minHeight)) problems.push('height ' + String(height) + ' < minHeight ' + String(input.minHeight));
        } else if (kind === 'image' && !v) {
            problems.push('kind=image but no video stream found');
        }
        if (input.aspectRatio && width > 0 && height > 0) {
            const exp = parseAspect(String(input.aspectRatio));
            const actual = width / height;
            if (Math.abs(actual - exp) > 0.01) problems.push('aspect ' + actual.toFixed(3) + ' != expected ' + String(input.aspectRatio) + ' (' + exp.toFixed(3) + ')');
        }
        if (input.expectedDuration !== undefined && (kind === 'video' || kind === 'audio')) {
            const tol = Number(input.durationTolerance ?? 0.5);
            if (Math.abs(duration - Number(input.expectedDuration)) > tol) problems.push('duration ' + duration.toFixed(2) + 's differs from expected ' + String(input.expectedDuration) + 's by more than ' + String(tol) + 's');
        }
        if ((kind === 'video' || kind === 'audio') && !v && !a) problems.push('no video or audio stream found');
        if (size === 0) problems.push('empty file');

        const verdict = {
            file,
            kind,
            ok: problems.length === 0,
            problems,
            sha256,
            duration,
            size,
            video: v ? { codec: v.codec_name, width: v.width, height: v.height } : null,
            audio: a ? { codec: a.codec_name, sampleRate: Number(a.sample_rate ?? 0), channels: a.channels } : null,
        };

        const out = ctx.out(String(input.out ?? 'asset-qc.json'));
        ensureParentDir(out);
        fs.writeFileSync(out, JSON.stringify(verdict, null, 2));

        if (problems.length > 0 && input.failOnProblem) {
            throw new (await import('../../core/define.ts')).PluginFailure({
                code: 'QC_FAILED',
                message: 'Asset failed QC: ' + problems.join('; '),
                input: { file, kind, problems },
                retryable: false,
                hint: 'Fix the asset or relax the QC thresholds.',
            });
        }
        return {
            outputs: [{
                path: out,
                kind: 'json' as const,
                meta: { ok: verdict.ok, problemCount: problems.length, sha256, width, height, duration },
            }],
            warnings: problems,
        };
    },
});

function parseAspect(s: string): number {
    const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(s);
    if (!m) return 1;
    const a = Number(m[1]);
    const b = Number(m[2]);
    return b === 0 ? 1 : a / b;
}