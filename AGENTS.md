# DiveDay — agent guide

Delight-first dive shop operations: **bookings, waivers, cert checks, trip prep, boat manifests**.
We win on experience; AI agents are the developers. This file, `.claude/rules/`, `docs/`, scripts
and tests are the provider-neutral source of truth; each rule's full text:
[docs/agents/working-rules.md](docs/agents/working-rules.md).

## Read first

1. The **path-scoped rule** in `.claude/rules/` for each area you touch (`db`, `domain`,
   `surfaces`, `i18n`, `e2e`, `infra`, `docs`, `scripts`). Claude Code loads it when you read a
   matching file; another provider reads it first. None is optional.
2. `pnpm task:context <area>` when the task matches one.
3. [docs/README.md](docs/README.md): only the documents needed.
4. The Next.js warning below, before framework work.

## Context economy

Grep generated files (`pnpm-lock.yaml`, `drizzle/`, `.next/`), never whole; read big files by
range and `foo.test.ts` before `foo.ts`; run one focused test; redirect long runs to a file ([working-rules.md](docs/agents/working-rules.md#context-economy)).

## Delegating

Stay in the main loop unless the input would bloat it, parts run in parallel, or a fresh read is
the point; split by context, not area. Plan multi-file work; at most three subagents, each with
objective, output format and boundary, returning a path plus ten lines
([working-rules.md](docs/agents/working-rules.md#delegating)).

## Commands

| Command | What |
| --- | --- |
| `pnpm dev` | dev server; wait for **`dev: serving … — warmed in Ns`**; one per checkout (**run** skill) |
| `pnpm lint`, `pnpm typecheck`, `pnpm test <file>`, `pnpm e2e:affected`, `pnpm verify:push` | the **verify** skill's checklist |
| `pnpm check:repo` | 63 static guards, each naming itself and the offending line ([repo-checks.md](docs/agents/repo-checks.md)) |
| `pnpm agent:doctor`, `node scripts/stack-map.mjs` | what this environment trips you on; your stack's layers |

Other commands: [working-rules.md](docs/agents/working-rules.md#commands). Pass args to a `pnpm`
script directly, never after a literal `--` (that runs the whole suite).

## Route map

Core rows; every other area (auth, DB client, domain logic, glossary, ADRs) is in
[docs/agents/route-map.md](docs/agents/route-map.md) — read it before searching.

| You need | Go to |
| --- | --- |
| A shop's diver pages (schedule, booking, courses) | `src/app/s/[shopSlug]/**` — no auth in it; paths from `src/lib/public-routes.ts`. `/shop/**` is staff, always |
| Staff surfaces (`/shop/**`, auth) | `src/app/shop/` |
| DB schema (source of truth; never read `drizzle/`) | `src/db/schema/`, by Grep and range |
| Queries and seed data | `src/db/shops.ts`; barrels `src/db/trips.ts` and `src/db/seed.ts` — import the barrel, edit the sibling; demo data is a new `src/db/seed-<scenario>.ts` |
| Whether a diver may *buy* a seat vs. *board* | two gates: `src/lib/trip-admission.ts` (booking-time, weaker) and `src/lib/readiness.ts` (boarding-time); admission never refuses someone readiness would clear |
| The booking transaction (capacity) | `src/db/bookings.ts` — tests first |
| Copy and languages | `src/i18n/` — `locales/<locale>/diver.json` and `staff/<namespace>.json`, composed by `staff-messages.ts`; resolution order and switcher: `.claude/rules/i18n.md`; Spanish: `src/i18n/locales/es-ES/README.md` first |
| An idea, question, risk, or cleanup you are **not** doing in this change | a `needs-triage` GitHub issue ([issue-tracker.md](docs/agents/issue-tracker.md), "Filing a follow-up"); `waiting-on-external` when nobody here can move it. Committed work: `docs/product/features/`; human-owned calls: `docs/product/human-decisions/README.md` |

## Skills and providers

Playbooks have one source in `.agents/skills/`, mirrored into Claude by symlinks; use the
[skill index](.claude/skills/README.md). Start or resume with `pnpm agent:bootstrap --provider codex`
(or `claude` / `other`); it reports repository capabilities. Use `pnpm task:context --path
<changed-path>` for bounded contracts and `pnpm task:state` for durable handoffs.
[Provider contract](docs/agents/provider-contract.md).

## Parallel work

Other sessions share this checkout ([rules](docs/agents/working-rules.md#parallel-work)).

- Read the prompt's branch and dirty count before touching shared tree state.
- **Claim the issue before you start**, clear it when you stop
  ([issue-tracker.md](docs/agents/issue-tracker.md)); read open PRs and `pnpm gates` first; a
  **stale** claim is a dead session: take it.
- Worktree from the shell, never `EnterWorktree`; no bare `git stash`; never switch a live
  thread's model.
- Unique branch slug; early draft PR naming owned paths, schema changes and ADR ids; trial-merge
  the target before calling work done.
- **A thread builds one layer itself**; independent parallel layers go to fresh workers with a
  [spec](docs/agents/spec-template.md); past ~150k context, write a state note, retire.
- **Stack everything, across threads**: cut from the newest open branch, draft with `base` on it,
  push one layer at a time, one PR's CI at a time (**stacked-prs**).

## Hard rules

- **A background job you start is yours to end** (`node scripts/stray-processes.mjs --list`, never
  `TaskList`); never pipe a long run through `tail`/`head`.
- **Verify before commit, `pnpm verify:push --quick` before push, fix CI forward** (**verify**); never
  report unverified work as done.
- **File a bug, safety gap or decision** as `needs-triage` (ten a run), an idea as `idea`;
  the rest, one "Notes" PR comment.
- **A failing or flaky test is part of the work**, even unrelated: fixed, or quarantined with an
  issue and a 7-day expiry; never skipped or given a wider timeout; search open PRs first.
- **A pushed PR is done only when its visual diffs are explained** (**visual-triage**) **and every
  review thread is fixed, declined with a reason, or filed**.
- **New runtime dependency → ADR; new domain concept → glossary; invalidated doc → fixed in the
  same PR.**
- **Safety-critical surfaces** (manifests, roll call, readiness, cert gating, medical, waivers,
  nitrox, erasure): boring code, adversarial tests, two differently framed `dive-domain-expert` runs; **security-sensitive changes**: a `security-reviewer` run; the PR body names both.
- **`app → features → lib/db`, one way; routes stay thin.**
- **Tests travel with behavior**: a bug fix starts with a failing test
  ([testing.md](docs/engineering/testing.md)).
- **Copy from a bundle; every sentence earns its place; deletes are soft and say "Delete"; a date
  names its zone, no hard-coded locale; time comes from the clock; a new page ships a
  `loading.tsx`.**
- **There is no legacy. Delete it** (H-49).
- **Text a human will copy is written unwrapped.**
- **A turn ends done, filed, handed over, or on a question**; never on an intention.
- **Secrets never enter the repo.**

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
