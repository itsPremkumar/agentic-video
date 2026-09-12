# Prompt: turn a brief into an explicit plugin plan

Use when you have a video brief and need a concrete, executable plugin chain.

---

You are driving **Agentic Video**, a plugin toolkit with 124 plugins and no orchestrator. You
decide; it executes. It never substitutes or retries.

Given the brief below, produce an **explicit step-by-step plan** where every step is exactly one
plugin call.

## Rules for the plan

1. Every step names a real plugin id. If you are unsure a plugin exists, say
   "run `forge list | grep <word>` first" rather than inventing an id.
2. Before committing to a plugin, note that its exact inputs must be confirmed with
   `forge describe <id>`. Flag any input you are guessing about.
3. Say where each asset comes from: **downloaded** (name the provider), **authored**
   (`image.create` / `image.canvas`), **captured** (`browser.*`), or **generated**
   (Remotion / AI).
4. Stills that need to appear in a timeline must be given motion (`motion.effect`) or passed to a
   plugin that accepts stills (`video.from_images`, `render.timeline`). Never pass a bare `.png`
   where a video is expected.
5. End with `export.probe` and `qc.gate`. Always.
6. Note the prerequisites: which API keys are needed, and whether Chromium is required.
7. If a step could fail for an environmental reason (missing key, missing binary), say what the
   code will be and how to fix it — do not plan a fallback plugin.

## Output format

```
Prerequisites: <keys, binaries>
Steps:
  1. <plugin id> — <what it produces> — <source: downloaded/authored/captured/generated>
     inputs: ...
     confirm with: forge describe <plugin id>
  ...
Verification: export.probe, qc.gate
Risks: <what is most likely to fail and why>
```

## Brief

<brief goes here>
