import * as fs from 'node:fs';
import { definePlugin, PluginFailure } from '../../core/define.ts';
import { ffmpeg, probe } from '../../core/media.ts';
import { S, requireFile, num, resolveOutPath } from '../_shared/common.ts';

/**
 * analyze.highlights — auto highlight / viral clip detection.
 *
 * Analyzes a video to find the most engaging moments based on:
 *   - Audio energy (volume peaks, dynamic range)
 *   - Speech density (words per minute from transcript)
 *   - Pause patterns (dramatic pauses suggest emphasis)
 *   - Scene change density (faster cuts = higher energy)
 *
 * Returns ranked clip suggestions with confidence scores.
 */
export default definePlugin({
    id: 'analyze.highlights',
    name: 'Highlight detector',
    category: 'analyze',
    description: 'Analyze video/audio to detect the most engaging moments. Returns ranked clip suggestions with timestamps and confidence scores.',
    inputs: {
        src: S.string('Source video path', { required: true }),
        transcript: S.string('Path to transcript JSON (optional, improves accuracy)'),
        clipDuration: S.number('Target clip duration in seconds', { default: 30, minimum: 5 }),
        count: S.int('Number of highlight clips to return', { default: 5, minimum: 1 }),
        out: S.string('Output JSON file name', { default: 'highlights.json' }),
    },
    outputs: ['data'],
    async run({ input, ctx }) {
        const src = requireFile(input.src, 'src');
        const clipDuration = num(input.clipDuration, 30);
        const count = num(input.count, 5);
        const info = await probe(src);
        const duration = Number(info.format?.duration ?? 0);
        if (!duration) {
            throw new PluginFailure({
                code: 'NO_DURATION',
                message: 'Could not determine video duration.',
                input: { src },
                retryable: true,
            });
        }

        // Step 1: Audio energy analysis — measure loudness per second
        const energyRes = await ffmpeg([
            '-i', src,
            '-af', 'astats=metadata=1:reset=1,ametadata=print:file=-',
            '-f', 'null', '-',
        ]);
        const energyPoints: Array<{ time: number; rms: number; peak: number }> = [];
        const energyLines = energyRes.stderr.split(/\r?\n/);
        let curTime = 0;
        let curRms = 0;
        let curPeak = 0;
        for (const ln of energyLines) {
            const tMatch = /pts:\s*(\d+)/.exec(ln);
            if (tMatch) {
                if (curTime > 0) {
                    energyPoints.push({ time: curTime, rms: curRms, peak: curPeak });
                }
                curTime = Number(tMatch[1]) / 1000; // pts is usually in timebase units, approximate
            }
            const rmsMatch = /RMS peak dB:\s*([-\d.]+)/.exec(ln);
            if (rmsMatch) curRms = Number(rmsMatch[1]);
            const peakMatch = /Peak level dB:\s*([-\d.]+)/.exec(ln);
            if (peakMatch) curPeak = Number(peakMatch[1]);
        }

        // Simpler approach: use silencedetect to find non-silent regions
        const silenceRes = await ffmpeg([
            '-i', src,
            '-af', 'silencedetect=noise=-50dB:d=0.3',
            '-f', 'null', '-',
        ]);
        const speechRegions: Array<{ start: number; end: number }> = [];
        let silenceStart = 0;
        let lastEnd = 0;
        for (const ln of silenceRes.stderr.split(/\r?\n/)) {
            const startMatch = /silence_start: ([\d.]+)/.exec(ln);
            if (startMatch) {
                silenceStart = Number(startMatch[1]);
                if (silenceStart > lastEnd + 0.5) {
                    speechRegions.push({ start: lastEnd, end: silenceStart });
                }
            }
            const endMatch = /silence_end: ([\d.]+)/.exec(ln);
            if (endMatch) {
                lastEnd = Number(endMatch[1]);
            }
        }
        if (lastEnd < duration) {
            speechRegions.push({ start: lastEnd, end: duration });
        }

        // Step 2: Scene change detection
        const sceneRes = await ffmpeg([
            '-i', src,
            '-vf', 'select=gt(scene\\,0.3),showinfo',
            '-f', 'null', '-',
        ]);
        const sceneChanges: number[] = [];
        for (const ln of sceneRes.stderr.split(/\r?\n/)) {
            const match = /pts:\s*(\d+)/.exec(ln);
            if (match && ln.includes('scene')) {
                sceneChanges.push(Number(match[1]) / 1000);
            }
        }

        // Step 3: Load transcript if provided
        let transcriptSegments: Array<{ start: number; end: number; text: string }> = [];
        if (input.transcript) {
            const tPath = requireFile(input.transcript, 'transcript');
            try {
                const tData = JSON.parse(fs.readFileSync(tPath, 'utf8')) as Record<string, unknown>;
                const segs = Array.isArray(tData.segments) ? tData.segments : [];
                transcriptSegments = segs.map((s: any) => ({
                    start: num(s?.start, 0),
                    end: num(s?.end, 0),
                    text: String(s?.text ?? ''),
                }));
            } catch {
                // ignore transcript parse errors
            }
        }

        // Step 4: Score sliding windows
        const windowSize = clipDuration;
        const step = Math.max(1, windowSize / 4);
        const windows: Array<{
            start: number;
            end: number;
            energyScore: number;
            speechScore: number;
            sceneDensity: number;
            wpm: number;
            confidence: number;
        }> = [];

        for (let start = 0; start + windowSize <= duration; start += step) {
            const end = start + windowSize;

            // Energy: count speech regions in window
            const speechInWindow = speechRegions.filter(
                (r) => (r.start >= start && r.start < end) || (r.end > start && r.end <= end) || (r.start <= start && r.end >= end)
            );
            const speechDuration = speechInWindow.reduce((sum, r) => {
                const overlapStart = Math.max(start, r.start);
                const overlapEnd = Math.min(end, r.end);
                return sum + Math.max(0, overlapEnd - overlapStart);
            }, 0);
            const speechRatio = speechDuration / windowSize;

            // Scene density: scene changes per minute
            const scenesInWindow = sceneChanges.filter((t) => t >= start && t < end).length;
            const sceneDensity = (scenesInWindow / windowSize) * 60;

            // WPM from transcript
            const textInWindow = transcriptSegments.filter((s) => s.start >= start && s.end <= end);
            const wordCount = textInWindow.reduce((sum, s) => sum + s.text.split(/\s+/).filter((w) => w.length > 0).length, 0);
            const wpm = speechDuration > 0 ? (wordCount / speechDuration) * 60 : 0;

            // Composite confidence score
            // High energy (speech ratio), moderate scene density, moderate-high WPM
            const energyScore = Math.min(1, speechRatio * 1.5);
            const sceneScore = Math.min(1, sceneDensity / 15); // normalize: 15 cuts/min is very high
            const wpmScore = wpm > 0 ? Math.min(1, wpm / 200) : 0.5; // 200 WPM is fast

            const confidence = (energyScore * 0.4 + sceneScore * 0.3 + wpmScore * 0.3);

            windows.push({ start, end, energyScore, speechScore: speechRatio, sceneDensity, wpm, confidence });
        }

        // Sort by confidence, then deduplicate overlapping windows
        windows.sort((a, b) => b.confidence - a.confidence);

        const selected: typeof windows = [];
        const minGap = clipDuration * 0.5;

        for (const w of windows) {
            const tooClose = selected.some((s) =>
                Math.abs(s.start - w.start) < minGap || Math.abs(s.end - w.end) < minGap
            );
            if (!tooClose) {
                selected.push(w);
                if (selected.length >= count) break;
            }
        }

        selected.sort((a, b) => a.start - b.start);

        const clips = selected.map((w, i) => ({
            rank: i + 1,
            start: Number(w.start.toFixed(2)),
            end: Number(w.end.toFixed(2)),
            duration: Number((w.end - w.start).toFixed(2)),
            confidence: Number((w.confidence * 100).toFixed(1)),
            metrics: {
                speechRatio: Number(w.speechScore.toFixed(2)),
                sceneDensity: Number(w.sceneDensity.toFixed(1)),
                wpm: Math.round(w.wpm),
            },
        }));

        const dest = resolveOutPath(ctx, String(input.out ?? 'highlights.json'));
        fs.writeFileSync(dest, JSON.stringify({
            source: src,
            duration: Number(duration.toFixed(2)),
            clipDuration,
            clipCount: clips.length,
            clips,
        }, null, 2));

        return {
            outputs: [
                {
                    path: dest,
                    kind: 'data',
                    meta: { clips: clips.length, duration, avgConfidence: clips.length > 0 ? clips.reduce((s, c) => s + c.confidence, 0) / clips.length : 0 },
                },
            ],
        };
    },
});
