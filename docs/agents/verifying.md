# Where a check runs: your container, or CI

The short rule is in [AGENTS.md](../../AGENTS.md)'s hard rules. This is the reasoning, and the
line between the two.

## Run locally: anything you can scope to the change

- the one guard you touched — `node scripts/check-<name>.mjs`
- `pnpm test <file> --reporter=dot`, and `pnpm test:changed` mid-iteration
- `pnpm typecheck` and `pnpm lint`, both of which are seconds
- `node scripts/check-repo.mjs` when you touched something a static guard reads — it is
  concurrent and finishes in under a minute
- one focused spec: `pnpm e2e <spec> --reporter=line`, or `pnpm e2e:run <spec>` after one
  `pnpm e2e:build`
- `node scripts/screenshot.mjs <path…>` against a running `pnpm dev` — looking at UI you changed
  is not optional and has no CI substitute

## Push and read CI: anything whole

`pnpm check`'s unit phase, the whole unit suite, `next build`, the whole `e2e/` suite, and the
visual run.

**Why.** CI shards the unit suite four ways across dedicated runners and runs lint, typecheck,
build, the safeguards and the Playwright shards beside it, in parallel. One agent container runs
the same work serially on four cores. Measured on 2026-08-28: a full local unit run passed twenty
minutes without finishing, at a load average above eight, while CI answered the same question in
a few. Worse than the wait is what it does to everything else — a saturated box starves the dev
server, a focused spec, and any parallel session sharing the machine.

**So the PR is the instrument, not the trophy.** Open it before it is green when that is the
fastest way to learn what is broken; say so in the body, name what you have and have not run, and
work what comes back. This does not license pushing carelessly: a push that turns CI red costs a
cycle and reviewers' trust, so the local checks above still run first, and a change you have
reason to think is broken gets fixed before it goes.

**And a red PR is a PR you are still driving.** The licence to push before green is a licence to
find out, never to walk away. A pull request left red with nobody working it is the thing this
rule must not become — see AGENTS.md's rules on visual diffs and review threads, which apply from
the moment it is open.

## The one thing CI cannot answer

Whether the surface looks right. Screenshots, light and dark, phone and desktop, are yours — the
visual run tells you a pixel *moved*, never that the new one is better. See the **design-review**
and **visual-triage** skills.

## What a focused `pnpm e2e` run does and does not reset

Each invocation derives a deterministic per-worktree base port for its worker-server block; set
`E2E_BASE_PORT` explicitly to override it when coordinating with another process.

Every worker owns a server and a database, and `/api/test/reset` restores the shared `blue-mantis`
fixture's **schedule** before each test — so a spec that cancels a departure, fills a boat, or
edits the catalog leaves nothing behind.

What the reset does *not* restore is the shop's **configuration**: four shop-scoped tables (backup
destination and its deliveries, the WhatsApp sender, media-deletion attempts), every `shops` column
but three, and the shifts and calendar feeds of the permanent staff. The list is `RESET_KEEPS` in
`src/db/delete-path-coverage.test.ts`.

Write one of those and it lands in whichever spec Playwright's sharding runs next in that worker,
which is how a shop ended up briefing for zero minutes, sitting in `America/Cancun`, and
de-indexed from search for the rest of a run.

**So a test that writes shop-wide settings takes a shop of its own.** The lazy `privateShop`
fixture (`e2e/fixtures.ts`) mints a fully seeded one and signs in as its owner, and the next test's
reset purges it (ADR 20260815-per-test-private-shops). Never a `finally` that puts the setting
back: it is a convention nothing enforces, and it does not survive the failure it is there for.
