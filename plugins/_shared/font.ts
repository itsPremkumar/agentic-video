/**
 * plugins/_shared/font.ts - resolve a usable TTF path for ffmpeg drawtext.
 *
 * drawtext without an explicit fontfile= tries to use fontconfig, which on
 * Windows has no default config and emits harmless warnings but silently
 * renders no text. Always pass `fontfile=` explicitly.
 *
 * Windows drive letters contain ':', which collides with drawtext's option
 * separator. To sidestep the escaping mess, we COPY the system font into the
 * workspace (path has no colon) on first use, then reference that copy.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const SOURCES: Record<string, string[]> = {
    win32: [
        'C:/Windows/Fonts/segoeui.ttf',
        'C:/Windows/Fonts/arial.ttf',
        'C:/Windows/Fonts/consola.ttf',
        'C:/Windows/Fonts/tahoma.ttf',
        'C:/Windows/Fonts/verdana.ttf',
    ],
    darwin: [
        '/System/Library/Fonts/Helvetica.ttc',
        '/System/Library/Fonts/SFNS.ttf',
        '/Library/Fonts/Arial.ttf',
    ],
    linux: [
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
        '/usr/share/fonts/TTF/DejaVuSans.ttf',
    ],
};

function pickSource(): string {
    const list = SOURCES[process.platform] ?? [];
    for (const p of list) {
        try {
            if (fs.existsSync(p)) return p;
        } catch {
            /* ignore */
        }
    }
    return '';
}

let cached: string | undefined;

function stageDir(): string {
    // Avoid paths that contain ':' (Windows drive letters) or spaces.
    // ffmpeg's drawtext uses ':' as the option separator, and spaces inside
    // a filter_complex string break the parser.
    return '/tmp/videoforge-fonts';
}

export function defaultFontPath(): string {
    if (cached !== undefined) return cached;
    const src = pickSource();
    if (!src) return (cached = '');
    const dir = stageDir();
    try {
        fs.mkdirSync(dir, { recursive: true });
        const dest = path.join(dir, path.basename(src));
        if (!fs.existsSync(dest)) {
            fs.copyFileSync(src, dest);
        }
        return (cached = dest.replace(/\\/g, '/'));
    } catch {
        return (cached = '');
    }
}

export function fontfileArg(): string {
    const p = defaultFontPath();
    return p ? 'fontfile=' + p + ':' : '';
}