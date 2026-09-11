# DiveDay — agent guide

Delight-first dive shop operations: **bookings, waivers, cert checks, trip prep, boat manifests**.
Competitors have the features; we win on experience. AI agents are the developers. This file,
`.claude/rules/`, `docs/`, scripts, and tests are the provider-neutral source of truth;
provider-specific folders are adapters and must not introduce unique requirements.

## Read first

1. This file — the rules every session needs whatever it touches.
2. The **path-scoped rules** in `.claude/rules/`: one file per area (`db`, `domain`, `surfaces`,
   `i18n`, `e2e`, `infra`, `docs`, `scripts`), each carrying the rules and the route map for the
   paths its `paths:` frontmatter names. Claude Code loads one the moment you read a matching file;
   any other provider reads the file whose paths it is about to touch. Nothing in them is optional.
3. Run `pnpm task:context <area>` when the task matches a supported area (run without an
   argument to list the areas).
4. [docs/README.md](docs/README.md), and only the documents relevant to the task.
5. The Next.js warning at the bottom before framework-touching work.

## Context economy

- Never read `pnpm-lock.yaml`, generated `drizzle/`, `.next/`, `playwright-report/`, or
  `test-results/` whole; Grep them for the one line a diagnosis needs. The session hooks refuse the
  whole-file form at both doors (`Read` and the shell).
- Locate symbols with Grep and read the narrow range. A whole-file `Read` returns up to 2,000
  lines, and `scripts/guard-read.mjs` refuses it for any file over 600 lines unless you pass an
  `offset` or `limit` — an explicit range is always allowed.
- Read `foo.test.ts` before `foo.ts` when asking what behavior is intended; tests are compressed
  specifications.
- Iterate with one focused test and quiet output. The whole suite belongs to CI; the shell guard
  refuses a bare `pnpm test` / `pnpm e2e` / `pnpm check`.
- Successful tooling should be quiet; inspect only the failed step or useful tail of a log —
  redirect a long run to a file and read the file, never pipe it through `tail`.
- Send a broad search or a verbose run to a subagent and keep only its conclusion; the `Explore`
  agent does not load this file at all.

## Commands

| Command | What |
| --- | --- |
| `pnpm dev` | dev server at localhost:3000, supervised by `scripts/dev-server.mjs`. Wait for its **`dev: serving … — warmed in Ns`**; Next's `✓ Ready` lands ~26s earlier and means only "listening". The supervisor restarts an OOM-bound `next dev` before the kernel does and says so. One dev server per *checkout*: the lock is `.next/dev/lock`, so `--port` does not buy a second (ADR 20260903-the-dev-server-is-supervised; the **run** skill) |
| `pnpm task:context <area>` | bounded paths, invariants, and validation for a task |
| `pnpm check:env` / `pnpm env:manual` | the two structural facts about configuration, and the one file a human edits — see `.claude/rules/infra.md` |
| `pnpm check:repo` | 46 static guards over the repository, spawned concurrently so one run reports every failure rather than the first. Each guard names itself and prints the offending line; the ones whose *why* is not obvious from that message are written up in [docs/agents/repo-checks.md](docs/agents/repo-checks.md) |
| `pnpm check:follow-ups` | every open `needs-triage` issue is still actionable cold. The one guard that calls `gh`, so the one that can report **SKIPPED** rather than pass or fail ([docs/agents/issue-tracker.md](docs/agents/issue-tracker.md)'s "Filing a follow-up") |
| `pnpm check` | repository safeguards + lint + typecheck + unit tests, concurrently and fail-slow (`scripts/check-all.mjs`) — **the bar, and CI is where you clear it**. Locally, run its four halves: `pnpm check:repo`, `pnpm lint`, `pnpm typecheck`, `pnpm test:changed` ([docs/agents/verifying.md](docs/agents/verifying.md)) |
| `pnpm check:context-budget` | the words every session loads before it reads any code — this file, `CLAUDE.md`, any unscoped `.claude/rules/*.md`, and every skill's and reviewer agent's `description:` line — ratcheted (`--write` banks a fall, `--absorb "<why>"` records a deliberate rise), plus a 240-word cap on any single line. The fix for red is never to compress the prose: move the long half into `docs/` or a path-scoped rule and leave a pointer |
| `pnpm check:copy` / `check:domain-strings` / `check:tokens` / `check:architecture` / `check:type-ramp` / `check:voice` / `check:timezone` / `check:intl-cache` / `check:clock` / `check:locale` / `check:e2e-hygiene` / `check:route-coverage` / `check:critical-text` | the individual guards, each also inside `check:repo`; the ratcheted ones share `--report <path>` / `--write` / `--absorb`. What each refuses is in the path-scoped rule for the files it reads and in [docs/agents/repo-checks.md](docs/agents/repo-checks.md) |
| session hooks (`.claude/settings.json`) | `scripts/session-context.mjs` (checkout state at start, one line per prompt, the reminders a compaction drops), `scripts/guard-bash.mjs` and `scripts/guard-read.mjs` (`PreToolUse` refusals that name the correct form), `scripts/format-touched.mjs` (Biome over the file just edited), `scripts/explain-failure.mjs` (a written answer attached to a known failure), and three `Stop` hooks — `scripts/stray-processes.mjs`, `scripts/unfinished-promises.mjs`, `scripts/unpushed-work.mjs`. All fail open. Each one's reasoning and escape hatch: [docs/agents/session-hooks.md](docs/agents/session-hooks.md) |
| `pnpm gates` | report (never a gate): ages of human decisions, every `in-progress` claim checked against `git` (**live** / **stale** / **unverifiable**), and every open `needs-triage` issue oldest first. Nothing it reports is an agent's to close ([docs/agents/issue-tracker.md](docs/agents/issue-tracker.md)) |
| `pnpm agent:health` | report (never a gate): what the agent environment costs and covers — always-loaded context by file, the path-scoped rules and what each costs when it loads, visual and axe coverage of routes, guards with no test beside them, and the hooks wired into the session lifecycle |
| `pnpm lint` / `pnpm lint:fix` | Biome check / autofix |
| `pnpm typecheck` | tsc |
| `pnpm test <file> --reporter=dot` | focused Vitest run with low-noise success output |
| `pnpm test:changed` | the tests your diff reaches through the import graph — the pre-push net that catches a coverage guard living in a file you never touched. A `src/db/schema.ts` edit widens it to the whole suite; name the three guards by path instead ([docs/agents/verifying.md](docs/agents/verifying.md)) |
| `pnpm e2e <spec> --reporter=line` | build, then run one Playwright spec — focused because the **whole** suite belongs to CI. What the per-test reset does and does not restore, and why a test that writes shop settings takes a `privateShop`: `.claude/rules/e2e.md` |
| `pnpm e2e:run <spec> --reporter=line` | fast-iteration path: build once with `pnpm e2e:build`, then reuse it |
| `pnpm build` | production build |
| `pnpm db:generate` | generate a Drizzle migration after editing `src/db/schema.ts` (the **schema-change** skill) |
| `pnpm db:reset` | clear the dev PGlite database; next `pnpm dev` re-migrates and re-seeds. **Refuses while a dev server is running**, naming the pid (ADR 20260903-one-process-per-pglite-directory) |
| `node scripts/screenshot.mjs <path…>` | look at a page against a running `pnpm dev` — light/dark × phone/desktop PNGs into `screenshots/`, with dev-credential sign-in for `/shop/**`. Review-grade captures still come from a filtered visual-spec run (the **verify** skill) |
| `pnpm visual` | capture the visual surfaces and compare them against the S3 baseline for this branch's parent commit (baselines are rendered on CI's Linux runners; triage from the CI report) |

Never put a literal `--` before args to a `pnpm` script (`pnpm test -- <file>`): pnpm forwards it,
`vitest`/`playwright` see their own `--` and silently drop every flag after it, and the full suite
runs. Pass args directly: `pnpm test <file> --reporter=dot`. The shell guard refuses the bare form.

## Route map (don't re-derive this)

The rows below say *where*; the path-scoped rule for that area says *how* and *why*, and loads
when you open the file.

| You need | Go to |
| --- | --- |
| Public pages (landing, sign-in) | `src/app/` |
| A shop's diver-facing pages (schedule, booking, courses) | `src/app/s/[shopSlug]/**` — no auth anywhere in it; paths from `src/lib/public-routes.ts`. `/shop/**` is staff, without exception |
| Where a diver can go on a shop's public pages | `src/components/PublicShopNav.tsx`, assembled in `src/app/s/[shopSlug]/layout.tsx` — never a per-page cross-link |
| Bearer-token pages (waiver signing, trip-prep "ready", recap, email verify, password reset, staff calendar feed) | `src/app/waivers/[token]`, `src/app/ready/[token]`, `src/app/recap/[token]`, `src/app/verify/[token]`, `src/app/reset-password/[token]`, `src/app/calendar/[token]` — the URL *is* the capability |
| Account lifecycle (sign-up welcome/verify, forgot/reset password) | `src/app/onboard/`, `src/app/forgot-password/`; tokens in `src/db/account-tokens.ts` / `src/lib/account-tokens.ts`; accounts in `src/db/user-accounts.ts` |
| Course pages (public content / staff roster + editor) | `src/app/s/[shopSlug]/courses/**` and `src/app/shop/[shopSlug]/courses/**`; content shapes in `src/lib/courses.ts`; templates in `src/db/course-templates.ts`; progression order in `src/db/courses.ts` |
| The staff schedule builder (add / move / copy / remove a departure) | `src/app/shop/[shopSlug]/schedule/board/_components/ScheduleBuilder.tsx` + `schedule/board/actions.ts`; mutations in `src/db/trips-schedule.ts`, reached through the `@/db/trips` barrel. The one place a trip is created |
| A repeating trip (every Saturday, Mon+Thu, daily) | `src/lib/recurrence.ts` (pure cadence math), `src/db/trips-series.ts` (materialization), nightly roll at `src/app/api/cron/trip-series/` |
| Staff surfaces (all `/shop/**`, auth-gated) | `src/app/shop/` |
| Where staff can go (nav tabs, the "More" menu/sheet, ⌘K "Go to") | one registry, `src/lib/staff-destinations.ts`; `src/components/ShopNavLinks.tsx`, `src/components/StaffTabBar.tsx` and `src/components/search/CommandPalette.tsx` derive from it |
| SMS delivery receipts | `src/lib/notifications/sms-events.ts` + `src/app/api/webhooks/sms/`; runbook [docs/engineering/sms-delivery-receipts-runbook.md](docs/engineering/sms-delivery-receipts-runbook.md) |
| Environment variables — adding one, or asking who supplies one | one registry, `config/env-registry.mjs`; everything else is generated from it (ADR 20260812-env-provenance-registry) |
| AWS credentials, and what deploying still leaves for a human | §16 and §17 of `infra/lib/infra-stack.ts`; [docs/engineering/infrastructure-runbook.md](docs/engineering/infrastructure-runbook.md). **Two stacks, one region knob**: mail is its own stack (`infra/lib/email-stack.ts`) and every region is `config/aws-regions.mjs` |
| Logs, metrics, alarms, dashboards, and how fast the app feels | `src/lib/log.ts`, `src/lib/observability/`, the one registry `infra/lib/observability.ts`; [docs/engineering/cloudwatch-observability-runbook.md](docs/engineering/cloudwatch-observability-runbook.md) |
| Email: sending and delivery outcomes | `src/lib/notifications/` + `src/app/api/webhooks/ses/`; [docs/engineering/ses-email-runbook.md](docs/engineering/ses-email-runbook.md) |
| The Today work queue, the day spine, the close-out | `src/lib/today.ts` / `src/db/today.ts`, `src/lib/closeout.ts` / `src/db/closeout.ts`; the spine in `_components/today/` |
| Buddy teams (who dives with whom, and the split-team alert) | `src/db/buddy-pairs.ts`, the alert in `src/lib/manifests.ts`, words in `src/i18n/buddy-labels.ts`, the builder on `src/app/shop/[shopSlug]/trips/[id]/manifest/` |
| How demanding a dive site is | `dive_sites.difficulty_level`, codes in `src/lib/dive-site-difficulty.ts`, words in `src/i18n/dive-site-labels.ts` |
| The four lines every staff page opens with (session, shop, tenant, permission) | `requireShopSurface` in `src/lib/session.ts`; every refusal *throws* |
| Telling a staffer what just happened (the `?notice=` redirect) | `src/lib/staff-notices.ts` — `noticeUrl`, `noticeFromParam`, `shopPath`; never hand-build the string |
| Readiness words and tone ("Blocked" / "Ready", everywhere) | `src/i18n/readiness-labels.ts` |
| DB schema (source of truth — never read `drizzle/`) | `src/db/schema.ts`, by Grep and range |
| DB client / test db factory | `src/db/client.ts` (`getDb()`, `createTestDb()`) |
| Queries and seed data | `src/db/shops.ts`; barrels `src/db/trips.ts` and `src/db/seed.ts` — import from the barrel, edit the sibling; demo data is a new `src/db/seed-<scenario>.ts` |
| Retention / pruning of append-only tables | `src/lib/retention.ts` (`RETENTION_DAYS`), `src/db/retention.ts`, `src/app/api/cron/retention/` |
| Whether a diver may *buy* a seat vs. *board* | two gates: `src/lib/trip-admission.ts` (booking-time, weaker) and `src/lib/readiness.ts` (boarding-time); admission may never refuse someone readiness would clear |
| The booking transaction (capacity enforcement) | `src/db/bookings.ts` — read its tests first |
| The gear register (the shop's own fleet, service clocks, reservations) | `src/lib/gear.ts`, `src/db/gear.ts`, `src/i18n/gear-labels.ts`, `src/app/shop/[shopSlug]/gear`; `pnpm task:context gear` |
| Staff seating a diver (Guests tab, walk-in counter, diver record, global Add-booking) | one consequence path: `src/db/seat-diver.ts`, driven by `src/app/actions/seat-diver.ts`; the global door is `src/app/shop/[shopSlug]/bookings/new` |
| Payments, orders, discount codes (Stripe Connect) | `src/lib/payments/`; state in `src/db/orders.ts`, `payments.ts`, `checkouts.ts`, `refunds.ts`, `stripe-accounts.ts`; codes in `src/lib/promo-codes.ts` + `src/db/shop-promos.ts`, deals in `src/db/trip-promos.ts` |
| The back-office queues (unconfirmed Stripe calls, deletions that never finished) | with the object each is about — the Orders index and Settings' "Data & integrations" group — never on Reports |
| A diver asking for a day that is not on the board | `src/components/DateRequestForm.tsx`, `src/app/actions/inquiry.ts`, `src/db/course-inquiries.ts`, `src/lib/date-requests.ts`, staff at `src/app/shop/[shopSlug]/requests` |
| Diver reviews and ratings | `src/lib/reviews.ts` + `src/db/reviews.ts`; written from `/recap/[token]`, moderated at `shop/[shopSlug]/reviews` |
| Copy and languages | `src/i18n/` — `locales/<locale>/diver.json`, `locales/<locale>/staff/<namespace>.json`, composed by `staff-messages.ts`; resolution order and the switcher in `.claude/rules/i18n.md`; Spanish: `src/i18n/locales/es-ES/README.md` first |
| SEO structured data, `og:site_name`, link-preview cards | `src/lib/structured-data.ts` + `src/components/JsonLd.tsx`; `openGraphSite` in `src/lib/site-metadata.ts`; `allowSvgRasterization()` in `src/lib/og-rasterizer.ts` before every `ImageResponse` |
| Notifications (email/SMS/WhatsApp) | `src/lib/notifications/`; `courtesy.ts` picks the channel; state in `src/db/notifications.ts`; a shop's own WhatsApp sender in `whatsapp-signup.ts` + `src/app/shop/[shopSlug]/settings/whatsapp/` |
| Data portability (CSV export/import), scheduled backups | `src/db/export.ts` / `src/db/import.ts`, `src/features/backup-export/`; staff UI under `src/app/shop/[shopSlug]/settings/` — security-sensitive, see hard rules |
| Offline boat manifests | `src/lib/offline-manifests.ts` + `offline-manifest-store.ts`; viewer `src/app/offline-manifest/`; worker `src/worker/manifest-sw.ts` |
| A dive site's briefing — what a diver reads, and which field writes it | `dive-sites/_components/SiteFields.tsx` writes it, `_components/TripDayPlan.tsx` reads it; the field guide is `src/lib/dive-site-field-guide.ts` + `src/i18n/marine-life-labels.ts` |
| Starting content a shop copies, and species it picks | `src/db/dive-site-templates.ts`, `src/db/course-templates.ts` (copied, then the shop's); `src/db/marine-life-catalog.ts` (DiveDay's words, photos under `public/marine-life/`, added with `node scripts/fetch-marine-life-photo.mjs`) |
| Domain logic (framework-free) | `src/lib/` — capacity in `trips.ts`, dates in `format.ts` |
| Feature modules | `src/features/<feature>/` — `index.ts` is the whole public surface; `calendar-sync`, `backup-export`, `integrations` |
| Outbound integrations a shop connects for itself (Shopify, QuickBooks, Xero, Zapier) | `src/features/integrations/`; rows in `src/db/integrations.ts` + `src/db/integration-events.ts`; staff at `src/app/shop/[shopSlug]/settings/integrations`; callbacks under `src/app/api/integrations/` |
| Staff calendar subscriptions (iCalendar feeds) | `src/features/calendar-sync/` + `src/app/calendar/[token]/route.ts`; staff UI at `src/app/shop/[shopSlug]/settings/calendar/` |
| Auth: session, gates, edge check | `src/lib/auth.ts` / `auth-secret.ts` / `authz.ts` + `session.ts`; edge layer `src/proxy.ts` |
| Dev/e2e staff logins | `src/db/dev-credentials.ts` |
| Design tokens; form/button/control/panel wrappers | `src/app/globals.css` (semantic only); `src/components/ui/` — `form.tsx`, `button.ts`, `card.tsx` (`SectionCard`), `tone.ts`, `typography.ts` |
| Paging a staff list | `src/components/Pager.tsx` + `offsetPage` in `src/db/paging.ts`; keyset cursors in `src/db/cursor.ts` are the one exception |
| Why a route paints instantly (or doesn't) | its `loading.tsx` and `export const instant = true` (ADR 20260804-instant-navigation; the **instant-navigation** skill) |
| "What should this code do?" | Read `foo.test.ts` before `foo.ts` — tests are the contract |
| A design for a surface that does not exist yet | [docs/design/design-artifacts.md](docs/design/design-artifacts.md) first; canvases in `docs/design/canvases/` |
| An idea, question, risk, or cleanup you are **not** doing in this change | a GitHub issue labelled `needs-triage` ([docs/agents/issue-tracker.md](docs/agents/issue-tracker.md)'s "Filing a follow-up"), `waiting-on-external` when nobody here can move it. Committed work lives in `docs/product/features/`, human-owned calls in `docs/product/human-decisions.md` |

## Skills and providers

The canonical process is this file, `.claude/rules/`, `docs/`, scripts, and tests. Claude-specific
playbooks are indexed in [.claude/skills/README.md](.claude/skills/README.md): **new-feature**,
**verify**, **design-implementation**, **i18n-copy**, **copy-restraint**, **design-review**,
**brand-voice**, **schema-change**, **debug**, **instant-navigation**, **e2e-and-visual**,
**visual-triage**, **adr**, **stacked-prs**, **triage**, **backlog-routine**, **marketing-page**,
**switching-pages**, **run**, and **commercial-outreach**. Other providers should read the
corresponding `SKILL.md` directly when useful. If a skill conflicts with canonical docs, tests, or
code, the skill is stale and must be fixed in the same change. Reviewer agents (`.claude/agents/`)
are launched, never skipped: `dive-domain-expert` for safety-critical surfaces, `security-reviewer`
for anything touching auth, tokens, personal or medical data, or export/import.

## Parallel work

- Assume multiple work scopes can be in flight in this working directory at once — other sessions
  may have uncommitted changes, staged work, or a mid-rebase state. Every prompt opens with the
  branch and the count of uncommitted paths (a hook prints it); read it before anything that
  touches shared working-tree state. The shell guard refuses a wholesale discard (`git reset
  --hard`, `git checkout .`, `git clean -f`) while the tree is dirty.
- **Claim the issue before you start.** Add the `in-progress` label and post a `## Claim` comment
  naming your branch, worktree, start time, and owned paths — see
  [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md)'s "Claiming an issue". A draft PR
  starts too late: a session that has begun and not yet pushed has no footprint at all. Clear the
  label when you finish or stop.
- Before starting non-trivial work, read the open PRs **and** `pnpm gates`' "Claimed — in flight"
  section. Overlap with your plan → pick a different slice or coordinate in that thread. A claim
  reported **stale** is a dead session, not a reservation — take the work and clear the claim.
- Never bare `git stash` / `git stash pop` — one stack shared with every worktree and every session
  (the shell guard refuses both). Prefer a `git worktree`, then a WIP commit, then
  `git stash push -u -m "<tag>"` restored by sha and popped immediately after.
- Use a unique branch slug and open a draft PR early for non-trivial concurrent work; state owned
  paths, expected schema changes, and planned ADR ids in its description. New ADRs use
  collision-resistant `YYYYMMDD-short-slug` ids; do not allocate the next integer. No branch-local
  reservation ledgers. Split work by vertical slice or non-overlapping paths, and trial-merge the
  target branch before calling work complete.
- **Stack by default: cut every branch from the branch you opened last, not from `main`, whenever
  that one is still open** — related or unrelated, a schema migration or a padding change. A
  dependent chain (`src/db/schema.ts` + migration → the `src/db` reader → the surface) has no other
  honest shape; unrelated work stacks because a second branch cut from `main` re-edits the same
  shared files (a `check:repo` row, a baseline, a message bundle), and on a stack those merge once,
  while the change is being written. Pixels are not an exception. Cut each branch from the one
  below, open each PR as a **draft at its first commit** with `base` set to that branch, bottom one
  first, every body naming its position; `.github/workflows/stack.yml` registers the chain. Only the
  bottom and top layers run the expensive gate, so read a middle layer's green as "nothing ran".
  What still goes on its own branch off `main` (nothing of yours open, a fix that must merge now, a
  stack about six deep, another session's branch) and the mechanics are in the **stacked-prs**
  skill and ADRs 20260821-stacked-pull-requests, 20260827-stack-ci-skips-the-middle-layers and
  20260907-a-runner-registers-the-stack.
- Before fixing a failing or flaky test, search open PRs for one that already touches the same spec
  or test name; coordinate in that thread instead of pushing a competing fix.

## Hard rules

- **A background job you start is yours to end, and `TaskList` is not how you check.** On
  2026-08-15 a wait-loop ran for **nine hours** here while `TaskList` reported "No tasks found".
  `node scripts/stray-processes.mjs --list` reads the process table, which is the only honest
  answer; the `Stop` hook runs it for you. Never pipe a long-running command through `tail`/`head`
  (neither can flush — the shell guard refuses it); never write a wait whose only exit is a success
  marker; when you kill a producer, stop its watcher in the same breath. A CI watch built on `curl`
  against `api.github.com` is the same failure wearing a different hat — repo-scoped REST is
  refused here, and an empty response reads as green
  ([docs/agents/verifying.md](docs/agents/verifying.md)).
- **Verify before commit, and let CI run anything whole.** Targeted checks are yours — the one
  guard you touched, `pnpm test <file>`, `pnpm typecheck`, `pnpm lint`, one focused
  `pnpm e2e <spec>`, and **before you push** `pnpm test:changed`, the only one that reaches a
  coverage guard living in a file you did not edit. The **whole** unit suite, `next build`, the
  whole e2e suite and the visual run go to CI: push and read the result. Open the PR before it is
  green when that is the fastest way to learn what is broken, say in the body what you ran and what
  you did not, and work what comes back — a red PR you are driving is fine, a red PR you have
  stopped driving is not. Never report unverified work as done, and *look at* UI you changed
  (screenshots, light + dark), which is the one thing CI cannot answer
  ([docs/agents/verifying.md](docs/agents/verifying.md)).
- **A thought you don't act on goes in the tracker, not in your closing message.** An idea left
  undone, a question only a human can answer, a risk noticed in passing, a cleanup deliberately
  scoped out: a GitHub issue labelled `needs-triage`
  ([docs/agents/issue-tracker.md](docs/agents/issue-tracker.md)'s "Filing a follow-up"), its number
  in the PR description, written for a reader with none of your context and ending in a prompt they
  can paste into a fresh session. This never replaces doing the work you were asked to do, a failing
  test is never a follow-up, and someone else's entry is never a drive-by.
- **A failing or flaky test is part of the work, even when unrelated to your change.** Fix it
  before calling the work done — never skip it, widen a timeout to paper over a flake, or leave it
  red for someone else. Check **Parallel work** first for an in-flight fix on the same test.
- **A pushed PR is not done until visual diffs are accounted for.** Review every diff image for
  what the code explains; never wave a mismatch through. Baselines live in S3 keyed by git commit
  (ADR 20260729-reg-suit-visual-regression), so "approving" an intentional change means saying in
  the PR *why* the pixels moved and merging. See the **visual-triage** skill.
- **A pushed PR is not done until its review threads are answered.** Every PR is reviewed within
  minutes by `sourcery-ai` and `github-advanced-security`, and by Aaron when he gets to it. Read
  the threads before you call the work done and again whenever you return to a branch. Every open
  thread ends in one of three states, never silence: **fixed** (push, reply naming the commit),
  **declined** (the reason in the thread — a nitpick that contradicts a written rule is declined by
  naming the rule), or **filed** (a `needs-triage` issue whose number goes in the thread). Reply on
  the thread, resolve only what you acted on, and leave a question open. In the cloud containers
  `gh` is absent: use the GitHub MCP's `pull_request_read` (method `get_review_comments`, which
  reports `is_resolved`), `add_reply_to_pull_request_comment` and `resolve_review_thread`; the
  `gh` forms are in [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md). **No comments does
  not mean reviewed clean** — `coderabbitai` reviews nothing here — and a bot's comment is never
  automatically right: these tools do not know this repository's rules.
- **New runtime dependency → ADR.** New domain concept → glossary. Invalidated doc → fix in the
  same PR.
- **Safety-critical surfaces** (manifests, roll call, cert gating, medical flags) get boring code,
  failure-path and adversarial tests, and a `dive-domain-expert` review.
- **Security-sensitive changes** (auth/authz, token flows, rows holding personal or medical data,
  export/import) get a `security-reviewer` review before merge.
- **Layout**: domain logic in `src/lib/` or a feature module; routes in `src/app/` stay thin; e2e
  specs live in `e2e/`. The dependency direction is one way — `app → features → lib/db` — and
  `pnpm check:architecture` enforces it.
- **Tests travel with behavior.** New features include happy-path and important failure-path
  tests; bug fixes begin with a failing regression test. Every important **flow** a user runs gets
  an `e2e/` spec, and every important **surface** they look at gets a capture in
  `e2e/visual.spec.ts` (the **e2e-and-visual** skill; if unsure whether something qualifies, it
  does).
- **Copy comes from a message bundle, never a component; every sentence earns its place, or it is
  deleted; every delete is soft and the word on screen is still "Delete"; a rendered date names its
  zone and never a hard-coded locale; time is read through the clock; a new page ships with a
  `loading.tsx`.** Each of these is stated in full, with its incident and its guard, in the
  path-scoped rule for the files it governs — `.claude/rules/surfaces.md`, `i18n.md`, `db.md`,
  `domain.md` — and `pnpm check:repo` enforces the mechanical half of every one.
- **There is no legacy. Delete it.** DiveDay is pre-pilot (H-49): a table nothing writes is
  dropped, a code path that only tolerates old rows is deleted, and no reconciliation, backfill,
  dual-read or version-tolerance code is written for pre-pilot data. The two things this does not
  relax — the destructive-migration guard and H-02's retention and erasure promises — and the rule's
  expiry are in `.claude/rules/db.md`.
- **Text a human will copy is written unwrapped** — one line per paragraph and per bullet, in a
  document and in a chat reply alike; the worked examples are in `.claude/rules/docs.md`.
- **A queue in a closing message is not a queue.** Ending a turn with "next I'll drop the retired
  table" starts nothing: the message is sent, the turn ends, and the next turn has only what is
  written down. A turn ends in exactly one of three states: the thing is **done**, it is **filed**
  as a `needs-triage` issue, or it is **handed over** in as many words. A turn that ends on a
  question is a fine ending; one that ends on an intention is not. More than one item in flight
  goes in the task list (`TaskCreate`/`TaskUpdate`), never in prose. Two `Stop` hooks hold this
  line — `scripts/unfinished-promises.mjs` blocks a promise on a dirty tree, and in a cloud
  container `scripts/unpushed-work.mjs` blocks a plain ending with commits on no remote branch,
  since the container is reclaimed and the commits go with it.
- **Secrets never enter the repo** — `.env*` is gitignored, and `.claude/settings.json` denies the
  generated env files, `.pglite/`, and key material to the file tools.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
