import * as fs from 'node:fs';
import { definePlugin } from '../../core/define.ts';
import { ffmpeg, probe } from '../../core/media.ts';
import { S, requireFile, ensureParentDir } from '../_shared/common.ts';

/**
 * analyze.scene_audit - post-render audit for a video built from a scene manifest.
 *
 * Input is a "scenes.json" file of the shape:
 *   [{label: "intro", file: "intro.mp4", start: 0, end: 1.5}, ...]
 *
 * The plugin:
 *   1. Probes each scene file (duration, codec, dims, audio)
 *   2. Runs analyze.video on the assembled output (if outputFile provided)
 *   3. Cross-checks each scene's actual duration vs the manifest's start..end
 *   4. Emits a JSON report with per-scene status + the final assembly's QC
 *
 * Useful as the last step in any multi-scene render chain — the agent gets a
 * single report to decide whether to ship or re-edit.
 */
interface Scene { label?: string; file: string; start: number; end: number }

export default definePlugin({
    id: 'analyze.scene_audit',
    name: 'Audit a multi-scene render against its manifest',
    category: 'analyze',
    description: 'Per-scene probe + cross-check + final assembly QC. Returns a JSON audit report.',
    inputs: {
        manifest: S.string('Path to scenes.json (array of {label, file, start, end})', { required: true }),
        outputFile: S.string('Optional path to the final assembled video for QC'),
        out: S.string('Output JSON path', { default: 'audit-report.json' }),
    },
    outputs: ['json'],
    async run({ input, ctx }) {
        const manifestPath = requireFile(input.manifest, 'manifest');
        const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Scene[];
        if (!Array.isArray(raw)) {
            throw new (await import('../../core/define.ts')).PluginFailure({
                code: 'INVALID_INPUT',
                message: 'scenes.json must be an array.',
                input: { manifest: manifestPath },
                retryable: false,
            });
        }

        const scenes = [];
        for (let i = 0; i < raw.length; i++) {
            const s = raw[i];
            const filePath = requireFile(s.file, 'scenes[' + i + '].file');
            const info = await probe(filePath);
            const streams = (info.streams ?? []) as Array<Record<string, unknown>>;
            const v = streams.find((x) => x.codec_type === 'video');
            const a = streams.find((x) => x.codec_type === 'audio');
            const actualDuration = Number(info.format?.duration ?? 0);
            const wantedDuration = Math.max(0, (s.end ?? 0) - (s.start ?? 0));
            const durationDelta = actualDuration - wantedDuration;
            const warnings: string[] = [];
            if (Math.abs(durationDelta) > 0.1) warnings.push('duration differs by ' + durationDelta.toFixed(2) + 's');
            if (!v) warnings.push('no video stream');
            scenes.push({
                index: i,
                label: s.label ?? ('scene_' + String(i)),
                file: filePath,
                wanted: { start: s.start, end: s.end, duration: wantedDuration },
                actual: {
                    duration: actualDuration,
                    width: v ? v.width : null,
                    height: v ? v.height : null,
                    codec: v ? v.codec_name : null,
                    hasAudio: Boolean(a),
                },
                warnings,
                ok: warnings.length === 0 && Math.abs(durationDelta) < 0.5,
            });
        }

        let finalReport: Record<string, unknown> | null = null;
        if (input.outputFile && typeof input.outputFile === 'string' && fs.existsSync(String(input.outputFile))) {
            const file = String(input.outputFile);
            const blackFilter = 'blackdetect=d=0.5:pix_th=0.05';
            const blackRes = await ffmpeg(['-i', file, '-vf', blackFilter, '-f', 'null', '-']);
            const lines = blackRes.stderr.split(/\r?\n/);
            const blackCount = lines.filter((l) => l.includes('black_end:')).length;
            const freezeRes = await ffmpeg(['-i', file, '-vf', 'freezedetect=n=0.001:d=0.6', '-f', 'null', '-']);
            const freezeCount = freezeRes.stderr.split(/\r?\n/).filter((l) => l.includes('freeze_end:')).length;
            finalReport = { file, blackSegments: blackCount, frozenSegments: freezeCount };
        }

        const audit = {
            manifest: manifestPath,
            sceneCount: scenes.length,
            scenesOk: scenes.filter((s) => s.ok).length,
            scenes,
            finalReport,
            generatedAt: new Date().toISOString(),
        };

        const out = ctx.out(String(input.out ?? 'audit-report.json'));
        ensureParentDir(out);
        fs.writeFileSync(out, JSON.stringify(audit, null, 2));

        return {
            outputs: [{
                path: out,
                kind: 'json' as const,
                meta: {
                    sceneCount: scenes.length,
                    scenesOk: audit.scenesOk,
                    finalReport,
                },
            }],
            warnings: scenes.flatMap((s) => s.warnings),
        };
    },
});