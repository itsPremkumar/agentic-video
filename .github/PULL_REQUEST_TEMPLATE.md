## What does this change?

<!-- One or two sentences. If it adds a plugin, give the id. -->

Closes #

## Type of change

- [ ] New plugin (`<namespace>.<action>`)
- [ ] Bug fix
- [ ] Core / transport change (CLI, HTTP API, MCP)
- [ ] Docs
- [ ] Chore / CI

## Checklist

- [ ] `npm test` passes (typecheck + plugin contract check)
- [ ] `npm run gen:index` was run if a plugin was added, renamed or removed
- [ ] Every new input has a description, and `enum` inputs declare a `default`
- [ ] Failures are explicit — no silent fallbacks to another provider or format
- [ ] I ran the affected plugin(s) end-to-end and checked the output
      (`export.probe`, or just played/opened the file)

## For new plugins

- [ ] id is snake_case and matches its file path (`plugins/<ns>/<action>.ts`)
- [ ] `name`, `description`, `category`, `outputs` are all set
- [ ] outputs are written via `resolveOutPath(ctx, input.out)`
- [ ] failure codes are listed in the plugin and are specific

## Anything reviewers should know?

<!-- Design trade-offs, things you were unsure about, follow-ups. -->
