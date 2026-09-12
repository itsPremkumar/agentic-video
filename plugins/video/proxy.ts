import * as fs from 'node:fs';
import * as path from 'node:path';
import { definePlugin, PluginFailure } from '../../core/define.ts';
import { ffmpeg, probe, durationOf } from '../../core/media.ts';
import { S, requireFile, num, resolveOutPath } from '../_shared/common.ts';

/**
 * video.proxy — generate low-resolution stand-ins for editing.
 *
 * This is the assistant editor's first job, and the toolkit had no
 * representation of it. Editing 4K originals is slow and pointless: every
 * creative decision (cut points, pacing, which take) is made on a picture that
 * only needs to be good enough to judge. Proxies make that cheap, and a conform
 * pass later swaps the originals back in at full resolution.
 *
 * Proxies preserve DURATION exactly, which is what makes the swap valid: every
 * timecode in an edit made against proxies is still correct against the
 * originals. The manifest this writes is what `edit.conform` reads.
 */
export default definePlugin({
    id: 'video.proxy',
    name: 'Generate proxies',
    category: 'video',
    description: 'Build low-resolution editing proxies for a file or a folder, plus a manifest that edit.conform uses to relink the originals.',
    inputs: {
        src: S.string('A media file, or a folder to walk', { required: true }),
        scale: S.number('Proxy scale relative to the original (0.5 = half size)', { default: 0.5, minimum: 0.05, maximum: 1 }),
        crf: S.int('Quality — higher is smaller and faster to decode', { default: 28, minimum: 0, maximum: 51 }),
        preset: S.string('x264 speed preset', {
            enum: ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow'],
            default: 'veryfast',
        }),
        audioBitrate: S.string('Proxy audio bitrate', { default: '96k' }),
        suffix: S.string('Appended to each proxy file name', { default: '_proxy' }),
        manifest: S.string('Manifest file name (written next to the proxies)', { default: 'proxies.json' }),
        skipExisting: S.bool('Reuse a proxy that already exists', { default: true }),
    },
    outputs: ['video', 'data'],
    async run({ input, ctx }) {
        const raw = requireFile(input.src, 'src');
        const stat = fs.statSync(raw);
        const scale = num(input.scale, 0.5);
        const crf = num(input.crf, 28);
        const preset = String(input.preset ?? 'veryfast');
        const suffix = String(input.suffix ?? '_proxy');
        const skipExisting = input.skipExisting !== false;

        const VIDEO_EXT = /\.(mp4|mov|mkv|webm|avi|m4v|mts|mxf)$/i;
        const sources: string[] = [];
        if (stat.isDirectory()) {
            const walk = (dir: string): void => {
                for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                    const full = path.join(dir, entry.name);
                    if (entry.isDirectory()) walk(full);
                    // Never proxy a proxy.
                    else if (VIDEO_EXT.test(entry.name) && !entry.name.includes(suffix)) sources.push(full);
                }
            };
            walk(raw);
            sources.sort();
        } else {
            sources.push(raw);
        }

        if (!sources.length) {
            throw new PluginFailure({
                code: 'NO_RESULTS',
                message: `No video files found under "${raw}".`,
                reason: stat.isDirectory() ? 'The folder contains no files with a video extension.' : 'Not a video file.',
                input: { src: raw },
                retryable: true,
                hint: 'Point src at a folder of footage, or at a single video file.',
            });
        }

        const outDir = path.join(ctx.workspaceDir, 'proxies');
        fs.mkdirSync(outDir, { recursive: true });

        const entries: Record<string, unknown>[] = [];
        const warnings: string[] = [];
        const proxyPaths: string[] = [];

        for (const source of sources) {
            const base = path.basename(source, path.extname(source));
            const proxy = path.join(outDir, `${base}${suffix}.mp4`);

            if (skipExisting && fs.existsSync(proxy)) {
                const existing = await durationOf(proxy);
                if (existing > 0) {
                    entries.push(await describe(source, proxy, scale, true));
                    proxyPaths.push(proxy);
                    continue;
                }
            }

            const info = await probe(source);
            const stream = ((info?.streams ?? []) as Record<string, unknown>[]).find((s) => s?.codec_type === 'video') ?? {};
            const srcW = num(stream.width, 0);
            const srcH = num(stream.height, 0);
            if (!srcW || !srcH) {
                warnings.push(`${path.basename(source)}: no video stream, skipped.`);
                continue;
            }

            const w = Math.max(2, Math.round((srcW * scale) / 2) * 2);
            const h = Math.max(2, Math.round((srcH * scale) / 2) * 2);

            await ffmpeg([
                '-y', '-i', source,
                // fps is deliberately preserved: changing it would change the
                // frame count and make an edit against the proxy invalid
                // against the original.
                '-vf', `scale=${w}:${h}`,
                '-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-pix_fmt', 'yuv420p',
                '-c:a', 'aac', '-b:a', String(input.audioBitrate ?? '96k'),
                '-movflags', '+faststart',
                proxy,
            ]);

            entries.push(await describe(source, proxy, scale, false));
            proxyPaths.push(proxy);
        }

        if (!entries.length) {
            throw new PluginFailure({
                code: 'NO_RESULTS',
                message: 'No proxies were produced.',
                reason: warnings.join(' ') || 'Every candidate was skipped.',
                input: { src: raw },
                retryable: true,
            });
        }

        const originalBytes = entries.reduce((a, e) => a + num(e.originalBytes, 0), 0);
        const proxyBytes = entries.reduce((a, e) => a + num(e.proxyBytes, 0), 0);

        const manifestPath = resolveOutPath(ctx, String(input.manifest ?? 'proxies.json'));
        fs.writeFileSync(
            manifestPath,
            JSON.stringify(
                {
                    scale,
                    crf,
                    preset,
                    suffix,
                    createdAt: new Date().toISOString(),
                    proxyDir: outDir,
                    count: entries.length,
                    originalBytes,
                    proxyBytes,
                    savedBytes: originalBytes - proxyBytes,
                    entries,
                    note: 'Feed this manifest to edit.conform to relink originals after cutting against the proxies.',
                },
                null,
                2,
            ),
            'utf8',
        );

        return {
            outputs: [
                ...proxyPaths.map((p) => ({ path: p, kind: 'video' as const })),
                {
                    path: manifestPath,
                    kind: 'data' as const,
                    meta: { count: entries.length, scale, savedBytes: originalBytes - proxyBytes },
                },
            ],
            warnings,
        };
    },
});

/** Record everything needed to relink, and to explain the swap afterwards. */
async function describe(original: string, proxy: string, scale: number, reused: boolean): Promise<Record<string, unknown>> {
    const info = await probe(original);
    const stream = ((info?.streams ?? []) as Record<string, unknown>[]).find((s) => s?.codec_type === 'video') ?? {};
    const pInfo = await probe(proxy);
    const pStream = ((pInfo?.streams ?? []) as Record<string, unknown>[]).find((s) => s?.codec_type === 'video') ?? {};
    return {
        original: path.resolve(original),
        proxy: path.resolve(proxy),
        scale,
        reused,
        duration: await durationOf(original),
        proxyDuration: await durationOf(proxy),
        originalWidth: num(stream.width, 0),
        originalHeight: num(stream.height, 0),
        proxyWidth: num(pStream.width, 0),
        proxyHeight: num(pStream.height, 0),
        originalBytes: fs.existsSync(original) ? fs.statSync(original).size : 0,
        proxyBytes: fs.existsSync(proxy) ? fs.statSync(proxy).size : 0,
    };
}
