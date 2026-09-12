# Security Policy

## Supported versions

Agentic Video is early-stage. Security fixes land on `main` only.

| Version | Supported |
|---|---|
| latest `main` | :white_check_mark: |
| anything earlier | :x: |

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately instead:

1. Go to **Security → Report a vulnerability** on the repository
   (GitHub private vulnerability reporting), **or**
2. Email the maintainers directly if advisory reporting is unavailable.

Please include:

- the affected plugin id(s) or file path(s),
- a minimal reproduction (inputs are enough — no need to attach media),
- the impact you believe it has,
- any suggested fix, if you have one.

You should get an acknowledgement within **7 days**. If the report is accepted
we will agree a fix and disclosure timeline with you; if it is declined we will
explain why.

## Scope notes — please read before reporting

Agentic Video is a **local developer toolkit**, not a networked service. A few
things are true by design and are *not* vulnerabilities:

- **Plugins execute local binaries.** ffmpeg, ffprobe, Python and Chromium are
  invoked with arguments derived from plugin inputs. The toolkit assumes the
  caller is trusted — it is designed to be driven by an agent you control, on
  your machine. Do not expose the HTTP API (`npm run api`) or the MCP stdio
  server (`npm run mcp`) to untrusted networks or untrusted callers.
- **API keys live in `.env`.** `.env` is gitignored. If you commit a key by
  mistake, rotate it at the provider — that is always the correct response.
- **Arbitrary file read via plugin inputs.** A plugin that is given a path will
  read that path. That is the contract, not a bypass.
- **`browser.*` plugins run a real browser** against a URL you supply, and can
  execute JavaScript in the page via `act`. Treat the target URL as trusted
  input.

Reports about any of the above on a **locally-run, self-driven** instance will
be closed as intended behaviour. Reports where untrusted input reaches a plugin
without the operator's intent are genuinely in scope — especially anything in
`api/server.ts` or `mcp/server.ts`.

## Dependency vulnerabilities

`ffmpeg` and Chromium are external binaries, updated by your system package
manager and by `npx playwright install`, respectively — not by us. Keep them
current.
