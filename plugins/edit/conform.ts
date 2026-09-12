import * as fs from 'node:fs';
import * as path from 'node:path';
import { definePlugin, PluginFailure } from '../../core/define.ts';
import { S, requireFile, num, resolveOutPath } from '../_shared/common.ts';

/**
 * edit.conform — relink an edit made against proxies back to the originals.
 *
 * The second half of the offline/online split. You cut against `video.proxy`
 * output because it is fast; you deliver from camera originals because that is
 * the point. Conform is the swap, and it is safe precisely because proxies keep
 * the original duration and frame rate — every timecode in the edit still means
 * the same thing against the original.
 *
 * This does not render. It rewrites the timeline so `render.timeline` reads the
 * originals, and it checks the swap is valid before handing it over: if a
 * proxy's duration has drifted from its original, every cut point after it
 * would be wrong, so that is an error rather than a warning.
 */
/** The only per-clip keys render.timeline accepts. Anything else is rejected. */
const TIMELINE_CLIP_KEYS = ['src', 'start', 'duration', 'transition', 'transitionDuration', 'transform', 'speed', 'volume'];

function pickTimelineKeys(clip: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const k of TIMELINE_CLIP_KEYS) if (clip[k] !== undefined) out[k] = clip[k];
    return out;
}

export default definePlugin({
    id: 'edit.conform',
    name: 'Conform to originals',
    category: 'edit',
    description: 'Relink a timeline cut against proxies back to the original media, verifying the swap is valid.',
    inputs: {
        timeline: S.string('Timeline JSON with a "clips" array (e.g. from edit.transcript_cut / edit.beat_cut)'),
        clips: S.array('...or an inline clip array'),
        manifest: S.string('proxies.json written by video.proxy', { required: true }),
        verify: S.bool('Check proxy and original durations match before relinking', { default: true }),
        tolerance: S.number('Allowed duration drift in seconds before it is an error', { default: 0.05, minimum: 0 }),
        allowMissing: S.bool('Keep clips that are not in the manifest instead of failing', { default: true }),
        out: S.string('Output file name for the conformed timeline (.json)', { default: 'conformed.json' }),
    },
    outputs: ['data'],
    async run({ input, ctx }) {
        const manifestPath = requireFile(input.manifest, 'manifest');
        let manifest: Record<string, unknown>;
        try {
            manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
        } catch (err) {
            throw new PluginFailure({
                code: 'INVALID_INPUT',
                message: `Could not read a proxy manifest from "${manifestPath}".`,
                reason: String((err as Error)?.message ?? err),
                input: { manifest: manifestPath },
                retryable: true,
                hint: 'Pass the proxies.json written by video.proxy.',
            });
        }

        const entries = Array.isArray(manifest.entries) ? (manifest.entries as Record<string, unknown>[]) : [];
        if (!entries.length) {
            throw new PluginFailure({
                code: 'EMPTY_GRID',
                message: 'The manifest lists no proxies.',
                reason: 'video.proxy produced no entries, or this is not a proxy manifest.',
                input: { manifest: manifestPath },
                retryable: true,
            });
        }

        // Clips may arrive inline or in a file. A bare array is accepted too, so
        // the output of edit.beat_cut / edit.transcript_cut can go straight in.
        let clips: Record<string, unknown>[] = [];
        let sourceTimeline: Record<string, unknown> | null = null;
        if (Array.isArray(input.clips)) {
            clips = input.clips as Record<string, unknown>[];
        } else if (input.timeline) {
            const timelinePath = requireFile(input.timeline, 'timeline');
            const parsed = JSON.parse(fs.readFileSync(timelinePath, 'utf8')) as unknown;
            if (Array.isArray(parsed)) clips = parsed as Record<string, unknown>[];
            else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).clips)) {
                sourceTimeline = parsed as Record<string, unknown>;
                clips = (parsed as { clips: Record<string, unknown>[] }).clips;
            }
        }
        if (!clips.length) {
            throw new PluginFailure({
                code: 'INVALID_INPUT',
                message: 'No clips found to conform.',
                reason: 'Provide either a timeline file with a "clips" array, or clips directly.',
                input: { timeline: input.timeline },
                retryable: true,
                hint: 'edit.transcript_cut and edit.beat_cut both write {"clips": [...]}.',
            });
        }

        const verify = input.verify !== false;
        const tolerance = num(input.tolerance, 0.05);
        const allowMissing = input.allowMissing !== false;

        // Windows paths are case-insensitive, and the same file can be written
        // with either separator. Normalise before matching or a relink silently
        // misses.
        const key = (p: string): string => path.resolve(p).replace(/\\/g, '/').toLowerCase();
        const byProxy = new Map<string, Record<string, unknown>>();
        for (const e of entries) {
            const proxy = String(e.proxy ?? '');
            if (proxy) byProxy.set(key(proxy), e);
        }

        const conformed: Record<string, unknown>[] = [];
        const relinked: string[] = [];
        const alreadyOriginal: string[] = [];
        const missing: string[] = [];
        const warnings: string[] = [];

        for (const [i, clip] of clips.entries()) {
            const src = String(clip?.src ?? '');
            if (!src) {
                throw new PluginFailure({
                    code: 'INVALID_INPUT',
                    message: `clips[${i}] has no src.`,
                    input: { index: i, clip },
                    retryable: true,
                });
            }

            const entry = byProxy.get(key(src));
            if (!entry) {
                // Not a proxy. Either it was never proxied, or the timeline is
                // already conformed — both are fine, but say which.
                alreadyOriginal.push(src);
                if (!fs.existsSync(path.resolve(src)) && !allowMissing) {
                    missing.push(src);
                }
                conformed.push({ ...pickTimelineKeys(clip) });
                continue;
            }

            const original = String(entry.original ?? '');
            if (!original) {
                throw new PluginFailure({
                    code: 'INVALID_INPUT',
                    message: `The manifest entry for "${path.basename(src)}" has no original path.`,
                    input: { proxy: src },
                    retryable: true,
                    hint: 'Regenerate with video.proxy.',
                });
            }

            if (verify) {
                const proxyDur = num(entry.proxyDuration, 0);
                const originalDur = num(entry.duration, 0);
                const drift = Math.abs(proxyDur - originalDur);
                if (proxyDur > 0 && originalDur > 0 && drift > tolerance) {
                    throw new PluginFailure({
                        code: 'INVALID_INPUT',
                        message: `clips[${i}]: the proxy and original durations differ by ${drift.toFixed(3)}s.`,
                        reason:
                            'A proxy that does not match its original makes every timecode in this edit wrong. ' +
                            'Conforming would silently move every cut point.',
                        input: { index: i, proxy: src, original, proxyDur, originalDur, tolerance },
                        retryable: true,
                        hint: 'Regenerate the proxy with video.proxy, or raise `tolerance` if the drift is expected.',
                    });
                }

                // The clip must still fit inside the original.
                const start = num(clip.start, 0);
                const duration = num(clip.duration, 0);
                if (originalDur > 0 && duration > 0 && start + duration > originalDur + tolerance) {
                    warnings.push(
                        `clips[${i}]: ${start.toFixed(2)}s + ${duration.toFixed(2)}s runs past the end of the original (${originalDur.toFixed(2)}s).`,
                    );
                }
            }

            relinked.push(original);
            // Keep ONLY keys render.timeline accepts. Extra keys are rejected
            // outright by the input validator, so a timeline with provenance
            // sprinkled through it is not actually renderable.
            conformed.push({ ...pickTimelineKeys(clip), src: original });
        }

        if (missing.length && !allowMissing) {
            throw new PluginFailure({
                code: 'FILE_NOT_FOUND',
                message: `${missing.length} clip source(s) are neither in the manifest nor on disk.`,
                input: { missing: missing.slice(0, 10) },
                retryable: true,
                hint: 'Set allowMissing=true to keep them anyway, or fix the paths.',
            });
        }

        // The conformed timeline must be directly renderable, so it carries
        // only clips plus whatever timeline-level inputs the source had. The
        // diagnostics go in a sibling report file instead.
        const passthrough: Record<string, unknown> = {};
        for (const k of ['width', 'height', 'fps', 'audio', 'audioVolume', 'subtitles']) {
            if (sourceTimeline && sourceTimeline[k] !== undefined) passthrough[k] = sourceTimeline[k];
        }

        const dest = resolveOutPath(ctx, String(input.out ?? 'conformed.json'));
        fs.writeFileSync(dest, JSON.stringify({ ...passthrough, clips: conformed }, null, 2), 'utf8');

        const reportPath = dest.replace(/\.json$/i, '-report.json');
        fs.writeFileSync(
            reportPath,
            JSON.stringify(
                {
                    conformed: true,
                    manifest: manifestPath,
                    scale: num(manifest.scale, 1),
                    timeline: dest,
                    total: clips.length,
                    relinkedCount: relinked.length,
                    alreadyOriginalCount: alreadyOriginal.length,
                    relinked,
                    alreadyOriginal,
                    warnings,
                    note: 'The timeline at "timeline" is ready for render.timeline. This file is the audit trail.',
                },
                null,
                2,
            ),
            'utf8',
        );

        return {
            outputs: [
                {
                    path: dest,
                    kind: 'data',
                    meta: {
                        total: clips.length,
                        relinked: relinked.length,
                        alreadyOriginal: alreadyOriginal.length,
                        warnings: warnings.length,
                        report: reportPath,
                    },
                },
            ],
            warnings,
        };
    },
});
