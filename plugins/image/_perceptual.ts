/**
 * plugins/image/_perceptual.ts - dHash (difference hash) perceptual fingerprint.
 *
 * Algorithm:
 *   1. ffmpeg downsamples the image to 9x8 grayscale.
 *   2. For each of the 8 rows, compare 9 pixels -> 8 bits = 64 bits total.
 *   3. Each bit = 1 if the left pixel is brighter than the right pixel.
 *
 * Two images are "perceptually similar" when their dHash Hamming distance is
 * small (typically <= 5 for near-duplicates, <= 10 for loose matches).
 *
 * Pure ffmpeg + pure TS, no native deps.
 */
import { run, resolveFfmpeg } from '../../core/media.ts';

export async function dHash(file: string): Promise<string> {
    const bin = resolveFfmpeg();
    // 9x8 grayscale, rawvideo, one byte per pixel.
    const args = [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        file,
        '-vf',
        'scale=9:8,format=gray',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'gray',
        '-frames:v',
        '1',
        '-',
    ];
    const res = await run(bin, args, { timeoutMs: 30_000 });
    if (res.code !== 0) {
        throw new Error(`dHash: ffmpeg failed on "${file}": ${res.stderr.trim()}`);
    }
    const buf = Buffer.from(res.stdout, 'binary');
    if (buf.length < 9 * 8) {
        throw new Error(`dHash: expected 72 bytes, got ${buf.length}`);
    }
    let h = 0n;
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const left = buf[row * 9 + col];
            const right = buf[row * 9 + col + 1];
            if (left > right) h = (h << 1n) | 1n;
            else h = h << 1n;
        }
    }
    return h.toString(16).padStart(16, '0');
}

export function hammingHex(a: string, b: string): number {
    if (a.length !== b.length) return Math.max(a.length, b.length) * 4;
    let ai = BigInt('0x' + a);
    let bi = BigInt('0x' + b);
    let d = ai ^ bi;
    let n = 0;
    while (d) {
        if (d & 1n) n++;
        d >>= 1n;
    }
    return n;
}

/** Sample the input at evenly-spaced timestamps and return dHashes with timestamps. */
export async function dHashFrames(
    file: string,
    count: number,
    durationSec: number,
): Promise<{ t: number; hash: string }[]> {
    const bin = resolveFfmpeg();
    const out: { t: number; hash: string }[] = [];
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const os = await import('node:os');
    const tmp = path.join(os.tmpdir(), 'vf-dhash-' + Math.random().toString(36).slice(2) + '.png');
    try {
        for (let i = 0; i < count; i++) {
            const t = durationSec * (i + 0.5) / count;
            const args = [
                '-hide_banner',
                '-loglevel',
                'error',
                '-ss',
                t.toFixed(3),
                '-i',
                file,
                '-frames:v',
                '1',
                '-vf',
                'scale=9:8,format=gray',
                '-pix_fmt',
                'gray',
                '-f',
                'rawvideo',
                '-',
            ];
            // Actually grab raw directly:
            const r = await run(bin, args, { timeoutMs: 30_000 });
            if (r.code !== 0) continue;
            const buf = Buffer.from(r.stdout, 'binary');
            if (buf.length < 72) continue;
            let h = 0n;
            for (let row = 0; row < 8; row++) {
                for (let col = 0; col < 8; col++) {
                    if (buf[row * 9 + col] > buf[row * 9 + col + 1]) h = (h << 1n) | 1n;
                    else h <<= 1n;
                }
            }
            out.push({ t, hash: h.toString(16).padStart(16, '0') });
        }
    } finally {
        try { await fs.unlink(tmp); } catch { /* ignore */ }
    }
    return out;
}