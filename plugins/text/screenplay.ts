import * as fs from 'node:fs';
import { definePlugin, PluginFailure } from '../../core/define.ts';
import { S, requireFile, resolveOutPath, num } from '../_shared/common.ts';

/**
 * text.screenplay — screenplay in, shot list out.
 *
 * The front of the pipeline, and the stage the toolkit was missing entirely.
 * `text.script_parse` handles cue-block scripts (`[Visual: ...]`), which is a
 * different format from a screenplay. Nothing understood INT./EXT. slug lines,
 * character cues, parentheticals or transitions — so an agent handed a script
 * had no way to turn it into shots it could then go and produce.
 *
 * This is deterministic parsing, not interpretation: it does not invent shots
 * or decide how to cover a scene. It extracts the structure that is actually on
 * the page — scenes, action, dialogue, cast — and splits action into shot-sized
 * units with a conservative camera suggestion. The caller still decides.
 */
export default definePlugin({
    id: 'text.screenplay',
    name: 'Screenplay to shot list',
    category: 'analyze',
    description: 'Parse a screenplay into scenes, shots, dialogue and a cast list, ready to drive production.',
    inputs: {
        script: S.string('Screenplay text'),
        file: S.string('...or a path to a .txt / .fountain file'),
        wordsPerSecond: S.number('Speaking rate used to estimate durations', { default: 2.6, minimum: 0.5 }),
        minShotSeconds: S.number('Floor for an estimated shot duration', { default: 1.2, minimum: 0 }),
        out: S.string('Output file name for the shot list (.json)', { default: 'shot-list.json' }),
    },
    outputs: ['data'],
    async run({ input, ctx }) {
        let text = String(input.script ?? '');
        if (!text && input.file) {
            text = fs.readFileSync(requireFile(input.file, 'file'), 'utf8');
        }
        if (!text.trim()) {
            throw new PluginFailure({
                code: 'INVALID_INPUT',
                message: 'Provide a screenplay as `script` or `file`.',
                input: { hasScript: Boolean(input.script), hasFile: Boolean(input.file) },
                retryable: true,
                hint: 'Standard screenplay format: "INT. LOCATION - DAY", then action, then CHARACTER NAME above their dialogue.',
            });
        }

        const wps = num(input.wordsPerSecond, 2.6);
        const minShot = num(input.minShotSeconds, 1.2);
        const lines = text.replace(/\r\n/g, '\n').split('\n');

        const SLUG = /^\s*(?:(\d+[A-Z]?[.)]\s*)?)?(INT\.?\/EXT\.?|EXT\.?\/INT\.?|INT\.?|EXT\.?|I\/E)\s+(.+?)\s*$/i;
        const TRANSITION = /^\s*(CUT TO:|FADE (IN|OUT)[:.]?|DISSOLVE TO:|SMASH CUT TO:|MATCH CUT TO:|WIPE TO:)\s*$/i;
        const PARENTHETICAL = /^\s*\(.*\)\s*$/;
        // A character cue is a short, mostly-uppercase line with no terminal
        // punctuation. Scene headings are excluded by the SLUG check first.
        const isCharacterCue = (l: string): boolean => {
            const t = l.trim();
            if (!t || t.length > 48) return false;
            if (SLUG.test(t) || TRANSITION.test(t) || PARENTHETICAL.test(t)) return false;
            if (/[.!?,;:]$/.test(t)) return false;
            const letters = t.replace(/[^A-Za-z]/g, '');
            if (letters.length < 2) return false;
            return letters === letters.toUpperCase();
        };

        interface Shot {
            scene: number;
            slug: string;
            kind: 'action' | 'dialogue';
            description: string;
            character: string | null;
            suggestedSize: string;
            estimatedSeconds: number;
        }
        const scenes: Record<string, unknown>[] = [];
        const shots: Shot[] = [];
        const castCounts = new Map<string, number>();
        let current: { index: number; slug: string; location: string; timeOfDay: string; intExt: string; action: string[]; dialogue: string[]; characters: Set<string> } | null = null;

        /** How much of the frame the line implies. Deliberately conservative. */
        const suggestSize = (s: string, kind: 'action' | 'dialogue'): string => {
            const t = s.toLowerCase();
            if (kind === 'dialogue') {
                if (/(whisper|quietly|close|tear|face|eyes)/.test(t)) return 'close';
                return 'medium';
            }
            if (/(wide|establishing|landscape|skyline|panorama|aerial|city|field|ocean|desert)/.test(t)) return 'wide';
            if (/(hand|finger|detail|close on|insert|text|screen|photo)/.test(t)) return 'close';
            return 'medium';
        };
        const estimate = (s: string): number => {
            const words = s.trim().split(/\s+/).filter(Boolean).length;
            return Math.max(minShot, Number((words / wps).toFixed(2)));
        };

        const pushShot = (kind: 'action' | 'dialogue', description: string, character: string | null): void => {
            if (!current) return;
            shots.push({
                scene: current.index,
                slug: current.slug,
                kind,
                description,
                character,
                suggestedSize: suggestSize(description, kind),
                estimatedSeconds: estimate(description),
            });
        };

        let pendingCharacter: string | null = null;
        for (const raw of lines) {
            const line = raw.trimEnd();
            if (!line.trim()) {
                pendingCharacter = null;
                continue;
            }
            if (TRANSITION.test(line)) continue;

            const slug = SLUG.exec(line);
            if (slug) {
                const locationPart = slug[3] ?? '';
                const [loc, tod] = locationPart.split(/\s+-\s+/);
                current = {
                    index: scenes.length + 1,
                    slug: line.trim().replace(/^\d+[A-Z]?[.)]\s*/, ''),
                    intExt: (slug[2] ?? '').toUpperCase().replace(/\.$/, ''),
                    location: (loc ?? '').trim(),
                    timeOfDay: (tod ?? '').trim() || 'unspecified',
                    action: [],
                    dialogue: [],
                    characters: new Set<string>(),
                };
                scenes.push(current as unknown as Record<string, unknown>);
                pendingCharacter = null;
                continue;
            }

            if (!current) {
                // Text before the first slug line: treat as a cold open rather
                // than dropping it, but do not invent a location.
                current = {
                    index: 1,
                    slug: 'COLD OPEN',
                    intExt: 'UNSPECIFIED',
                    location: 'unspecified',
                    timeOfDay: 'unspecified',
                    action: [],
                    dialogue: [],
                    characters: new Set<string>(),
                };
                scenes.push(current as unknown as Record<string, unknown>);
            }

            if (PARENTHETICAL.test(line)) continue;

            if (isCharacterCue(line)) {
                pendingCharacter = line.trim().replace(/\s*\(.*\)\s*$/, '').trim();
                current.characters.add(pendingCharacter);
                castCounts.set(pendingCharacter, castCounts.get(pendingCharacter) ?? 0);
                continue;
            }

            if (pendingCharacter) {
                current.dialogue.push(line.trim());
                castCounts.set(pendingCharacter, (castCounts.get(pendingCharacter) ?? 0) + 1);
                pushShot('dialogue', line.trim(), pendingCharacter);
                // A character keeps speaking until a blank line or a new cue.
                continue;
            }

            current.action.push(line.trim());
            pushShot('action', line.trim(), null);
        }

        if (!shots.length) {
            throw new PluginFailure({
                code: 'NO_SEGMENTS',
                message: 'No scenes or shots could be parsed from this text.',
                reason: 'Nothing matched a screenplay slug line (INT./EXT.) or any action text.',
                input: { characters: text.length },
                retryable: true,
                hint: 'Check the format — a scene must start with something like "INT. KITCHEN - DAY".',
            });
        }

        const totalSeconds = Number(shots.reduce((a, s) => a + s.estimatedSeconds, 0).toFixed(2));
        const cast = [...castCounts.entries()]
            .map(([name, lines]) => ({ name, lines }))
            .sort((a, b) => b.lines - a.lines);

        const dest = resolveOutPath(ctx, String(input.out ?? 'shot-list.json'));
        fs.writeFileSync(
            dest,
            JSON.stringify(
                {
                    scenes: scenes.map((s) => {
                        const sc = s as unknown as { characters: Set<string> };
                        return { ...s, characters: [...sc.characters] };
                    }),
                    shots,
                    cast,
                    sceneCount: scenes.length,
                    shotCount: shots.length,
                    dialogueShots: shots.filter((s) => s.kind === 'dialogue').length,
                    actionShots: shots.filter((s) => s.kind === 'action').length,
                    estimatedSeconds: totalSeconds,
                    note:
                        'Each shot is a unit the pipeline can produce: pick or generate footage per shot, then ' +
                        'assemble with render.timeline using estimatedSeconds as a starting duration. `cast` maps ' +
                        'straight onto voice.dialogue speakers.',
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
                    meta: { scenes: scenes.length, shots: shots.length, cast: cast.length, estimatedSeconds: totalSeconds },
                },
            ],
        };
    },
});
