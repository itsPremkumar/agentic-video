import { definePlugin, PluginFailure } from '../../../core/define.ts';
import { S, resolveOutPath } from '../../_shared/common.ts';
import { runPlugin } from '../../../core/runner.ts';
import { TEMPLATES, TEMPLATE_NAMES } from './_templates.ts';

/**
 * motion.remotion_template - render a ready-made Remotion composition by
 * name, with a small bag of typed props.
 *
 * Reusable building blocks every video needs:
 *   lower-third  - name + title bar (interviews, news)
 *   title-card   - animated full-screen title (openings)
 *   end-cta      - subscribe / follow / visit button (endings)
 *   countdown    - 10-9-8 ... GO!
 *   progress-bar - animated bar + percentage
 *   kinetic-text - word-by-word text reveal
 *
 * Internally it builds the TSX from the chosen template and delegates the
 * bundling + rendering to motion.remotion, so every template gets the same
 * 7-engine Remotion runtime (full React API, spring, interpolate, etc.).
 */
export default definePlugin({
    id: 'motion.remotion_template',
    name: 'Render a reusable Remotion template',
    category: 'render',
    description: 'Render a prebuilt Remotion composition (lower-third, title-card, end-cta, countdown, progress-bar, kinetic-text, bar-chart, logo-reveal, spectrum, confetti, stat-counter, quote-card, split-screen, typewriter, timeline, list-reveal, waveform, glitch-title, testimonial, product-card) by name.',
    inputs: {
        template: S.string('Template name', { required: true, enum: TEMPLATE_NAMES }),
        name: S.string('lower-third name prop'),
        title: S.string('lower-third title; timeline / list-reveal / bar-chart heading'),
        line1: S.string('title-card line 1'),
        line2: S.string('title-card line 2'),
        headline: S.string('end-cta headline'),
        subline: S.string('end-cta subline'),
        cta: S.string('end-cta button label'),
        from: S.int('countdown start number', { default: 10, minimum: 1, maximum: 99 }),
        label: S.string('progress-bar or stat-counter caption'),
        percent: S.number('progress-bar percent (0-100)', { default: 75, minimum: 0, maximum: 100 }),
        words: S.array('kinetic-text word list'),
        bars: S.array('bar-chart bars: array of {label, value}', { default: undefined }),
        barCount: S.int('spectrum-visualizer / waveform bar count', { default: 32, minimum: 8, maximum: 64 }),
        brand: S.string('logo-reveal brand name'),
        value: S.number('stat-counter target number', { default: 128, minimum: 0 }),
        suffix: S.string('stat-counter suffix, e.g. k / % / x', { default: 'k' }),
        quote: S.string('quote-card / testimonial quote text'),
        author: S.string('quote-card attribution'),
        role: S.string('quote-card / testimonial role line'),
        initials: S.string('testimonial avatar initials', { default: 'JP' }),
        left: S.string('split-screen left panel text'),
        right: S.string('split-screen right panel text'),
        leftLabel: S.string('split-screen left caption'),
        rightLabel: S.string('split-screen right caption'),
        text: S.string('typewriter / glitch-title text'),
        items: S.array('list-reveal bullet list'),
        milestones: S.array('timeline milestones: array of {label, value}'),
        product: S.string('product-card product name'),
        price: S.string('product-card price line'),
        features: S.array('product-card feature bullets'),
        accent: S.string('Accent colour (hex)', { default: '#38bdf8' }),
        bg: S.string('Background colour (hex)', { default: '#06121f' }),
        durationInFrames: S.int('Length in frames', { default: 90, minimum: 1 }),
        fps: S.int('Frames per second', { default: 30, minimum: 1, maximum: 60 }),
        width: S.int('Output width', { default: 1080, minimum: 1 }),
        height: S.int('Output height', { default: 1080, minimum: 1 }),
        out: S.string('Output file name (.mp4)', { default: 'remotion-template.mp4' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const template = String(input.template ?? '');
        const t = TEMPLATES[template];
        if (!t) {
            throw new PluginFailure({ code: 'UNKNOWN_TEMPLATE', message: 'Unknown template "' + template + '".', input: { template }, retryable: true });
        }

        // Gather props in the order the template expects them, falling back
        // to its documented defaults.
        const props: Record<string, unknown> = Object.assign({}, t.defaults);
        if (template === 'lower-third') {
            if (input.name) props.name = String(input.name);
            if (input.title) props.title = String(input.title);
        } else if (template === 'title-card') {
            if (input.line1) props.line1 = String(input.line1);
            if (input.line2) props.line2 = String(input.line2);
        } else if (template === 'end-cta') {
            if (input.headline) props.headline = String(input.headline);
            if (input.subline) props.subline = String(input.subline);
            if (input.cta) props.cta = String(input.cta);
        } else if (template === 'countdown') {
            if (input.from !== undefined) props.from = Number(input.from);
        } else if (template === 'progress-bar') {
            if (input.label) props.label = String(input.label);
            if (input.percent !== undefined) props.percent = Number(input.percent);
        } else if (template === 'kinetic-text') {
            if (Array.isArray(input.words) && (input.words as unknown[]).length > 0) props.words = input.words as string[];
        } else if (template === 'bar-chart-infographic') {
            if (Array.isArray(input.bars) && (input.bars as unknown[]).length > 0) props.bars = input.bars as { label: string; value: number }[];
            if (input.title) props.title = String(input.title);
        } else if (template === 'logo-reveal') {
            if (input.brand) props.brand = String(input.brand);
        } else if (template === 'spectrum-visualizer') {
            // spectrum uses bars as a number (count), bar-chart uses array — distinguish.
            const bc = input.barCount !== undefined ? Number(input.barCount) : undefined;
            if (bc !== undefined) props.bars = bc;
        } else if (template === 'stat-counter') {
            if (input.label) props.label = String(input.label);
            if (input.value !== undefined) props.value = Number(input.value);
            if (input.suffix !== undefined) props.suffix = String(input.suffix);
        } else if (template === 'quote-card') {
            if (input.quote) props.quote = String(input.quote);
            if (input.author) props.author = String(input.author);
            if (input.role) props.role = String(input.role);
        } else if (template === 'split-screen') {
            if (input.left) props.left = String(input.left);
            if (input.right) props.right = String(input.right);
            if (input.leftLabel) props.leftLabel = String(input.leftLabel);
            if (input.rightLabel) props.rightLabel = String(input.rightLabel);
        } else if (template === 'typewriter') {
            if (input.text) props.text = String(input.text);
        } else if (template === 'timeline') {
            if (input.title) props.title = String(input.title);
            if (Array.isArray(input.milestones) && (input.milestones as unknown[]).length > 0) {
                props.milestones = input.milestones as { label: string; value: string }[];
            }
        } else if (template === 'list-reveal') {
            if (input.title) props.title = String(input.title);
            if (Array.isArray(input.items) && (input.items as unknown[]).length > 0) {
                props.items = (input.items as unknown[]).map(String);
            }
        } else if (template === 'waveform') {
            if (input.barCount !== undefined) props.bars = Number(input.barCount);
        } else if (template === 'glitch-title') {
            if (input.text) props.text = String(input.text);
        } else if (template === 'testimonial') {
            if (input.quote) props.quote = String(input.quote);
            if (input.name) props.name = String(input.name);
            if (input.role) props.role = String(input.role);
            if (input.initials) props.initials = String(input.initials);
        } else if (template === 'product-card') {
            if (input.product) props.product = String(input.product);
            if (input.price) props.price = String(input.price);
            if (Array.isArray(input.features) && (input.features as unknown[]).length > 0) {
                props.features = (input.features as unknown[]).map(String);
            }
        }
        if (input.accent) props.accent = String(input.accent);
        if (input.bg) props.bg = String(input.bg);

        // The template builder returns a self-contained TSX module with a
        // default-exported component, so it can be handed straight to
        // motion.remotion. Props travel separately as Remotion inputProps.
        const compositionId = 'Tpl-' + template.replace(/[^A-Za-z0-9㐀-鿿-]/g, '-');

        const result = await runPlugin({
            id: 'motion.remotion',
            input: {
                composition: t.build(),
                compositionId: compositionId,
                durationInFrames: Number(input.durationInFrames ?? 90),
                fps: Number(input.fps ?? 30),
                width: Number(input.width ?? 1080),
                height: Number(input.height ?? 1080),
                props: props,
                out: resolveOutPath(ctx, String(input.out ?? 'remotion-template.mp4')),
            },
        });
        if (!result.ok) throw (result.error as unknown) ?? new PluginFailure({ code: 'TEMPLATE_FAILED', message: 'Template render failed.', retryable: true });
        return result.outputs ? { outputs: result.outputs } : { outputs: [] };
    },
});
