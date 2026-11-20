# Management console agent instructions

Follow the repository's [AGENTS.md](../../AGENTS.md) first; this file only adds what is specific to the console. The design rules are in [DESIGN.md](DESIGN.md).

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

## Console specifics

- Tests: `npm run test --workspace @apicenter/management` (Vitest). Typecheck: `npx tsc --noEmit` in this folder.
- `use-live.cmd` points a local console at live. Do not run it unless you were asked to work against live.
