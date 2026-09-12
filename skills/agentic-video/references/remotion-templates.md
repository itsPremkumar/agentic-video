# Remotion templates

> **Generated** by `npm run gen:skill` from `plugins/motion/remotion/_templates.ts`.
> Do not edit by hand. Add a builder there and it appears here.

`motion.remotion_template` ships **20** ready-made compositions.
Every one gets the full Remotion runtime — React, `spring`, `interpolate`, `Easing` — so these
are real motion graphics, not ffmpeg filters.

```bash
npm run forge -- run motion.remotion_template --input template=stat-counter \
  --input label="Videos rendered" --input value=128 --input suffix=k \
  --input durationInFrames=75 --input out=stat.mp4
```

Common inputs for all: `accent` (hex), `bg` (hex), `durationInFrames`, `fps`, `width`, `height`, `out`.
Arrays and objects must go through `--json file.json`, not `--input k=v`.

## lower-third

**Props:** `name: string`, `title: string`, `accent: string`, `bg: string`

Defaults (what you get if you pass only `template`):

```json
{
  "template": "lower-third",
  "name": "Jamie Pine",
  "title": "Voicebox author",
  "accent": "#38bdf8",
  "bg": "#06121f"
}
```

## title-card

**Props:** `line1: string`, `line2: string`, `accent: string`, `bg: string`

Defaults (what you get if you pass only `template`):

```json
{
  "template": "title-card",
  "line1": "Ocean",
  "line2": "Plastic",
  "accent": "#38bdf8",
  "bg": "#06121f"
}
```

## end-cta

**Props:** `headline: string`, `subline: string`, `cta: string`, `accent: string`, `bg: string`

Defaults (what you get if you pass only `template`):

```json
{
  "template": "end-cta",
  "headline": "Thanks for watching",
  "subline": "See you in the next one",
  "cta": "Subscribe",
  "accent": "#38bdf8",
  "bg": "#06121f"
}
```

## countdown

**Props:** `from: number`, `accent: string`, `bg: string`

Defaults (what you get if you pass only `template`):

```json
{
  "template": "countdown",
  "from": 10,
  "accent": "#38bdf8",
  "bg": "#06121f"
}
```

## progress-bar

**Props:** `label: string`, `percent: number`, `accent: string`, `bg: string`

Defaults (what you get if you pass only `template`):

```json
{
  "template": "progress-bar",
  "label": "Loading",
  "percent": 75,
  "accent": "#38bdf8",
  "bg": "#06121f"
}
```

## kinetic-text

**Props:** `words: string[]`, `accent: string`, `bg: string`

Defaults (what you get if you pass only `template`):

```json
{
  "template": "kinetic-text",
  "words": [
    "Make",
    "your",
    "voice",
    "heard"
  ],
  "accent": "#38bdf8",
  "bg": "#06121f"
}
```

## bar-chart-infographic

**Props:** `title: string`, `bars: { label: string`, `value: number }[]`, `accent: string`, `bg: string`

Defaults (what you get if you pass only `template`):

```json
{
  "template": "bar-chart-infographic",
  "title": "Quarterly growth",
  "bars": [
    {
      "label": "Q1",
      "value": 32
    },
    {
      "label": "Q2",
      "value": 58
    },
    {
      "label": "Q3",
      "value": 47
    },
    {
      "label": "Q4",
      "value": 81
    }
  ],
  "accent": "#38bdf8",
  "bg": "#06121f"
}
```

## logo-reveal

**Props:** `brand: string`, `accent: string`, `bg: string`

Defaults (what you get if you pass only `template`):

```json
{
  "template": "logo-reveal",
  "brand": "VIDEFORGE",
  "accent": "#38bdf8",
  "bg": "#06121f"
}
```

## spectrum-visualizer

**Props:** `accent: string`, `bg: string`, `bars: number`

Defaults (what you get if you pass only `template`):

```json
{
  "template": "spectrum-visualizer",
  "accent": "#38bdf8",
  "bg": "#06121f",
  "bars": 32
}
```

## confetti

**Props:** `accent: string`, `bg: string`

Defaults (what you get if you pass only `template`):

```json
{
  "template": "confetti",
  "accent": "#38bdf8",
  "bg": "#06121f"
}
```

## stat-counter

**Props:** `label: string`, `value: number`, `suffix: string`, `accent: string`, `bg: string`

Defaults (what you get if you pass only `template`):

```json
{
  "template": "stat-counter",
  "label": "Videos rendered",
  "value": 128,
  "suffix": "k",
  "accent": "#38bdf8",
  "bg": "#06121f"
}
```

## quote-card

**Props:** `quote: string`, `author: string`, `role: string`, `accent: string`, `bg: string`

Defaults (what you get if you pass only `template`):

```json
{
  "template": "quote-card",
  "quote": "The best way to predict the future is to invent it.",
  "author": "Alan Kay",
  "role": "Computer scientist",
  "accent": "#38bdf8",
  "bg": "#06121f"
}
```

## split-screen

**Props:** `left: string`, `right: string`, `leftLabel: string`, `rightLabel: string`, `accent: string`, `bg: string`

Defaults (what you get if you pass only `template`):

```json
{
  "template": "split-screen",
  "left": "Before",
  "right": "After",
  "leftLabel": "THEN",
  "rightLabel": "NOW",
  "accent": "#38bdf8",
  "bg": "#06121f"
}
```

## typewriter

**Props:** `text: string`, `accent: string`, `bg: string`

Defaults (what you get if you pass only `template`):

```json
{
  "template": "typewriter",
  "text": "This text types itself out, one character at a time.",
  "accent": "#38bdf8",
  "bg": "#06121f"
}
```

## timeline

**Props:** `title: string`, `milestones: { label: string`, `value: string }[]`, `accent: string`, `bg: string`

Defaults (what you get if you pass only `template`):

```json
{
  "template": "timeline",
  "title": "How we got here",
  "milestones": [
    {
      "label": "Started",
      "value": "March 2026"
    },
    {
      "label": "First release",
      "value": "June 2026"
    },
    {
      "label": "v1.0",
      "value": "September 2026"
    }
  ],
  "accent": "#38bdf8",
  "bg": "#06121f"
}
```

## list-reveal

**Props:** `title: string`, `items: string[]`, `accent: string`, `bg: string`

Defaults (what you get if you pass only `template`):

```json
{
  "template": "list-reveal",
  "title": "What you get",
  "items": [
    "124 plugins",
    "No orchestrator",
    "Explicit failures"
  ],
  "accent": "#38bdf8",
  "bg": "#06121f"
}
```

## waveform

**Props:** `accent: string`, `bg: string`, `bars: number`

Defaults (what you get if you pass only `template`):

```json
{
  "template": "waveform",
  "accent": "#38bdf8",
  "bg": "#06121f",
  "bars": 40
}
```

## glitch-title

**Props:** `text: string`, `accent: string`, `bg: string`

Defaults (what you get if you pass only `template`):

```json
{
  "template": "glitch-title",
  "text": "AGENTIC",
  "accent": "#38bdf8",
  "bg": "#06121f"
}
```

## testimonial

**Props:** `quote: string`, `name: string`, `role: string`, `initials: string`, `accent: string`, `bg: string`

Defaults (what you get if you pass only `template`):

```json
{
  "template": "testimonial",
  "quote": "It never silently swapped a provider on me. That is the whole point.",
  "name": "Jamie Pine",
  "role": "Platform engineer",
  "initials": "JP",
  "accent": "#38bdf8",
  "bg": "#06121f"
}
```

## product-card

**Props:** `product: string`, `price: string`, `features: string[]`, `accent: string`, `bg: string`

Defaults (what you get if you pass only `template`):

```json
{
  "template": "product-card",
  "product": "Studio Plan",
  "price": "$19/mo",
  "features": [
    "Unlimited renders",
    "4K export",
    "No watermark"
  ],
  "accent": "#38bdf8",
  "bg": "#06121f"
}
```
