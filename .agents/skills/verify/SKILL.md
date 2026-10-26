---
name: verify
description: Verify changes before commit: checks, running app and changed-state screenshots.
---

# Verify a change

This is the one pre-commit and pre-push checklist; AGENTS.md, `.claude/rules/` and `docs/agents/`
point here rather than repeat it, and [docs/agents/verifying.md](../../../docs/agents/verifying.md)
holds the why. A change is verified when you have **observed** it working, not when checks pass.

## The checklist

Before every commit:

1. **The guard you touched**: `node scripts/check-<name>.mjs`, or `pnpm check:repo` (every static
   guard, concurrently, every failure in one run) when you changed something a guard reads.
2. **`pnpm lint`** and **`pnpm typecheck`**.
3. **`pnpm test <file> --reporter=dot`** for each test file you touched or whose module you touched.
   After any edit under `src/db/schema/`, also the four schema guards, which nothing you edit
   selects:
   `pnpm test src/db/export.test.ts src/db/diver-merge.test.ts src/db/delete-path-coverage.test.ts src/db/retention.test.ts --reporter=dot`
4. **A flow, a page or its copy changed**: `pnpm e2e:affected` names the specs that read what
   you changed, plus five smoke tests; run them with `pnpm e2e <spec…> --reporter=line`
   (section 2).
5. **UI changed**: look at it (section 3).

Before every push:

6. **Push; CI is the gate** (Aaron, 2026-10-25: "remove the push guard and the verify:push
   requirement"). Nothing refuses a `git push`. Push once the round's work is committed, open or
   update the PR, and work CI's answer: a red job is the next commit on the same layer, fixed
   forward. **`pnpm verify:push --quick`** is optional when you want a local answer first: regen
   and a clean tree, lint, typecheck, `check:repo`, the `guards` project, `vitest related` over the
   diff, and a replay of what this branch's last red CI run named. **`pnpm verify:push`** (no
   flag) adds the whole unit suite and every Playwright spec the diff reaches. Either ends with
   what it did not run: say "verify:push --quick green", never "all tests pass locally". A red
   **Visual capture** shard is a functional failure, not a pixel diff. Background:
   [verifying.md](../../../docs/agents/verifying.md#the-pre-push-gate).
7. **One push per round.** Commit as often as you like; push once per round, because each push
   cancels the CI run of the one before it (the measurement is in
   [verifying.md](../../../docs/agents/verifying.md#one-validated-push-per-round)).
8. **A PR body** names its reviews in the template's `## Reviews launched` section, one line per
   reviewer with its answer on the same line; `scripts/guard-pr-body.mjs` runs CI's check over
   the body before `create_pull_request` or `update_pull_request` sends it.

**A review finding is acted on once its test runs and fails.** Turn the finding's failing input
into a test (a reviewer agent's, a bot's, or a claim in a PR thread), run it, and fix only when it
goes red; a finding whose test passes is answered with that test, not a code change. At most two
review rounds on one change: after the second, ask Aaron before another round of fixes.

CI runs anything whole: `pnpm check`, the whole unit suite, `next build`, the whole e2e suite and
the visual run. The shell guard refuses the bare local forms. When you do read a `pnpm check` log,
read the whole tail before fixing anything; the list at the bottom is complete.

## 2. Flows changed: e2e

```bash
pnpm e2e e2e/<flow>.spec.ts --reporter=line   # one spec; the whole suite runs on CI
```

If new user-facing flows were added, extend `e2e/` with a smoke spec for them first, and add a
visual snapshot in the feature's `e2e/visual-*.spec.ts` for any new surface (see the `e2e-and-visual` skill). `pnpm
lint` includes the `clock` rule, which fails if domain/data code reads the wall clock directly.

## 3. UI changed: look at it

Never ship UI you haven't seen; the commands, the probe and the dev-server traps are in
[look.md](look.md). In light only (dark only for colour work, H-90): `pnpm e2e:build` once, then
`pnpm e2e:run e2e/visual-<feature>.spec.ts -g 'light mode.*<capture group>' --reporter=line` (or the
captures the diff reaches, by the **e2e-and-visual** skill's `--grep` recipe), read the PNGs
in `e2e/screenshots/` against `docs/design/principles.md`'s checklist, and give every pixel-probe
flag a verdict. No capture group: `node scripts/screenshot.mjs <path>`. Significant UI: the
`design-review` skill. Send the screenshots with your report.

## 4. Behavior changed: exercise it

For domain logic with no UI yet, drive it directly (a scratch script or `vitest run` on the new
tests) and confirm outputs on realistic inputs — including the failure paths (full boat,
uncertified diver, a nitrox request with no verified card).

## 5. File what you're leaving behind

Before you report done:

- [filing.md](filing.md) — a bug, safety gap or decision becomes a `needs-triage` issue (ten a run at most), an idea or feature an `idea` issue, anything else a bullet in one "Notes" PR comment; name the issues in your closing message.

## Report honestly

State what you ran and what you observed. If anything is red or unverified, say so plainly —
never mark work done with failing or skipped verification. A red or flaky test doesn't get
skipped just because it's unrelated to your change — see the `debug` skill's Ownership section
before fixing it, so you don't duplicate a fix already in flight on another PR.
