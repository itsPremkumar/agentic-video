# Prompt: recover from a plugin failure

Use when `forge run` returned `ok: false`. Paste the JSON error block.

---

A step in Agentic Video failed. The toolkit never substitutes or retries — the failure is
information. Diagnose it.

The error object has `code`, `message`, `reason`, `input`, `detail`, `retryable`, `hint`.

## Answer these, in order

1. **Is it `retryable`?**
   - `true` → my input was wrong. Name the exact input and the correct value. Get the accepted
     values from `forge describe <plugin id>` — do not guess.
   - `false` → the environment is wrong. Name what is missing (binary, API key, file) and how to
     fix it. Do not suggest re-running the same input.

2. **Is it environmental?** Codes like `MISSING_BINARY`, `MISSING_DEPENDENCY`,
   `MISSING_API_KEY`, `CHROME_NOT_FOUND`, `VOICEBOX_UNREACHABLE` mean: fix the machine, then
   re-run the identical step.

3. **Is the source file the problem?** `CLIP_UNREADABLE` and `FILE_NOT_FOUND` usually mean the
   path handed over from the previous step was wrong or the file is a still where a video was
   expected. Trace which step produced it and what it actually printed.

4. **Is it upstream?** `UPSTREAM_*`, `PROVIDER_ERROR`, `DOWNLOAD_FAILED` — retry once, and if it
   persists, change provider *explicitly* and say so.

## Hard constraints

- **Never propose a different plugin to make the failure go away.** If `music.generate` failed on
  `key: "Am"`, the fix is `key: "A"`, not "use `audio.sfx` instead".
- Never say a step succeeded when it returned `ok: false`.
- If `hint` says to run `forge describe <id>`, that is the next action — do it before anything
  else.

## The failure

```
<error JSON goes here>
```
