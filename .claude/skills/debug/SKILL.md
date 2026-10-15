---
name: debug
description: Debugging playbook — failing tests, red CI, Playwright flakes, Drizzle/PGlite errors, Next 16 surprises, auth redirect loops, a dead dev server. Use on any bug report, red check, or unexpected behavior, before attempting fixes.
---

# Debug

## Ownership

A failing or flaky test is part of the work, even when it's unrelated to what you set out to do —
fix it, don't route around it (`.skip`, a widened timeout, a deleted assertion) or leave it red
for someone else. Before starting the fix, search the repo's open PRs for one that already
touches the same spec or test name (see AGENTS.md **Parallel work**). Two sessions racing to fix
the same flake produce conflicting patches; if another PR already owns it, coordinate in that
thread instead of pushing a second, competing fix.

## The loop

1. **Reproduce first.** Turn the report into a failing test before touching a fix — a Vitest
   case (PGlite integration for data bugs) or a Playwright spec for flow bugs. The failing test
   proves the diagnosis; keeping it proves the cure and pins it forever.
2. **Read the actual error, not the wrapper.** Drizzle wraps Postgres errors — the real error
   and constraint name are in the `error.cause` chain; walk it before speculating.
3. **Isolate fast.** `pnpm exec vitest run <file> -t "<name>"` ·
   `pnpm exec playwright test e2e/<file>.spec.ts:<line>`. Iterate on the single failing case,
   then rerun the full gate. For a Playwright bug, `pnpm e2e:build` once, then
   `pnpm e2e:run e2e/<file>.spec.ts --reporter=line` reruns without paying for another build.
4. **Three failed fix attempts on the same symptom → stop.** Write down what's known and ruled
   out, then re-question the diagnosis. A fourth variation of the same guess is how sessions
   burn hours.

## By symptom

Read the file for the symptom in front of you before the first fix attempt:

- [flakes.md](flakes.md) — a Playwright spec that flakes, times out, races, or renders a page that never hydrates.
- [ci.md](ci.md) — a red CI run: bucket it by job name and first error line first; a failure only CI reproduces.
- [evidence.md](evidence.md) — the symptom → artifact table (Playwright, Drizzle/PGlite, Next 16, auth loops, a dead dev server) and leaked background servers.

## Honesty

Report failures verbatim. If you couldn't verify something (denied permission, CI didn't run),
say so explicitly — never describe partial work as done.

A written justification is a claim, and claims here get checked: a 2026-08-06 review found three
shipped workarounds whose comments confidently explained mechanisms that were false ("a sibling
test's parallel worker", "a permanent redirect" that measured as a 200). Before committing a
comment that explains *why* a workaround is needed, verify the mechanism it names against the
harness or the code (`e2e/servers.ts` for worker isolation, an actual `curl -i` for a status
code). If you can't verify it, write "unverified hypothesis" — a wrong explanation with a
confident voice costs the next session far more than an honest gap.
