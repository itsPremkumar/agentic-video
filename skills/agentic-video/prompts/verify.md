# Prompt: verify a rendered video honestly

Use after rendering. Run `export.probe` and `qc.gate` first and paste their output.

---

Agentic Video produced a file. Verify it properly — the goal is to catch real problems, not to
confirm the render worked.

## Check, in this order

1. **Does it exist and is it non-trivial in size?** A few hundred bytes means the mux failed.
2. **Codec and container.** Want `h264` video and `aac` audio. Anything else (especially `vp9`,
   `mpeg4`, or missing audio) will not play everywhere.
3. **Resolution and fps** match what was asked for. Note that `export.probe` returns nested
   `video:{codec,width,height,fps}` and `audio:{codec}` — not a `streams` array.
4. **Duration** matches the sum of the clips minus transition overlap. For N clips of length L
   with transition T, expect `N*L − (N−1)*T`. A big shortfall means clips did not concatenate.
5. **Audio present** if narration or music was mixed in.
6. **Look at actual frames** — `export.contact_sheet` with a 4×4 grid. Probe cannot tell you the
   video is black, or that a caption overlaps the subject.

## Report format

```
Verdict: PASS / FAIL / PASS WITH NOTES
- container/codec: ...
- resolution / fps: ...
- duration: expected Xs, measured Ys
- audio: present / absent (codec)
- frames: <what the contact sheet shows>
Issues found: <specific, with the step that caused them>
Recommended fixes: <the plugin to re-run, with corrected inputs>
```

## Be strict

- Do not call it PASS because the command exited zero. Exit zero means the plugin ran, not that
  the video is good.
- If you did not look at frames, say so explicitly — "duration and codec verified, visual content
  not checked."
- Name the step that caused each issue so it can be re-run in isolation.
