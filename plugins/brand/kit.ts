import * as fs from 'node:fs';
import { definePlugin } from '../../core/define.ts';
import { ffmpeg, probe } from '../../core/media.ts';
import { S, requireFile, ensureParentDir } from '../_shared/common.ts';
import { fontfileArg } from '../_shared/font.ts';

/**
 * brand.kit - apply a brand identity kit to a finished video. Bundles the
 * four things almost every branded output needs:
 *
 *   1. logo burn-in   - small PNG overlay in a corner
 *   2. intro card     - 1.5s colored slate with title at the start
 *   3. outro card     - 2.5s colored slate with CTA at the end
 *   4. letterbox bars - optional top/bottom bars for a "cinemascope" feel
 *
 * Every element is optional. The plugin composes the filter graph in one
 * ffmpeg pass. Pure ffmpeg, no model, no Remotion.
 */
export default definePlugin({
    id: 'brand.kit',
    name: 'Apply a brand identity kit to a video',
    category: 'brand',
    description: 'Bundle: logo corner watermark, intro card, outro card, optional cinemascope letterbox bars.',
    inputs: {
        file: S.string('Path to input video', { required: true }),
        logo: S.string('Optional PNG logo with transparency'),
        logoPosition: S.string('Corner for the logo', { enum: ['top-left', 'top-right', 'bottom-left', 'bottom-right'], default: 'bottom-right' }),
        logoScale: S.number('Logo width as fraction of video width (0.05 - 0.4)', { default: 0.12 }),
        logoMargin: S.int('Logo margin in pixels', { default: 30 }),
        logoOpacity: S.number('Logo opacity (0.0 - 1.0)', { default: 0.9 }),
        intro: S.bool('Add intro card', { default: false }),
        introTitle: S.string('Intro title (e.g. "Episode 12")'),
        introSubtitle: S.string('Intro subtitle'),
        introSeconds: S.number('Intro card length in seconds', { default: 1.5 }),
        outro: S.bool('Add outro card', { default: false }),
        outroHeadline: S.string('Outro headline'),
        outroSubline: S.string('Outro subline'),
        outroSeconds: S.number('Outro card length in seconds', { default: 2.5 }),
        accent: S.string('Accent colour (hex)', { default: '#38bdf8' }),
        bg: S.string('Card background colour (hex)', { default: '#0a1422' }),
        letterbox: S.int('Cinemascope letterbox bar height in pixels (0 = off)', { default: 0 }),
        out: S.string('Output file (.mp4)', { default: 'branded.mp4' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const file = requireFile(input.file, 'file');
        const logo = typeof input.logo === 'string' && input.logo ? requireFile(input.logo, 'logo') : '';
        const accent = String(input.accent ?? '#38bdf8');
        const bg = String(input.bg ?? '#0a1422');
        const introTitle = String(input.introTitle ?? '');
        const outroHeadline = String(input.outroHeadline ?? '');
        const info = await probe(file);
        const streams = (info.streams ?? []) as Array<Record<string, unknown>>;
        const v = streams.find((s) => s.codec_type === 'video');
        const width = Number(v?.width ?? 1280);
        const height = Number(v?.height ?? 720);
        const videoDuration = Number(info.format?.duration ?? 0);

        const introSec = Math.max(0, Number(input.introSeconds ?? 1.5));
        const outroSec = Math.max(0, Number(input.outroSeconds ?? 2.5));
        const introFade = Math.max(0.2, introSec / 3);
        const outroFadeDur = Math.max(0.3, outroSec / 3);
        const useIntro = input.intro === true && Boolean(introTitle) && introSec > 0;
        const useOutro = input.outro === true && Boolean(outroHeadline) && outroSec > 0;
        const letterbox = Math.max(0, Math.round(Number(input.letterbox ?? 0)));

        const position = String(input.logoPosition ?? 'bottom-right');
        const margin = Math.max(0, Math.round(Number(input.logoMargin ?? 30)));
        const scaleFrac = Math.max(0.05, Math.min(0.4, Number(input.logoScale ?? 0.12)));
        const opacity = Math.max(0, Math.min(1, Number(input.logoOpacity ?? 0.9)));
        const logoX = position.includes('left') ? margin : width - margin;
        const logoY = position.includes('top') ? margin : height - margin;

        // Build step by step, keeping explicit tags so the graph is easy to read.
        const parts: string[] = [];
        let mainTag = '[0:v]';
        const wantsTrim = videoDuration > 0 && (useIntro || useOutro);
        if (wantsTrim) {
            const trimStart = useIntro ? introSec : 0;
            const trimEnd = useOutro ? videoDuration - outroSec : videoDuration;
            if (trimEnd > trimStart + 0.05) {
                parts.push('[0:v]trim=start=' + String(trimStart) + ':end=' + String(trimEnd) + ',setpts=PTS-STARTPTS[mv]');
                mainTag = '[mv]';
            }
        }

        if (logo) {
            const logoW = Math.max(16, Math.round(width * scaleFrac));
            parts.push('[1:v]scale=' + String(logoW) + ':-1[logo]');
            parts.push('[logo]format=rgba,colorchannelmixer=aa=' + String(opacity) + '[logoo]');
            parts.push(mainTag + '[logoo]overlay=' + String(logoX) + ':' + String(logoY) + '[mvl]');
            mainTag = '[mvl]';
        }

        if (letterbox > 0) {
            const letterboxFilter = 'pad=iw:ih+' + String(letterbox * 2) + ':0:' + String(letterbox) + ':' + bg;
            parts.push(mainTag + letterboxFilter + '[lettered]');
            mainTag = '[lettered]';
        }

        const segments: string[] = [];
        const ff = fontfileArg();
        if (useIntro) {
            parts.push('color=c=' + bg + ':s=' + String(width) + 'x' + String(height) + ':d=' + String(introSec) + ':r=30[intro_src]');
            const titleFs = Math.max(24, Math.round(height / 14));
            const subFs = Math.max(16, Math.round(height / 30));
            parts.push(
                '[intro_src]drawtext=' + ff + 'text=' + introTitle +
                ':fontsize=' + String(titleFs) + ':fontcolor=' + accent + ':x=(w-text_w)/2:y=(h-text_h)/2-40[intro_t]',
            );
            parts.push(
                '[intro_t]drawtext=' + ff + 'text=' + String(input.introSubtitle ?? '') +
                ':fontsize=' + String(subFs) + ':fontcolor=#cbd5e1:x=(w-text_w)/2:y=(h-text_h)/2+40[intro_t2]',
            );
            let introChain = '[intro_t2]fade=t=in:st=0:d=' + String(introFade) + ',fade=t=out:st=' + String(introSec - introFade) + ':d=' + String(introFade);
            if (letterbox > 0) {
                const letterboxFilter = ',pad=iw:ih+' + String(letterbox * 2) + ':0:' + String(letterbox) + ':' + bg;
                introChain += letterboxFilter;
            }
            introChain += '[intro_out]';
            parts.push(introChain);
            segments.push('[intro_out]');
        }
        segments.push(mainTag);
        if (useOutro) {
            parts.push('color=c=' + bg + ':s=' + String(width) + 'x' + String(height) + ':d=' + String(outroSec) + ':r=30[outro_src]');
            const headFs = Math.max(24, Math.round(height / 12));
            const subFs = Math.max(16, Math.round(height / 28));
            parts.push(
                '[outro_src]drawtext=' + ff + 'text=' + outroHeadline +
                ':fontsize=' + String(headFs) + ':fontcolor=' + accent + ':x=(w-text_w)/2:y=(h-text_h)/2-60[outro_h]',
            );
            parts.push(
                '[outro_h]drawtext=' + ff + 'text=' + String(input.outroSubline ?? '') +
                ':fontsize=' + String(subFs) + ':fontcolor=#cbd5e1:x=(w-text_w)/2:y=(h-text_h)/2+40[outro_h2]',
            );
            let outroChain = '[outro_h2]fade=t=in:st=0:d=' + String(outroFadeDur);
            if (letterbox > 0) {
                const letterboxFilter = ',pad=iw:ih+' + String(letterbox * 2) + ':0:' + String(letterbox) + ':' + bg;
                outroChain += letterboxFilter;
            }
            outroChain += '[outro_out]';
            parts.push(outroChain);
            segments.push('[outro_out]');
        }

        if (segments.length > 1) {
            const concatIn = segments.join('');
            parts.push(concatIn + 'concat=n=' + String(segments.length) + ':v=1:a=0[outv]');
        } else {
            parts.push(mainTag + 'copy[outv]');
        }

        const fullFilter = parts.join(';');

        const out = ctx.out(String(input.out ?? 'branded.mp4'));
        ensureParentDir(out);

        const inputArgs: string[] = ['-y', '-i', file];
        if (logo) inputArgs.push('-i', logo);
        const args = [...inputArgs, '-filter_complex', fullFilter, '-map', '[outv]', '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-an', out];
        await ffmpeg(args);
        const stat = fs.statSync(out);
        return { outputs: [{ path: out, kind: 'video' as const, meta: { bytes: stat.size, logo: Boolean(logo), intro: useIntro, outro: useOutro, letterbox } }] };
    },
});