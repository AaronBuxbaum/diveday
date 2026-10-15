# DiveDay — agent guide

Delight-first dive shop operations: **bookings, waivers, cert checks, trip prep, boat manifests**.
We win on experience; AI agents are the developers. This file, `.claude/rules/`, `docs/`, scripts
and tests are the provider-neutral source of truth. Each section below is one line per rule; the
full statement, with its incident, is in [docs/agents/working-rules.md](docs/agents/working-rules.md).

## Read first

1. The **path-scoped rule** in `.claude/rules/` for each area you touch (`db`, `domain`,
   `surfaces`, `i18n`, `e2e`, `infra`, `docs`, `scripts`): its rules and route map. Claude Code
   loads it when you read a matching file; another provider reads it first. None is optional.
2. `pnpm task:context <area>` when the task matches an area.
3. [docs/README.md](docs/README.md), only the documents the task needs.
4. The Next.js warning at the bottom before framework work.

## Context economy

Grep generated files (`pnpm-lock.yaml`, `drizzle/`, `.next/`, reports) for one line, never whole;
read big files by range; read `foo.test.ts` before `foo.ts`; iterate on one focused test; redirect
a long run to a file. In full: [working-rules.md](docs/agents/working-rules.md#context-economy).

## Delegating

One-file change: no plan, no subagent. Multi-file: plan first. Cross-area: at most three
subagents, each with an objective, output format and boundary. Scouting and test runs go to a
cheap subagent (`Explore`); a worker hands back a file path plus at most ten lines
([working-rules.md](docs/agents/working-rules.md#delegating)).

## Commands

| Command | What |
| --- | --- |
| `pnpm dev` | dev server; wait for **`dev: serving … — warmed in Ns`**, one per checkout (the **run** skill) |
| `pnpm lint`, `pnpm typecheck`, `pnpm test <file>`, `pnpm e2e:affected`, `pnpm verify:push` | the checklist is the **verify** skill |
| `pnpm check:repo` | 60 static guards; each names itself and the offending line ([repo-checks.md](docs/agents/repo-checks.md)) |
| `pnpm agent:doctor`, `node scripts/stack-map.mjs` | what this environment will trip you on; your stack's layers and top |

Every other command: [working-rules.md](docs/agents/working-rules.md#commands). Pass args to a
`pnpm` script directly, never after a literal `--` (that runs the whole suite).

## Route map

The core rows; every other area is in [docs/agents/route-map.md](docs/agents/route-map.md) — read
it before searching for one.

| You need | Go to |
| --- | --- |
| A shop's diver-facing pages (schedule, booking, courses) | `src/app/s/[shopSlug]/**` — no auth anywhere in it; paths from `src/lib/public-routes.ts`. `/shop/**` is staff, without exception |
| Staff surfaces (all `/shop/**`, auth-gated) | `src/app/shop/` |
| DB schema (source of truth — never read `drizzle/`) | `src/db/schema/`, by Grep and range |
| DB client / test db factory | `src/db/client.ts` (`getDb()`, `createTestDb()`) |
| Queries and seed data | `src/db/shops.ts`; barrels `src/db/trips.ts` and `src/db/seed.ts` — import from the barrel, edit the sibling; demo data is a new `src/db/seed-<scenario>.ts` |
| Whether a diver may *buy* a seat vs. *board* | two gates: `src/lib/trip-admission.ts` (booking-time, weaker) and `src/lib/readiness.ts` (boarding-time); admission may never refuse someone readiness would clear |
| The booking transaction (capacity enforcement) | `src/db/bookings.ts` — read its tests first |
| Copy and languages | `src/i18n/` — `locales/<locale>/diver.json`, `locales/<locale>/staff/<namespace>.json`, composed by `staff-messages.ts`; resolution order and the switcher in `.claude/rules/i18n.md`; Spanish: `src/i18n/locales/es-ES/README.md` first |
| Domain logic (framework-free) | `src/lib/` — capacity in `trips.ts`, dates in `format.ts` |
| A domain term, or an ADR | `docs/product/glossary/` by domain; ADRs indexed in `docs/architecture/decisions/README.md` (generated; the guard names the command) |
| Auth: session, gates, edge check | `src/lib/auth.ts` / `auth-secret.ts` / `authz.ts` + `session.ts`; edge layer `src/proxy.ts` |
| An idea, question, risk, or cleanup you are **not** doing in this change | a GitHub issue labelled `needs-triage` ([docs/agents/issue-tracker.md](docs/agents/issue-tracker.md)'s "Filing a follow-up"), `waiting-on-external` when nobody here can move it. Committed work lives in `docs/product/features/`, human-owned calls in `docs/product/human-decisions/README.md` |

## Skills and providers

Playbooks, indexed in [.claude/skills/README.md](.claude/skills/README.md): **new-feature**,
**verify**, **design-implementation**, **i18n-copy**, **copy-restraint**, **design-review**,
**brand-voice**, **schema-change**, **debug**, **instant-navigation**, **e2e-and-visual**,
**visual-triage**, **adr**, **stacked-prs**, **triage**, **backlog-routine**, **marketing-page**,
**switching-pages**, **run**, **expand-content**, **commercial-outreach**. Another provider reads
the `SKILL.md`. A skill that contradicts docs, tests or code is fixed in the same change. Reviewer
agents are launched, never skipped: `dive-domain-expert` for safety-critical surfaces,
`security-reviewer` for auth, tokens, personal or medical data, export/import.

## Parallel work

Other sessions share this checkout ([working-rules.md](docs/agents/working-rules.md#parallel-work)).

- Read the branch and dirty count each prompt opens with before touching shared tree state.
- **Claim the issue before you start**, clear it when you stop
  ([issue-tracker.md](docs/agents/issue-tracker.md)); read open PRs and `pnpm gates` first; a
  **stale** claim is a dead session: take the work.
- Worktree from the shell, never `EnterWorktree`; never bare `git stash`; never switch a live
  thread's model.
- Unique branch slug, early draft PR naming owned paths, schema changes and ADR ids
  (`YYYYMMDD-short-slug`); trial-merge the target before calling work complete.
- **A thread that steers never builds**: each layer goes to a fresh worker with a
  [spec](docs/agents/spec-template.md); past ~150k context, write a state note and retire.
- **Stack everything, across threads, one PR's CI at a time**: cut from the newest open branch,
  draft with `base` on it, pushed one layer at a time (**stacked-prs**).

## Hard rules

- **A background job you start is yours to end** (`node scripts/stray-processes.mjs --list`,
  never `TaskList`; never pipe a long run through `tail`/`head`).
- **Verify before commit, `pnpm verify:push` before push, push once per round** (**verify**);
  never report unverified work as done.
- **File only a bug, safety gap or decision** as a `needs-triage` issue, ten a run at most; the
  rest is one "Notes" PR comment.
- **A failing or flaky test is part of the work**, even when unrelated: never skipped, never a
  wider timeout; search open PRs for a fix in flight first.
- **A pushed PR is not done until its visual diffs are explained** (**visual-triage**) **and every
  review thread is fixed, declined with a reason, or filed**.
- **New runtime dependency → ADR; new domain concept → glossary; invalidated doc → fixed in the
  same PR.**
- **Safety-critical surfaces** (manifests, roll call, readiness, cert gating, medical, waivers,
  nitrox, erasure): boring code, adversarial tests, two differently framed `dive-domain-expert`
  runs; **security-sensitive changes**: a `security-reviewer` review; the PR body names both.
- **`app → features → lib/db`, one way; routes stay thin.**
- **Tests travel with behavior**: a bug fix starts with a failing regression test; every
  important flow gets an `e2e/` spec, every important surface a capture in `e2e/visual.spec.ts`.
- **Copy from a bundle; every sentence earns its place; deletes are soft and say "Delete"; a date
  names its zone, no hard-coded locale; time comes from the clock; a new page ships a
  `loading.tsx`.**
- **There is no legacy. Delete it** (H-49).
- **Text a human will copy is written unwrapped.**
- **A turn ends done, filed, or handed over**, or on a question; never on an intention.
- **Secrets never enter the repo.**

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
