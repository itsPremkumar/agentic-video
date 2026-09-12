# Prompt: write bespoke Remotion TSX

Use when none of the 20 built-in templates fits and you need `motion.remotion` with your own
composition.

---

Write a Remotion composition as a **single default-exported React component**. It will be passed
to `motion.remotion` as the `composition` input, bundled, and rendered.

## Available

```ts
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate, Easing, Sequence } from 'remotion';
```

Plus the whole React API. No other imports — the bundler only resolves `remotion` and `react`.

## Constraints

1. **One file, default export.** No imports from other local files.
2. Props arrive via inputProps. Declare a `type P = { ... }` and destructure in the signature.
3. **Animate from `useCurrentFrame()`**, never CSS animations or `setTimeout` — Remotion renders
   frame by frame and CSS animations will not survive it.
4. Use `spring({ frame, fps, config: { damping, mass, stiffness } })` and
   `interpolate(frame, [inMin,inMax], [outMin,outMax], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })`.
   Clamping is not optional — unclamped interpolate produces runaway values.
5. Inline styles only. No external CSS files, no web fonts from a CDN.
6. Assume a 1080×1080 canvas unless told otherwise; do not hardcode if `width`/`height` props are
   supplied — prefer `useVideoConfig()`.
7. Keep it self-contained and readable. It is generated code that a human may have to edit.

## Output

Return **only the TSX**, in a fenced code block, plus:

- the props object to pass (as JSON)
- the recommended `durationInFrames`, `fps`, `width`, `height`

## What I need

<describe the composition: purpose, text, brand colours, mood, duration>
