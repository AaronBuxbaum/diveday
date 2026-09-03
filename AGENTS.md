# DiveDay — agent guide

Delight-first dive shop operations: **bookings, waivers, cert checks, trip prep, boat manifests**.
Competitors have the features; we win on experience. AI agents are the developers. This file,
`docs/`, scripts, and tests are the provider-neutral source of truth; provider-specific folders are
adapters and must not introduce unique requirements.

## Read first

1. This file.
2. Run `pnpm task:context <area>` when the task matches a supported area (run without an
   argument to list the areas).
3. Read [docs/README.md](docs/README.md) and only the documents relevant to the task.
4. Read the Next.js warning at the bottom before framework-touching work.

## Context economy

- Do not read `pnpm-lock.yaml`, generated `drizzle/`, `.next/`, `playwright-report/`, or
  `test-results/` unless diagnosing a specific failure in that artifact.
- Locate symbols with search and read the narrow surrounding range instead of opening large files.
- Read `foo.test.ts` before `foo.ts` when asking what behavior is intended; tests are compressed
  specifications.
- Iterate with one focused test and quiet output. Run the full pre-commit gate once.
- Successful tooling should be quiet; inspect only the failed step or useful tail of a log.

## Commands

| Command | What |
| --- | --- |
| `pnpm dev` | dev server at localhost:3000, supervised by `scripts/dev-server.mjs`. Wait for its **`dev: serving … — warmed in Ns`**; Next's `✓ Ready in 400ms` lands ~26s earlier and means only "listening", which is why a session that trusts it watches its first request hang and starts killing things. `next dev` here grows without a ceiling and is OOM-killed leaving **no** log line, so the supervisor restarts it before the kernel does and says so — expected, costs the request in flight, next compile is warm. One dev server per *checkout*: the lock is `.next/dev/lock`, so `--port` does not buy a second (ADR 20260903-the-dev-server-is-supervised) |
| `pnpm task:context <area>` | bounded paths, invariants, and validation for a task |
| `pnpm check:env` | the two structural facts about configuration: `.env.example` still matches `config/env-registry.mjs` (it is generated, and the CDK stack reads it at synth to build the credentials secret), and `.env.manual` speaks only for values a human is the source of. Then reports which manual values are unset and what each one switches off — a report, never a failure, since every one is legitimately absent |
| `pnpm env:manual` | create or refresh `.env.manual`, the one configuration file a human edits. Never overwrites a value; on first run it lifts the manual values out of a pre-split `.env.local` |
| `pnpm check:repo` | 42 static guards over the repository, spawned concurrently so one run reports every failure rather than the first — architecture and feature-module boundaries, design tokens and tinted ink, hard-coded copy and locale coverage, clock/timezone/Intl discipline, migration safety, route and loading-skeleton coverage, and the agent layer itself. Each guard names itself and prints the offending line, so a red run needs no preamble; the twenty whose *why* is not obvious from that message are written up in [docs/agents/repo-checks.md](docs/agents/repo-checks.md) |
| `pnpm check:follow-ups` | every open GitHub issue labelled `needs-triage` — where you leave an idea, question, risk, or deliberately-skipped cleanup for the human to triage — is still actionable cold: real prose in the four sections, `Touches:` paths that exist, and a fenced prompt long enough and specific enough to hand a session with none of your context, ending in an instruction to close the issue. Closing an entry means closing the issue, never marking it done in a comment. The one check in `pnpm check:repo` that calls `gh` over the network, and so the one that can report **SKIPPED** rather than pass or fail — a commit is never blocked on GitHub's availability, and a guard that did not run never says `ok` ([docs/agents/repo-checks.md](docs/agents/repo-checks.md)). Two further labels, `waiting-on-external` and `parked`, mark the entries that are not plain inbox items and each demands its own line; both are specified in [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md)'s "Filing a follow-up" section (ADR 20260821-follow-ups-are-github-issues, superseding 20260808-agent-follow-up-register) |
| `pnpm check:type-ramp` | the heading ramp stays closed (ADR 20260827-clearwater-surface-language decision 3): no bare `text-{lg…4xl}` beside a `font-{semibold,bold}` under `src/app`/`src/components`, in either order — headings take a named level from `src/components/ui/typography.ts`. Ratcheted like `check:copy`, and inside `pnpm check:repo`. What the fourteen coexisting spellings turned out to be, and why the guard covers surfaces the ADR excludes: [docs/agents/repo-checks.md](docs/agents/repo-checks.md) |
| `pnpm check:voice` | no message bundle reads as machine-written: a prose em-dash, an intensifier (*actually*, *genuinely*, *simply*), a "Here's how" lead-in, a "not just X" contrast or a "No X. No Y." run fails it, per locale. The full list, the reasoning and the before/after table are in [docs/design/brand.md](docs/design/brand.md)'s "What gives us away"; ratcheted like `check:copy`, and inside `pnpm check:repo` |
| `pnpm check:intl-cache` | every `Intl` formatter is built through `src/lib/intl-cache.ts`, never a bare `new Intl.*` at the call site. Constructing one costs ~12x reusing it (measured) and this app formats on essentially every render, so the constructor is a per-render tax that shows up as CI e2e flake under load. Regressed twice before it was checked — most recently as an `Intl.PluralRules` per interpolated message. `Intl.Locale` is exempt: a parsed locale value, not a compiled formatter |
| `pnpm check:e2e-hygiene` | no timing guesses in `e2e/`: `waitForTimeout` sleeps, `networkidle` waits, spec-level `retries:`, and hand-rolled retry loops are refused unless the line carries `diveday:allow-e2e-hygiene <rule>: <why>` naming the mechanism that makes it deterministic. The suite runs `retries: 0` so a flake fails loudly and gets root-caused; every one of these shapes converts a deterministic failure into an intermittent pass instead — the exact class a 2026-08-06 review stripped back out of the tree after their written justifications proved false. The fix for a race is always waiting for what the destination page itself renders (see the **debug** skill) |
| `pnpm check` | repository safeguards + lint + typecheck + unit tests — **the bar, and CI is where you clear it**. The four phases run **concurrently and fail slow** (`scripts/check-all.mjs`): one run tells you about every failure rather than the first, so a change that broke lint and typecheck and a test costs one round trip instead of three, and the twenty seconds of static work disappear under the unit suite. That last phase is why this is a **push-and-read-CI** command rather than a local one ([docs/agents/verifying.md](docs/agents/verifying.md)) |
| `pnpm check:context-budget` | the words every session loads before it reads any code — AGENTS.md and CLAUDE.md in full, plus every skill's and reviewer agent's `description:` line. A ratchet like `check:copy`'s (`--write` banks a fall, `--absorb "<why>"` records a deliberate rise), plus a 240-word cap on any single line: the `check:repo` row reached 2,553 words on one line before it moved to [docs/agents/repo-checks.md](docs/agents/repo-checks.md), and a whole-file count cannot tell a table that grew a row from a cell that grew a history. The fix for a red cap is never to compress the prose — it is to move the long half into `docs/` and leave a link |
| `pnpm check:critical-text` | targeted critical-text guard for the staffed orders, tab-bar, and public schedule surfaces; it also runs inside `pnpm check:repo` |
| `pnpm check:copy` | find hard-coded user-facing copy in `src/app`/`src/components`; `node scripts/check-copy.mjs --report <path>` lists it, `--write` banks a reduction, `--absorb` records growth arriving from a merge |
| `pnpm check:domain-strings` | find English sentences returned from `src/lib`/`src/db` (the `.message`/`_LABELS` leak — ADR 20260731-domain-layer-copy-leaks); same `--report <path>` / `--write` / `--absorb` as `check:copy` |
| `pnpm check:tokens` | find raw hex colors and palette-scale Tailwind classes in components (ADR-0004); ratcheted via `scripts/tokens-baseline.json`, same `--report <path>` / `--write` / `--absorb` as `check:copy`. Next metadata-file conventions (OG images, icons, manifest) are exempt by design — tokens can't reach a Satori bitmap |
| `pnpm check:architecture` | layer boundaries (now including `src/components`/`src/i18n`) and feature-module contracts; pre-existing debt is ratcheted in `scripts/architecture-baseline.json`, same `--write` / `--absorb` as `check:copy` |
| `pnpm check:timezone` | every `Intl.DateTimeFormat`/`toLocale*String` under `src/app`, `src/components`, `src/lib`, `src/db`, `src/features` names a `timeZone`. Omitting it renders in the **host** zone — UTC on every server and CI box — so a 7:30 AM departure silently reads 11:30 AM and no test on a UTC machine can tell. The `src/lib/format.ts` formatters take `timeZone` as a **required** parameter, so calls through them are already proven by `pnpm typecheck`; this covers code reaching for `Intl` directly. A deliberate `timeZone: "UTC"` passes — the rule is *name* a zone, not name the shop's, because a date-only value or a wall-clock time of day genuinely has no instant in it |
| `pnpm check:route-coverage` | every `src/app/**/page.tsx` route is listed in `scripts/route-coverage.json` with the `e2e/` specs and `e2e/visual.spec.ts` captures that cover it, or a written `exempt` reason for having neither. The coverage lists are hand-maintained (a spec usually *clicks* its way to a route, which no grep can see); `--write` regenerates only the mechanical facts and refuses to add an exemption or drop coverage, `--absorb` records a merge-in loss, `--report` prints the per-route table |
| `node scripts/stray-processes.mjs` | report (never a gate, never in `check`) — background shells a Claude session spawned that are still alive after 10 minutes, plus dev/test processes reparented to init that nobody will ever reap. Wired in `.claude/settings.json` at three points: **`Stop`** and **`SubagentStop`** report, handing what they find back to the agent that has to act on it, and **`SessionEnd`** runs `--kill`, because a session ending is the one moment nobody is left to warn. `--kill` only ever reaps this session's own shells plus orphans, never a sibling session's live work; `--list` reports without the non-zero exit. It exists because a wait-loop ran for **nine hours** on 2026-08-15: a `pnpm test` piped through `tail` (which cannot flush, so its output file stayed empty) was backgrounded, a second task waited on that file for a success marker with no timeout and no failure branch, and the producer was then killed — leaving a condition that could never be satisfied. The rule against exactly that loop was already written and was followed anyway, and **`TaskList` reported "No tasks found" while the shell was alive**, so the process table is the only honest check |
| `node scripts/unfinished-promises.mjs` | the sibling of the row above, for work never *begun* rather than left running. A `Stop` hook: it reads the turn's closing message off the transcript and blocks the stop when that message promises a next action ("next I'll", "once that lands") **and** the working tree is dirty — the pair that means a turn stopped mid-change with its queue living only in a sentence that has already been sent. It stays quiet for a closing question, for a handoff ("say the word"), and for a promise on a clean tree, which is the ordinary "finished and pushed, here is what happens next". It honours `stop_hook_active` so it cannot loop a session against itself, and it fails open on any parse or git error, because a hook that blocks a turn because it broke is worse than the thing it prevents. Written after a session ended three turns running on "now the queued work: ..." and the user, seeing nothing happen, had to ask whether it was still working |
| `scripts/guard-bash.mjs` / `scripts/format-touched.mjs` | the two hooks that make a rule mechanical instead of remembered. The first is a `PreToolUse` guard on `Bash` refusing three shapes this repo has been burned by — `pnpm <script> -- <args>` (pnpm forwards that `--`, so the flags are silently dropped and the full suite runs), bare `git stash`/`git stash pop` (one stack shared with every worktree and every session), and a long-running command piped through `tail`/`head` (neither can flush, which is where the nine-hour wait-loop started) — each refusal naming the correct form. The second is a `PostToolUse` pass that runs Biome over the one file an `Edit`/`Write` just touched, applies its safe fixes, and hands back what is left, so an unused import arrives with the edit that caused it rather than at the gate minutes later. Both **fail open** on anything they do not understand. Hooks load at session start, so a change to either needs a restart to take effect |
| `pnpm gates` | report (never a gate, never in `check`): days since each `docs/product/human-decisions.md` H-/V- row last moved, reconciled against `rollout.md`'s "next 30 days". Ages derived from dated outcomes in the rows and `git blame`, printed as `≥ N` when a shallow clone can only bound them. It also reports every issue labelled `in-progress` with its claim checked against `git` — **live** (worktree present, or branch advanced since the claim), **stale** (neither, so the session is gone and the label is lying), or **unverifiable** — which is what makes a claim safe to trust; see [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md)'s "Claiming an issue". It also ages every open `needs-triage` follow-up issue — id, status, kind, effort, days since GitHub's own `createdAt`, oldest first — since that inbox rots the same way and `pnpm check:follow-ups` only counts it. Issues also carrying `waiting-on-external` are aged separately and deliberately: "waiting on upstream" is an honest answer only for as long as somebody is still checking, and the age is the only thing that says otherwise. Like the check, this section fails open (prints a note, ages nothing) when `gh` can't answer. Nothing it reports is an agent's to close |
| `pnpm agent:health` | report (never a gate, never in `check`): what the agent environment currently costs and covers — the always-loaded context broken down by file against its budget, the share of routes carrying a visual capture and the share carrying an axe scan, which guards have no test pinning their judgement, and which hooks are wired into the session lifecycle. The a11y share is the number nothing else states, and it is read from `scripts/route-coverage.json` rather than asserted |
| `pnpm lint` / `pnpm lint:fix` | Biome check / autofix |
| `pnpm typecheck` | tsc |
| `pnpm test <file> --reporter=dot` | focused Vitest run with low-noise success output |
| `pnpm test:changed` | run only the tests affected by your diff against `origin/main` — a mid-iteration check across a handful of touched files; still run full `pnpm check` before commit. Selection follows the import graph, and migrations are read off disk rather than imported, so a change under `drizzle/` deliberately reruns the whole suite (`forceRerunTriggers` in `vitest.config.ts`) |
| `pnpm e2e <spec> --reporter=line` | use local Chromium, build, then run a focused Playwright suite — focused because the **whole** suite belongs to CI. Every worker owns a server and a database, and `/api/test/reset` restores the shared `blue-mantis` fixture's **schedule** before each test — but not the shop's **configuration**, so **a test that writes shop-wide settings takes a shop of its own** (the lazy `privateShop` fixture in `e2e/fixtures.ts`; ADR 20260815-per-test-private-shops). Never a `finally` that puts the setting back: nothing enforces it and it does not survive the failure it is there for. The `RESET_KEEPS` list, the port derivation and the run this rule was written after: [docs/agents/verifying.md](docs/agents/verifying.md) |
| `pnpm e2e:run <spec> --reporter=line` | fast-iteration path: build once with `pnpm e2e:build`, then `pnpm e2e:run <spec> --reporter=line` reuses that build and skips the rebuild |
| `pnpm build` | production build |
| `pnpm db:generate` | generate a Drizzle migration after editing `src/db/schema.ts` (see the **schema-change** skill) |
| `pnpm db:reset` | clear the dev PGlite database; next `pnpm dev` re-migrates and re-seeds. **Refuses while a dev server is running**, naming the pid. PGlite takes no lock on its data directory — two openers fork it silently and the last to close overwrites the other — so `src/db/data-dir-lock.ts` takes one from outside it, and a second opener (a `pnpm build` beside `pnpm dev`) is now a refusal naming the process to stop rather than lost writes. A lock left by a killed server is swept up, not obeyed (ADR 20260903-one-process-per-pglite-directory) |
| `node scripts/screenshot.mjs <path…>` | look at a page against a running `pnpm dev` server — light/dark × phone/desktop PNGs into `screenshots/` (gitignored), with automatic dev-credential sign-in for `/shop/**`. The kept tool that replaces the throwaway `.shots*.mjs` drivers that sessions used to hand-write; review-grade captures still come from a filtered visual-spec run (see the **verify** skill) |
| `pnpm visual` | capture the visual surfaces and compare them against the S3 baseline for this branch's parent commit (baselines are rendered on CI's Linux runners — on macOS nearly everything reads as changed; triage from the CI report) |

Never put a literal `--` before args to a `pnpm` script (`pnpm test -- <file>`). Unlike npm, pnpm
forwards that `--` into the underlying command instead of consuming it, so `vitest`/`playwright`
see their own `--` and silently drop everything after it — the shard/filter/reporter flags are
ignored and the full suite runs instead. Pass args directly: `pnpm test <file> --reporter=dot`.

## Route map (don't re-derive this)

| You need | Go to |
| --- | --- |
| Public pages (landing, sign-in) | `src/app/` |
| A shop's diver-facing pages (schedule, booking, courses) | `src/app/s/[shopSlug]/**` — its own namespace, no auth anywhere in it: `/s/<slug>` is the schedule, `/s/<slug>/trips/<id>` the booking page, `/s/<slug>/courses/**` the catalog. Path strings come from `src/lib/public-routes.ts`, which also holds the 308s from the old `/shop/**` URLs (ADR 20260803-public-shop-namespace). `/shop/**` is staff, without exception |
| Where a diver can go on a shop's public pages | the header nav in `src/components/PublicShopNav.tsx`, assembled once in `src/app/s/[shopSlug]/layout.tsx` (Schedule, plus Courses when `hasActiveCourses`) and rendered by `src/components/PublicShopChrome.tsx`. Add a public destination there, never as a per-page cross-link; the whole header is dropped in `?embed=1` |
| Bearer-token pages (waiver signing, trip-prep "ready", recap, email verify, password reset, staff calendar feed) | `src/app/waivers/[token]`, `src/app/ready/[token]`, `src/app/recap/[token]`, `src/app/verify/[token]`, `src/app/reset-password/[token]`, `src/app/calendar/[token]` — the URL *is* the capability; see [docs/engineering/capability-telemetry-runbook.md](docs/engineering/capability-telemetry-runbook.md) before touching |
| Account lifecycle (sign-up welcome/verify, forgot/reset password) | `src/app/onboard/`, `src/app/forgot-password/`, `src/app/verify/[token]`, `src/app/reset-password/[token]`; tokens in `src/db/account-tokens.ts` / `src/lib/account-tokens.ts`; account rows in `src/db/user-accounts.ts` |
| Course pages (public content / staff roster + editor) | diver-facing `src/app/s/[shopSlug]/courses/**`; staff roster and editor `src/app/shop/[shopSlug]/courses/**`; content shapes and parsers in `src/lib/courses.ts`; DiveDay-published templates in `src/db/course-templates.ts`. The roster reads in **progression order** — `progressionOrder` in `src/db/courses.ts`, shared by `listCourses`/`listActiveCourses`/`pagedCourses` — never alphabetically, and the shop-built certification paths it replaced are gone (ADR 20260805-remove-certification-paths). A depth in that prose is a **marker**, not words: `{depth18}` reads "18 meters" or "60 feet" by the shop's `depth_unit`, resolved once per page by `resolveCourseContentDepths` (`src/lib/courses.ts`) as a lookup into the agency pairs rather than a conversion. A shop may delete a marker and write its own words; a *broken* one is refused when the editor saves (`courseDepthPlaceholderIssues`), never left to render its braces to a diver — shop prose deliberately never touches ICU, whose swallowed errors would take the paragraph with them (ADR 20260814-course-depth-markers) |
| The staff schedule builder (add / move / copy / remove a departure) | `src/app/shop/[shopSlug]/schedule/board/_components/ScheduleBuilder.tsx` + `schedule/board/actions.ts`; the mutations and their refusals live in `src/db/trips-schedule.ts` (`moveTrip`, `duplicateTrip`, `deleteTrip`), still reached through the `@/db/trips` barrel. The add panel is also the **one place a trip is created**: "More options" discloses the full former `/trips/new` form in place (description, multi-day, deposit, cancellation window, repeat, per-dive plan), and `/shop/[shopSlug]/trips/new` is a 308 Route Handler to `schedule/board?add=full` carrying `?course=` (ADR 20260806-one-trip-create-form) |
| A repeating trip (every Saturday, Mon+Thu, daily) | cadence math in `src/lib/recurrence.ts` (framework-free, a pure `seriesOccurrenceDates`), materialization in `src/db/trips-series.ts`, nightly horizon roll at `src/app/api/cron/trip-series/`. A run has **no limit**: `trip_series.ends_on` null means it keeps going, and dates are materialized into a rolling `SERIES_HORIZON_DAYS` window. Every instance is an ordinary independent `trips` row — a deleted one leaves a `trip_series_skips` row so the roll never puts it back, and a moved one keeps its `series_occurrence_date` so the roll never re-fills the slot it left. The cadence is editable in place (`updateSeriesCadence`), and **narrowing one cancels nothing** — the orphaned dates are listed back with their head counts and taken off only on a second tap (ADR 20260810-open-ended-recurring-trips) |
| Staff surfaces (all `/shop/**`, auth-gated) | `src/app/shop/` |
| Where staff can go (nav tabs, the "More" menu/sheet, ⌘K "Go to") | one registry, `src/lib/staff-destinations.ts` — path, permission gate, badge source, nav group. `src/components/ShopNavLinks.tsx` (header tabs + the "More" menu), `src/components/StaffTabBar.tsx` (the phone dock, whose sixth slot opens the "More" bottom sheet), and `src/components/search/CommandPalette.tsx` all derive from it; `src/components/ShopNav.tsx` resolves the one label record they share, and `currentStaffNavDestinationId` is the one answer to "which row is current". Add a destination there, never to a consumer. **Five `primary` tabs; the dock's sixth slot is More and that is the ceiling** — a sixth destination tab means demoting one into the `daily`/`setup` groups, not growing the bar (ADR 20260813-more-is-the-shops-other-door). `src/components/ShopIdentityMenu.tsx` holds only the reader's own session (language, sign out) — never a place in the shop |
| SMS delivery receipts | `src/lib/notifications/sms-events.ts` + `src/app/api/webhooks/sms/`; the AWS-side pipeline is section 10 of `infra/lib/infra-stack.ts`; setup in [docs/engineering/sms-delivery-receipts-runbook.md](docs/engineering/sms-delivery-receipts-runbook.md) |
| Environment variables — adding one, or asking who supplies one | one registry, `config/env-registry.mjs`: per key, who produces it (`stack` / `derived` / `manual`), which destinations carry it, and what being absent costs. **A value this repository already knows is not configuration and does not go here** — DiveDay's own origin, sender, Connect client id and Sentry DSN are compiled in beside the code that reads them, behind `src/lib/configured.ts`, with their variables surviving only as overrides; the `constant` provenance that used to carry them is gone, because deploying a value the repo already knows is a round trip that can corrupt it, and once did (issue #517). Everything derives from it — `.env.example` is generated (`node scripts/render-env-example.mjs --write`), `.env.manual` is the only file a human edits, `.env.local`/`.env.vercel`/`.env.github` are generated from the credentials secret plus `.env.manual`, and nothing merges: a stack-produced key in `.env.manual` is refused, not ignored. Add a variable there and nowhere else (ADR 20260812-env-provenance-registry) |
| AWS credentials, and what deploying still leaves for a human | one Secrets Manager secret holding a filled-in `.env.example` (§16 of `infra/lib/infra-stack.ts`), and one registry of manual steps (§17) that renders to both stack outputs and the generated [docs/engineering/manual-actions.md](docs/engineering/manual-actions.md). Add a step to the registry, never to a runbook; regenerate with `pnpm test infra -u`. **Two stacks**: mail is its own, in its own region (`infra/lib/email-stack.ts`, `SES_REGION` in `config/aws-regions.mjs`), and one `pnpm infra:deploy` does both. Reasoning lives in [docs/engineering/infrastructure-runbook.md](docs/engineering/infrastructure-runbook.md) |
| Logs, metrics, alarms, dashboards, and how fast the app feels | `src/lib/log.ts` writes the line and `src/lib/observability/` ships it to CloudWatch; browser Core Web Vitals arrive via `src/app/web-vitals-client.tsx` → `src/app/api/vitals/`, and CloudWatch RUM via `src/app/rum-client.tsx` — all telemetry mounts through the one `src/app/observability-client.tsx` so the capability-URL redaction cannot be bypassed. What is counted and alarmed is one registry, `infra/lib/observability.ts`, expanded in §13 of `infra/lib/infra-stack.ts`; add a signal there, never a graph at a call site. An `$.event` code and a vital's `field` are contracts a test reads out of `src/` — renaming one silently stops a metric filter counting. Setup, thresholds, cost and troubleshooting in [docs/engineering/cloudwatch-observability-runbook.md](docs/engineering/cloudwatch-observability-runbook.md) |
| Email: sending and delivery outcomes | `src/lib/notifications/` + `src/app/api/webhooks/ses/`; setup in [docs/engineering/ses-email-runbook.md](docs/engineering/ses-email-runbook.md). Mail *to* DiveDay is hosted mailboxes, not code |
| The Today work queue (ranking, assembly) | `src/lib/today.ts` / `src/db/today.ts`. The shop home is **one chronological spine** — today's departures as stations in clock order with their own rows, boatless work under "At the desk", tomorrow and the week collapsed (`_components/today/DaySpine.tsx`, `DayStation.tsx`). `assembleDaySpine` re-files what `getTodayWork` ranked; no second detector. `?view=` and `/blockers` 308 home (ADR 20260827-clearwater-surface-language) |
| The end-of-day close-out (the "everyone is home" ritual) | assembly in `src/lib/closeout.ts`, facts + the append-only `day_closeouts` trail in `src/db/closeout.ts`. **It has no page of its own**: the closing block is the evening state of the home's day spine (`_components/today/ClosingBlock.tsx`), and `/close-out` is a 308 to it (slice 6d). Composes from Today's own readers — never a second detector; closing is a recorded act, never a gate (ADR 20260804-day-closeout). It is also where a departure's **log** is generated (`/shop/[shopSlug]/trips/[id]/log`, owner-only) — writing the day up is an evening act, so its door is here rather than in the manifest header a crew works at the rail |
| Buddy teams (who dives with whom, and the split-team alert) | writers and readers in `src/db/buddy-pairs.ts` (named for its table, `buddy_pair_members`; every word a human reads says "team"), the alert in `src/lib/manifests.ts` (`buddyAlertFor`, `splitBuddyTeamIds`), words in `src/i18n/buddy-labels.ts`, the team builder on `src/app/shop/[shopSlug]/trips/[id]/manifest/`. A team is two or more, a member is a booking **or** a crew person, and every act appends to `buddy_team_events` — informs, never gates (ADR 20260804-buddy-teams) |
| How demanding a dive site is | `dive_sites.difficulty_level`, one of three codes (`src/lib/dive-site-difficulty.ts`), worded by `src/i18n/dive-site-labels.ts` and chosen from a `<select>` beside `fit_tone`. Never free text — it renders to a diver and has to arrive in their language (ADR 20260813-dive-site-difficulty-is-a-code). `siteFit()` believes a chosen level outright and only falls back to its keyword sniff when there is none |
| The four lines every staff page opens with (session, shop, tenant, permission) | one helper, `requireShopSurface` in `src/lib/session.ts`: `requireStaffSession()` -> the shop row read by `session.user.shopId` (never the URL slug) -> `notFound()` when it is missing **or** disagrees with the slug -> an optional live `src/db/authz.ts` gate -> a `?notice=` refusal redirect. Every refusal *throws*; there is no path that returns after deciding against the caller, and `src/lib/session.test.ts` pins that, because a gate handing back a `{ allowed: false }` a caller can forget to branch on is a tenant-isolation bug rather than a style regression. It replaced five different outcomes for one condition — `notFound()`, `return null` (a blank 200), `redirect("/")` (which ejects a signed-in staffer out to marketing), a bounce to the shop home, and a `?notice=` — all of which are now `notFound()` |
| Telling a staffer what just happened (the `?notice=` redirect) | `src/lib/staff-notices.ts`: `noticeUrl(path, code, extra?)` writes it, `noticeFromParam` reads it back safely, `shopPath(slug, ...segments)` builds the path. `noticeUrl` percent-encodes every value, merges `&bid=`/`&count=`/`&form=` instead of concatenating them, drops an `undefined` extra, keeps a query the path already carries and a `#fragment` at the end, and normalises the code to kebab — so a `result.reason` the domain layer spells `snake_case` needs no translation at the call site. `shopPath` escapes each segment, which is what stops a client-supplied `shopSlug` argument from traversing out of the `/shop/` namespace, or carrying a `?`/`#` that detaches the very notice being appended after it (same origin either way — the literal `/shop/` prefix rules an off-site redirect out). Codes are enforced kebab by `pnpm check:repo`; never hand-build the string |
| Readiness words and tone ("Blocked" / "Ready", everywhere) | `src/i18n/readiness-labels.ts` — `readinessStatusText`/`readinessStatusTone`. Never spell a status inline in a surface |
| DB schema (source of truth — never read `drizzle/`) | `src/db/schema.ts` |
| DB client / test db factory | `src/db/client.ts` (`getDb()`, `createTestDb()`) |
| Queries and seed data | `src/db/shops.ts`, plus two barrels over sibling modules: `src/db/trips.ts` re-exports `trips-create/-series/-record/-schedule/-crew/-roster.ts`, and `src/db/seed.ts` orchestrates the `seed-*.ts` scenarios. Import from the barrel; edit the sibling |
| Adding demo/seed data | a new `src/db/seed-<scenario>.ts` plus one line in `src/db/seed.ts`'s orchestrator — never wedge rows into an existing scenario, which is how this file became the repo's top conflict magnet (ADR 20260803-seed-scenario-modules) |
| Retention / pruning of append-only tables | `src/lib/retention.ts` holds `RETENTION_DAYS` (the one table a human edits; the values are HD-11's call), `src/db/retention.ts` runs the bounded prune, `src/app/api/cron/retention/` is the weekly surface. The `stripe_webhook_events` window is asserted against Stripe's retry horizon, not merely commented |
| Whether a diver may *buy* a seat vs. *board* | two different gates, deliberately: **trip admission** (`src/lib/trip-admission.ts`, booking-time — "could this diver ever be cleared?") is weaker than **readiness** (`src/lib/readiness.ts`, boarding-time — "are they cleared now?"), and admission may never refuse someone readiness would clear. Both compose the same effective requirement via `getTripSiteRequirement` |
| The booking transaction (capacity enforcement) | `src/db/bookings.ts` — read its tests first |
| The gear register (the shop's own fleet, service clocks, reservations) | opt-in **by presence** — zero `gear_items` rows means no gear UI anywhere, and adding the first unit turns it on (ADR 20260815-minimal-gear-register). Domain rules `src/lib/gear.ts`, readers/writers `src/db/gear.ts`, words `src/i18n/gear-labels.ts` + `staff/gear.json`, surface `src/app/shop/[shopSlug]/gear` (+ the prep page's assignment panel). A reservation joins one unit to one booking for an inclusive date range; the double-booking guard is the `gear_reservations_no_overlap` **exclusion constraint** (btree_gist, hand-added SQL in the migration — raced for real in `gear-reservations.postgres.test.ts`), so catch 23P01 via `violatesExclusionConstraint`, never pre-check availability as truth. Service clocks are the newest `gear_service_events` row per kind and **inform, never gate**; `rental_fit_profiles` stays the universal sizes layer beneath all of it — a fit still reserves nothing. `pnpm task:context gear` for the bounded read |
| Staff seating a diver (Guests tab, walk-in counter, diver record, global Add-booking) | one consequence path: `src/db/seat-diver.ts` (booking + waiver-on-join + activity trail + analytics), driven by `src/app/actions/seat-diver.ts` and the per-surface table in `src/app/actions/seat-diver-surfaces.ts`. The global door is `src/app/shop/[shopSlug]/bookings/new` (pick a departure) then `bookings/new/[tripId]` (pick the diver) — the trip is a path segment, not a `?tripId=`, so a refusal can land back on it. Never re-implement the post-booking side effects at a call site |
| Payments and orders (Stripe Connect) | `src/lib/payments/` (checkout, connect, invoicing, promotions, webhook); order/refund state in `src/db/orders.ts`, `payments.ts`, `checkouts.ts`, `refunds.ts`, `stripe-accounts.ts` |
| The back-office queues (unconfirmed Stripe calls, deletions that never finished) | **Not on Reports** — each sits with the object it is about, and each renders *nothing* when empty. Stuck payment operations (`listStuckPaymentOperations`) are a panel on the Orders index, `src/app/shop/[shopSlug]/orders/page.tsx`, behind `canPersonManagePaymentSettings`; stuck media deletions and owed processor erasures (`listPendingMediaDeletions`, `listOwedProcessorErasures`) lead Settings' "Data & integrations" group in `src/app/shop/[shopSlug]/settings/SettingsPage.tsx`, with their retry/discharge actions in that folder's `actions.ts`. Today mirrors the two stale-able ones as `urgency: "now"` rows pointing at those panels (`src/db/today.ts`). `/shop/[shopSlug]/reports` is the monthly report and nothing else |
| Discount codes | shop-wide in `src/lib/promo-codes.ts` + `src/db/shop-promos.ts` (staff page `shop/[shopSlug]/promos`); one-trip last-minute deals stay in `src/db/trip-promos.ts`. Both resolve in `bookSpot`; Stripe owns the arithmetic |
| A diver asking for a day that is not on the board | one composer, `src/components/DateRequestForm.tsx`, mounted on both `/s/[shopSlug]` (no course — it asks what the request is about, writing `interest`) and `/s/[shopSlug]/courses/[slug]`, behind one action `src/app/actions/inquiry.ts`; rows in `src/db/course-inquiries.ts` (`course_inquiries`, whose `course_id` is nullable and whose check constraint refuses a row naming neither a course nor an interest); grouping rules in `src/lib/date-requests.ts`; staff read them grouped by day at `src/app/shop/[shopSlug]/requests`. Never the wait list or the last-minute deal list — those answer "tell me when a seat frees", this asks for a departure to exist (ADR 20260814-a-date-request-is-a-course-inquiry) |
| Diver reviews and ratings | `src/lib/reviews.ts` + `src/db/reviews.ts`; written from `/recap/[token]`, moderated at `shop/[shopSlug]/reviews`, displayed on the public schedule (`/s/[shopSlug]`) |
| Copy and languages | `src/i18n/` — diver messages in `locales/<locale>/diver.json` (`diverTranslator`, `DiverIntlProvider` + `useTranslations()` for Client Components), staff messages in `staff/<namespace>.json` — one file per area, composed by `staff/index.ts` (ADR 20260807-per-area-staff-bundles) — (`staffTranslator`, **server-side only** — staff Client Components take words as props). `requestTranslator()`/`requestLocale()` resolve in one order and only one: the reader's own choice (the `diveday_locale` cookie, `src/i18n/locale-cookie.ts`) → `Accept-Language` → `shops.default_locale`. The switcher is three doors onto one Server Action (`src/app/actions/set-locale.ts`) — the public shop header beside the shop's name, the staff header's shop-name menu, and the command palette — each language named in itself via `localeEndonym`, never from a bundle. Still **no `[locale]` route**: a locale in the path would fork every public URL and every canonical link (ADR 20260812-reader-chosen-language). `pnpm check:locale` enforces translation coverage; `pnpm check:copy` blocks new hard-coded copy. **Any diver Client Component that reads copy needs `DiverIntlProvider` above it** — without one it throws during the server render and the whole page silently degrades to a blank client-only 200. That is no longer tribal knowledge: `src/i18n/provider-coverage.test.ts` fails on a consumer with no provider in an ancestor segment, or a provider whose `namespaces` list is short. Spanish strings: read `src/i18n/locales/es-ES/README.md` first — terminology and register are already decided |
| SEO structured data | `src/lib/structured-data.ts` + `src/components/JsonLd.tsx`; never in `?embed=1` mode or on a bearer-token page |
| `og:site_name` / `og:type` — the fields that describe DiveDay rather than the page | one constant, `openGraphSite` in `src/lib/site-metadata.ts`, spread by **every page that exports an `openGraph` block**. Next merges `metadata` shallowly, so a page-level block *replaces* the root layout's instead of merging into it — the moment a page says anything about its own unfurl, the site-level fields it never touched drop off. It read backwards from outside until 2026-08-12: pages with nothing to say carried `og:site_name` and no `og:url`, the homepage and every `/s/` route carried `og:url` and no site name. `sharedLinkCard` (`src/lib/marketing.ts`) is this plus the shared card image, for the marketing pages that need both |
| Link-preview cards and icons (`ImageResponse`) | the five `opengraph-image.tsx` plus `icon.tsx`/`apple-icon.tsx`. **Every one calls `allowSvgRasterization()` (`src/lib/og-rasterizer.ts`) before building its `ImageResponse`** — `next/image`'s optimizer disables libvips' SVG loader process-wide on first use, and satori's output is SVG, so without it the card throws mid-stream and severs the socket rather than returning an error (ADR 20260804-og-svg-rasterizer) |
| Notifications (email/SMS/WhatsApp) | `src/lib/notifications/` (SES email adapter, SNS SMS adapter, Meta Cloud API WhatsApp adapter); `courtesy.ts` picks WhatsApp-or-SMS; delivery/retry state in `src/db/notifications.ts` |
| A shop's own WhatsApp sender | Onboarding via Meta Embedded Signup in `src/lib/notifications/whatsapp-signup.ts` + `src/app/shop/[shopSlug]/settings/whatsapp/`; rows in `src/db/whatsapp-accounts.ts`, tokens sealed by `src/lib/secret-box.ts`; delivery statuses in `src/app/api/webhooks/whatsapp/`; setup in [docs/engineering/whatsapp-cloud-api-runbook.md](docs/engineering/whatsapp-cloud-api-runbook.md) |
| Data portability (CSV export/import) | `src/db/export.ts` / `src/db/import.ts`; staff UI at `src/app/shop/[shopSlug]/settings/import/` — security-sensitive, see hard rules |
| Scheduled backup to shop-owned storage | `src/features/backup-export/` (bundle assembly, sealed credentials, SigV4 upload, delivery ledger); weekly cron `src/app/api/cron/backup-export/`; staff UI is the Backups half of `src/app/shop/[shopSlug]/settings/export/` (`#backups`) — `/settings/backup` is a 308 to it, since a backup is the export bundle on a schedule behind the identical gate (ADR 20260804-shop-owned-backup-export, ADR 20260806-one-data-out-surface). Security-sensitive like export, see hard rules |
| Offline boat manifests | `src/lib/offline-manifests.ts` + `offline-manifest-store.ts` (encrypted IndexedDB); viewer at `src/app/offline-manifest/`; service worker `src/worker/manifest-sw.ts`. Two API routes, deliberately not one: `api/offline-manifests/upcoming` answers with the shop's whole 48-hour board and is only for callers that want it (the shop layout's auto-save, the worker's push refresh), while `api/offline-manifests/identity` answers `{ shop: { slug } }` and nothing else, for the shell's cross-shop purge. Both `no-store`; both read through the response types in `offline-manifests.ts`, never an inline cast (ADR 20260726-shopwide-offline-manifest-priming's 2026-08-06 amendment) |
| A dive site's briefing — what a diver reads, and which field writes it | Written on one form, `src/app/shop/[shopSlug]/dive-sites/_components/SiteFields.tsx` plus its two list editors; read on the departure page as four ledger beats in `_components/TripDayPlan.tsx` — `TripLookFor` (the species, each with its bundled photo), `TripRoutes` (the drawn line), `TripMoments` (published `dive_site_moments` photos), `TripSiteNotes` (the prose: `fit_tone`/`fit_note`, `dive_plan`, `current_note`, `marine_life`/`marine_life_description`, `landmarks`, `conservation_note`). Every sentence comes off the site row, uncaptioned — the fit tone is one word, and there is no canned filler (ADR 20260813-dive-site-briefings-are-the-shops-own-words, tightened by the 2026-08-28 diver-views review). The one exception is the **field guide**, a *selection* rather than a sentence: `dive_site_creatures` rows name catalog species (`src/lib/dive-site-field-guide.ts`) and the words on each card are DiveDay's, in both languages, resolved per reader by `src/i18n/marine-life-labels.ts` (ADR 20260813-marine-life-is-diveday-copy). |
| Starting content a shop copies and then owns (site templates, courses) | `src/db/dive-site-templates.ts` (34 real Florida sites, published into the catalog by `src/db/seed-dive-site-catalog.ts`) and `src/db/course-templates.ts`. Both are `i18n-exempt-file`: picking one **copies** its words onto the shop's row, and nothing is read back at render, so a later correction never rewrites what a shop published. Browse and read a site template before taking it at `dive-sites?view=catalog&template=<slug>` |
| Species a shop *picks* but does not write (the field guide) | `src/db/marine-life-catalog.ts` — 148 wider-Caribbean species as slug + Latin binomial + category code, no prose, photos under `public/marine-life/` (add one with `node scripts/fetch-marine-life-photo.mjs <slug> --search "<Latin name>"`, which enforces the licence and writes the credit). The **opposite** contract to the two templates above and the line worth knowing: a shop chooses which faces a site shows and in what order, and DiveDay writes them once in every language (`marineLife.*` in `diver.json`, resolved by `src/i18n/marine-life-labels.ts`). A dive plan for one reef is the shop's to write; what a stoplight parrotfish looks like is not. `MARINE_LIFE_CATALOG` is `as const`, so a species added without its copy is a **compile** error (ADR 20260813-marine-life-is-diveday-copy). A species DiveDay does not carry is refused by the picker and the ask lands in `marine_life_requests` (`src/db/marine-life-requests.ts`) — a table nothing renders, queried directly when deciding what the catalog grows by |
| Domain logic (framework-free) | `src/lib/` — capacity in `trips.ts`, dates in `format.ts` |
| Feature modules | `src/features/<feature>/` — one `index.ts` is the whole public surface, `README.md` states what it owns; deep imports fail `pnpm check:architecture`. The first was `calendar-sync` (ADR 20260730-feature-module-contracts); `backup-export` and `integrations` followed |
| Outbound integrations a shop connects for itself (Shopify, QuickBooks, Zapier) | `src/features/integrations/` — one registry (`registry.ts`) names each provider and the event types it takes, `dispatcher.ts` drains the outbox, one adapter per provider. Rows in `src/db/integrations.ts` (credentials sealed by `src/lib/secret-box.ts`) and `src/db/integration-events.ts` (the at-least-once outbox and its deliveries); OAuth state in `integration_oauth_states`, consumed once and bound to the shop **and** the person who started it. Staff surface `src/app/shop/[shopSlug]/settings/integrations`, callbacks under `src/app/api/integrations/<provider>/callback`, drained every 10 minutes by `src/app/api/cron/integrations`. A Zapier hook URL is pinned to `hooks.zapier.com` over https — never an arbitrary host |
| Staff calendar subscriptions (iCalendar feeds) | `src/features/calendar-sync/` + `src/app/calendar/[token]/route.ts`; staff UI at `src/app/shop/[shopSlug]/settings/calendar/` |
| Auth: session, gates, edge check | `src/lib/auth.ts` (better-auth instance + credentials plugin) / `auth-secret.ts` / `authz.ts` + `session.ts`; edge layer in `src/proxy.ts`. `/shop/**` is staff-only end to end — there is no public-route allowlist any more |
| Dev/e2e staff logins | `src/db/dev-credentials.ts` |
| Design tokens | `src/app/globals.css` (semantic only, ADR-0004) |
| Form/button/control/panel wrappers | `src/components/ui/` — `form.tsx` (`Field`, `FieldGrid`, `controlClass`), `button.ts` (`buttonClass`), `card.tsx` (`SectionCard`, `sectionCardClass`), `tone.ts` (`toneMark`, the one tone→`StatusMark` map) |
| The panel a staff page is made of | `SectionCard` in `src/components/ui/card.tsx` — one radius, one elevation, one padding scale (`rounded-panel border border-border bg-surface shadow-bed` — Reef's 28px on the warm bed, ADR 20260901-diveday-reimagined 13a — matching the `<Table>` shell so a card, a stat tile and a table read as the same object). It owns its heading and the gap under it; pages space their sections with `space-y-10` rather than per-section `mt-*`, and a route's `loading.tsx` takes the same shell from `sectionCardClass()` so a skeleton cannot drift into a layout jump. **There is deliberately no `radius` prop** — one that let each call site keep its current corner would preserve the drift behind an abstraction. |
| Where a form says what happened (refused, saved) | **Beside the form, never in a banner at the top of the page.** Field-level refusals go on the field (`Field`'s `error` prop, which wires `aria-invalid`/`aria-describedby` for you); form-level ones go in the action row (`FormStatus`) — both in `src/components/ui/form.tsx`, with `FieldErrorFocus` to move the cursor to the offending box. A page's `?notice=` is routed to the form that produced it by `noticeForForm` (`src/lib/staff-notices.ts`); the page banner is left for what is genuinely about the page. See [docs/design/forms-and-controls.md](docs/design/forms-and-controls.md) |
| Paging a staff list (prev / "Page 3 of 7" / next) | one component, `src/components/Pager.tsx`, words from the one `shared.pager.*` key set; one query shape, `offsetPage` in `src/db/paging.ts`. **Every paged staff list wears it** — orders, divers, reports, reviews, the dive-site library and the published site catalog, courses, both promo lists, the waiver signature log, and the add-booking departure picker (ADR 20260803-one-pagination-model); a new paged list uses it from the start. Keyset cursors (`src/db/cursor.ts`) are the one earned exception — the schedule board pages a stream with no end to count. A list's **count must share the row query's exact scope** (joins, `where`, `having`, `now`), or the pager promises pages that render nothing |
| Why a route paints instantly (or doesn't) | Each page declares `export const instant = true` and owns a body-shaped `loading.tsx` — that file *is* the Suspense boundary, and what a client navigation into the segment paints. `instant = false` survives on exactly one shell, `src/app/shop/[shopSlug]/layout.tsx`, which cannot be instant because its cross-tenant `notFound()` must run before `{children}` (ADR 20260804-instant-navigation) |
| "What should this code do?" | Read `foo.test.ts` before `foo.ts` — tests are the contract |
| A design for a surface that does not exist yet (mockups, a flow, two compositions to choose between) | [docs/design/design-artifacts.md](docs/design/design-artifacts.md) first — it sets what a design canvas may claim and where it goes. The split it enforces: the **canvas** argues in pictures and is dated, illustrative, and superseded rather than freshened; the **ADR** carries the decisions and is what code obeys; [docs/design/surfaces.md](docs/design/surfaces.md) holds the one idea. Artboard sources live in `docs/design/canvases/<YYYYMMDD-slug>/` (never the seeded payload — it is build output); `pnpm check:design-canvases` enforces the mechanics. The worked example is the trip/manifest redesign, ADR 20260827-the-departure-is-two-working-surfaces. Reach for a canvas only when a surface is significant enough for an ADR — never for a component, a form, or a copy change, where the screenshot script and the **design-review** skill answer faster against the real app |
| An idea, question, risk, or cleanup you are **not** doing in this change | a GitHub issue labelled `needs-triage` (see [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md)'s "Filing a follow-up" section) — the human's triage inbox, not a backlog. If nobody in this repo can move it (an upstream release, a third party's answer, numbers that need traffic), add `waiting-on-external` too, with a `**Waiting on:**` line. Committed work still lives in `docs/product/features/`, human-owned calls in `docs/product/human-decisions.md` |

## Skills and providers

The canonical process is this file, `docs/`, scripts, and tests. Claude-specific playbooks are indexed
in [.claude/skills/README.md](.claude/skills/README.md): **new-feature**, **verify**, **design-implementation**, **i18n-copy**,
**copy-restraint**, **design-review**, **brand-voice**, **schema-change**, **debug**, **instant-navigation**,
**e2e-and-visual**, **visual-triage**, **adr**, **stacked-prs**, **triage**, **backlog-routine**,
**marketing-page**, **switching-pages**, **run**, and **commercial-outreach**.
Other providers
should read the corresponding `SKILL.md` directly when useful. If a skill conflicts with canonical
docs, tests, or code, the skill is stale and must be fixed in the same change.

## Parallel work

- Assume multiple work scopes can be in flight in this working directory at once — other
  sessions or terminals may have uncommitted changes, staged work, or a mid-rebase state at
  any time. Run `git status` before anything that touches shared working-tree state, not just
  before destructive commands.
- **Claim the issue before you start.** Add the `in-progress` label and post a `## Claim` comment
  naming your branch, worktree, start time, and owned paths — see
  [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md)'s "Claiming an issue". A draft PR
  declares the same thing but starts too late: a session that has begun and not yet pushed has no
  PR, no branch commit, and no footprint at all, which on 2026-08-21 left the *name of a worktree
  directory* as the only way to tell what a parallel window was building. Clear the label when you
  finish or stop.
- Before starting non-trivial work, read the open PRs **and** `pnpm gates`' "Claimed — in flight"
  section, which lists every claim and whether its session still exists. Overlap with your plan →
  pick a different slice or coordinate in that thread; never assume you are the only session
  running. A claim reported **stale** (worktree gone, branch never moved) is a dead session, not a
  reservation — take the work and clear the claim.
- Avoid `git stash` to test something on a different ref — a stash is a single shared slot, so
  popping it later can silently apply on top of a *different* scope's uncommitted work and
  produce confusing conflicts, or another session's stash can collide with yours. Prefer, in
  order: a `git worktree` (or this harness's worktree tools) for true isolation, committing your
  in-progress change to a WIP commit on your branch, or `git stash push --include-untracked` with
  a descriptive message and popping it immediately after — never leave a stash sitting while you
  go do something else.
- Use a unique branch/feature slug and open a draft PR early for non-trivial concurrent work.
- State owned paths, expected schema changes, and planned ADR ids in the PR description.
- New ADRs use collision-resistant `YYYYMMDD-short-slug` ids; do not allocate the next integer.
- Do not use branch-local reservation ledgers: other pending branches cannot see them.
- Split work by vertical slice or non-overlapping paths. Trial-merge the target branch before calling
  work complete.
- **Stack by default: cut every branch from the branch you opened last, not from `main`, whenever
  that one is still open.** Related or unrelated, a schema migration or a padding change — the shape
  is the same. A dependent chain (`src/db/schema.ts` + migration → the `src/db` reader → the surface)
  has no other honest shape, since step 2 cannot compile or be read without step 1; unrelated work
  stacks for a different reason, which is that a second branch cut from `main` re-edits the same
  shared files as the first — the `check:repo` row, a `docs/design/*.md` section, a
  `scripts/*-baseline.json`, a message bundle — and every one of those is a conflict resolved later
  by hand, without the context that produced it. On a stack each layer already contains the ones
  below, so those files merge **once, while the change is being written**, and a ratchet banked on
  layer 4 already counts layer 3. **Pixels are not an exception** (ADR
  20260821-stacked-pull-requests, "Reversed: a stack may move pixels"): losing the baseline race
  costs a re-read, not a missed regression, and the pipeline now names each layer's baseline and
  waits for the layer below to publish it. Cut each branch from the one below and open each PR with
  its `base` set to that branch, bottom one first, every body naming its position and the branch
  beneath it. **Open each PR as a draft at that layer's first commit and register the chain in the
  same breath** — `gh stack link <bottom> <next>`, or `gh api --method POST
  repos/{owner}/{repo}/stacks` with the numbers bottom to top and `-F` (never `-f`, which sends
  strings and 422s). Registering is what buys the cascading rebase and the bottom-up atomic merge,
  and registering *early* is what makes GitHub retarget a layer when its base merges instead of
  leaving you to open a PR against a branch that no longer exists. Four things still go on their own
  branch off `main`: nothing of yours is open (`git fetch origin main` first, every time — it decides
  the shape), a fix that must merge now (a red `main`, a hotfix, a spec race you did not cause), a
  stack already about six layers deep (only the bottom and top layers run the expensive gate — the
  middles skip it, so read a middle layer's green as "nothing ran": ADR
  20260827-stack-ci-skips-the-middle-layers), and a branch that belongs to another
  session. See the **stacked-prs** skill and ADR
  20260821-stacked-pull-requests.
- Before fixing a failing or flaky test, search open PRs for one that already touches the same
  spec or test name. Two sessions independently patching the same broken test race each other and
  produce conflicting fixes. If one is already in flight, coordinate in that PR's thread instead
  of pushing a second, competing fix.

## Hard rules

- **A background job you start is yours to end, and `TaskList` is not how you check.** On
  2026-08-15 a wait-loop ran for **nine hours** in this repo, and `TaskList` reported "No tasks
  found" twice while that shell was alive — so an agent that dutifully reaps before ending its turn
  still misses it. `node scripts/stray-processes.mjs --list` reads the process table, which is the
  only honest answer; the `Stop` hook runs it for you and hands back what it finds. Three habits
  that would each have prevented it, and none of which the hook can enforce: **never pipe a
  long-running command through `tail`/`head`** — neither can flush, so a command that gets moved to
  the background leaves an output file that stays empty rather than filling in as it runs (use
  `grep --line-buffered`, or read the output file directly); **never write a wait whose only exit is
  a success marker** — give it a timeout and a failure branch, or it spins forever the moment the
  thing it watches dies; and **when you kill a producer, stop its watcher in the same breath**, since
  a `pkill` that frees you is the same `pkill` that strands whatever was waiting on its output.
- **Verify before commit, and let CI run anything whole.** Targeted checks are yours — the one
  guard you touched, `pnpm test <file>`, `pnpm test:changed`, `pnpm typecheck`, `pnpm lint`, one
  focused `pnpm e2e <spec>`. The **whole** unit suite, `next build`, the whole e2e suite and the
  visual run go to CI, which shards them across dedicated runners: push and read the result. Open
  the PR before it is green when that is the fastest way to learn what is broken, say in the body
  what you ran and what you did not, and work what comes back — a red PR you are driving is fine,
  a red PR you have stopped driving is not. Never report unverified work as done, and *look at*
  UI you changed (screenshots, light + dark), which is the one thing CI cannot answer. Reasoning
  and the exact line: [docs/agents/verifying.md](docs/agents/verifying.md).
- **A thought you don't act on goes in the tracker, not in your closing message.** Finishing a
  change with an idea you left undone, a question only a human can answer, a risk you noticed in
  passing, or a cleanup you deliberately scoped out? File it as a GitHub issue labelled
  `needs-triage` (see [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md)'s "Filing a
  follow-up" section) and list its number in the PR description. A closing message is read once and
  gone; the issue tracker is where the human triages. Each one is written for a reader with none of
  your context and ends with a prompt they can paste into a fresh session. This never replaces doing
  the work you were asked to do, and a failing test is never a follow-up (next rule). Nor is it a
  place to open a second front: never act on someone else's entry as a drive-by.
- **A failing or flaky test is part of the work, even when unrelated to your change.** Fix it
  before calling the work done — never skip it, widen a timeout to paper over a flake, or leave
  it red for someone else. See **Parallel work** first: check for an in-flight fix on the same
  test before starting your own, so two sessions don't race to patch it.
- **A pushed PR is not done until visual diffs are accounted for.** Review every diff image for
  what the code explains; never wave a mismatch through. Baselines live in S3 keyed by git commit
  (ADR 20260729-reg-suit-visual-regression) — there is nothing to regenerate or commit locally, so
  "approving" an intentional change means saying in the PR *why* the pixels moved and merging;
  the merge is what becomes the next baseline. See the **visual-triage** skill. Never end the
  session leaving a visual diff or failure unexplained.
- **A pushed PR is not done until its review threads are answered.** Every pull request in this
  repository is reviewed within minutes by bots that read the diff — `sourcery-ai` (a review guide
  plus inline nitpicks), `coderabbitai` (a summary and inline findings), `github-advanced-security`
  on scripts — and by Aaron, whose comments arrive whenever he gets to it. **Read them before you
  call the work done, and again whenever you come back to a branch you pushed earlier:**

  ```bash
  gh pr view <n> --comments
  ```

  That shows issue-level comments, review bodies and the inline ones, but not which threads are
  still **open** — for that, and for the exact thread ids, ask GraphQL:

  ```bash
  gh api graphql -f query='query{repository(owner:"AaronBuxbaum",name:"diveday"){pullRequest(number:<n>){reviewThreads(first:50){nodes{id isResolved isOutdated path comments(first:5){nodes{author{login} body}}}}}}}'
  ```

  Every open thread ends in one of three states, never silence: **fixed** — push the change, then
  reply naming the commit; **declined** — the reason goes in the thread, and a nitpick that
  contradicts a written rule here is declined by naming the rule rather than by ignoring it; or
  **filed** — worth doing, out of scope, so it becomes a `needs-triage` issue whose number goes in
  the thread. Reply on the thread itself, not in the PR description:

  ```bash
  gh api repos/AaronBuxbaum/diveday/pulls/<n>/comments/<comment-id>/replies -f body='...'
  ```

  Resolve a thread only when you acted on it (`resolveReviewThread` on the id above), and leave it
  open when your answer is a question back.

  **A draft PR is only half-reviewed, and no comments does not mean reviewed clean.** `sourcery-ai`
  reviews a draft; `coderabbitai` skips one by default and says so in a comment nobody reads twice
  (measured on PR #942). So the moment CI goes green and the draft flips to ready is also the moment
  the second review starts — read the threads *again* then, rather than treating the quiet draft as
  the answer. It is the same failure as a zero visual count with no baseline resolved: nothing
  compared, not nothing wrong. **A PR with an unread thread is not done** — say what is
  outstanding rather than calling it finished — and never treat a bot's comment as automatically
  right: these tools do not know this repository's rules and confidently propose changes that
  `pnpm check:repo` refuses.
- **Screenshots are full-size and unfiltered; bound the *page*, not the capture.** A surface that
  screenshots enormous is telling you the page is unbounded, and the fix is pagination (or a
  default range) in the product, where a real shop benefits from it — never a `?filter=` in the
  spec that shrinks the picture and leaves users scrolling 17,000px. Narrowing a capture to make
  it cheap also silently narrows what it can catch. The orders index was found this way: 323
  seeded orders, no pager, no baseline at all.
- **Semantic tokens only** in components — no raw hex, no palette-scale classes (ADR-0004).
- **Forms, buttons and panels go through the wrappers** — stacked fields via `<Field>`/`<FieldGrid>`,
  button-shaped things via `buttonClass()`, controls via `controlClass`, the bordered panel a page is
  made of via `<SectionCard>` (and its `loading.tsx` twin via `sectionCardClass()`). Hand-rolled
  class strings are how fields fall out of alignment, button labels drift off-center, and sibling
  routes one tap apart end up at two different corner radii. Never pass a `text-<colour>` through
  `className` to `buttonClass()` — Tailwind emits colour utilities **alphabetically by token name**,
  so the override silently loses to the variant's own colour rather than winning; that read as an
  instruction and did nothing at 31 call sites until 2026-08-15, and `button.test.ts` now fails on
  it. If you find yourself cancelling a variant's own styles, the variant is wrong. See
  [docs/design/forms-and-controls.md](docs/design/forms-and-controls.md).
- **New runtime dependency → ADR.** New domain concept → glossary. Invalidated doc → fix in
  the same PR.
- **Safety-critical surfaces** (manifests, roll call, cert gating, medical flags) get boring
  code, failure-path and adversarial tests, and a `dive-domain-expert` review.
- **Security-sensitive changes** (auth/authz, the public-route allowlist, token flows, rows
  holding personal or medical data, export/import) get a `security-reviewer` review before merge.
- **Layout**: domain logic in `src/lib/` or a feature module; routes in `src/app/` stay
  thin; e2e specs live in `e2e/`. The dependency direction is one way — `app → features → lib/db`,
  and `pnpm check:architecture` enforces it: `src/lib`/`src/db` may import neither `src/app` nor
  `src/features`, and a `src/features/<feature>/` module is reachable only through its `index.ts`
  (it needs a `README.md` too). See the ADR before adding one. Server actions default
  to inline `"use server"` closures for single-page mutations; `src/app/actions/` is only for actions
  shared across pages; a large page colocates its actions/zod schemas in a sibling `actions.ts`.
- **Tests travel with behavior.** New features include happy-path and important failure-path tests;
  bug fixes begin with a failing regression test. Every important **flow** a user runs (booking,
  waivers, cert/nitrox gating, manifest/roll call, refunds, scheduling, sign-in) gets an `e2e/`
  spec, and every important **surface** they look at gets a screenshot assertion in the visual spec
  `e2e/visual.spec.ts` — especially when introducing a feature. See the **e2e-and-visual** skill;
  if unsure whether something qualifies, it does.
- **A panel that only renders when something has gone wrong is photographed through
  `/api/test/seed-trouble-states`, never by seeding the failure into the demo shop.** Stuck payment
  operations, owed refunds, unfinished media deletions, erasures Stripe still owes, a withheld
  rating — warning-toned blocks of dense prose with inline links, seen by a shop on its worst day,
  and for a long time the one class of staff surface no screenshot had ever looked at. Add the fifth
  one's state to that route (`src/app/api/test/seed-trouble-states/route.ts`) and a capture beside
  the surface's calm one. Do **not** seed it into blue-mantis: a demo permanently shouting that four
  payments are broken is a worse demo, and `src/db/seed-front-desk.ts` says so at the row it
  deliberately seeds `succeeded`. Mutating is safe because each Playwright worker owns its own
  database and resets it before every test (`e2e/servers.ts`).
- **Never hard-code a locale in the UI.** Every date, time, and money figure under `src/app` or
  `src/components` formats for the negotiated request locale (`requestLocale`, from
  `Accept-Language`) — never a literal `"en-US"`. `pnpm check:locale` enforces this app-wide.
- **A rendered date names the zone it is rendered in.** Timestamps are stored as UTC instants and
  displayed in the shop's own zone (`shops.timezone`) — so every date/time render passes
  `shop.timezone` alongside the locale, and the `src/lib/format.ts` formatters take `timeZone` as a
  **required** parameter to make a missing one a compile error rather than a wrong time. This is not
  a style preference: `Intl` falls back to the *host* zone when no zone is given, and every DiveDay
  server and CI box is UTC, so an omission renders a 7:30 AM departure as 11:30 AM — plausible,
  green, and four hours wrong on the screen a diver uses to decide when to leave. A value with no
  instant in it (a date-only calendar date, a wall-clock time of day) says `timeZone: "UTC"`
  explicitly instead — see `src/lib/calendar-date.ts`. `pnpm check:timezone` enforces the rest.
- **Every sentence earns its place, or it is deleted.** Before writing a string — and every time
  you read past an existing one — ask whether the reader would get something wrong without it.
  Only two kinds survive: one carrying a state or consequence the surface cannot show on its own,
  and one that is genuine delight. A caption restating its own heading ("Crew" / "Who's running
  this trip."), a clause explaining which rule won ("Readiness always enforces the stricter of the
  site and this trip."), a second manual path to what a nearby button already does, and an apology
  for a refusal all go — deleted, not shortened, along with the element that held them. Deleting a
  key means all three edits in one change: the call site, `en-US`, and `es-ES`. See the
  **copy-restraint** skill. Where restraint and accessibility genuinely conflict, build for the
  standard user and record the trade in
  [docs/design/accessibility-tradeoffs.md](docs/design/accessibility-tradeoffs.md) — never a
  follow-up, never silence. That licence stops at safety surfaces (manifests, roll call, cert
  gating, medical flags), at keyboard reach, and at anything that costs the sighted user nothing.
- **Copy comes from a message bundle, never a component.** Diver copy in
  `src/i18n/locales/<locale>/diver.json`, staff copy in `staff/<namespace>.json` (one file per area — a
  new area is a new file plus one import in `staff/index.ts`, so parallel branches stop colliding in
  one 3,500-line bundle). `pnpm check:copy` is a
  **ratchet**: a file with no entry in `scripts/copy-baseline.json` may contain no hard-coded copy
  at all, an existing file's count may never rise, and a count that falls must be banked in the
  same change (`node scripts/check-copy.mjs --write`, which refuses to raise anything). The
  original extraction backlog is finished — both `scripts/copy-baseline.json` and
  `scripts/domain-strings-baseline.json` are empty, so the ratchet now behaves as a full gate: any
  hard-coded copy anywhere under the guarded roots (including `src/features`) fails the check.
  Check those files directly for current state rather than trusting a number here. `src/lib`
  and `src/db` return **codes, not sentences**; the UI picks the words. A data module that
  *feeds* the UI (marketing claims, switching guides, demo roles) holds **message-bundle keys,
  never words** — the key-registry pattern of `src/lib/marketing.ts` / `src/lib/demo-roles.ts` —
  and the registries listed in `scripts/check-domain-strings.mjs`'s `proseFreeFiles` hard-fail on
  any unexempted prose literal. **Never add English (or any language) as a string the user will
  read outside `src/i18n/locales/`** — every new sentence lands in *every* locale's bundle in the
  same change, and there is no "translate it later": a key missing from one locale fails
  `pnpm check:locale`. Waiver/medical wording stays English pending H-01/H-03. See the
  **i18n-copy** skill.
- **Text a human will copy is written unwrapped.** A support case, an outreach email, an incident
  note — anything a reader selects and pastes into a mailbox, a form, or a chat box — gets one line
  per paragraph and one per bullet, however long, in a document and in a chat reply alike. Markdown
  prose here wraps at 100 columns; a paste block is not prose, and its wraps survive the copy as
  hard breaks that ragged every paragraph in the destination and mark the message as machine-made.
  The worked examples are the SES case text in
  [docs/engineering/ses-email-runbook.md](docs/engineering/ses-email-runbook.md), the incident comms
  templates in [docs/engineering/incident-response-runbook.md](docs/engineering/incident-response-runbook.md),
  and [docs/product/pilot-kit/cold-email-template.md](docs/product/pilot-kit/cold-email-template.md).
- **Read time through the clock.** `src/lib`, `src/db`, and `src/features` never call `new Date()` / `Date.now()`
  directly — use `nowDate()` / `nowMs()` from `src/lib/clock.ts` (default a `now` parameter to it).
  This is what lets the e2e fleet freeze one instant so the clock-anchored seed and every render
  stay pixel-stable for visual regression; in production the clock is the native call, unchanged.
  `pnpm check:clock` enforces it. Never stabilise a visual test by masking moving text — freeze the
  clock at the Playwright harness boundary.
- **Trips Late-Arrival & Departure Buffer**: Because trips often run late, all checks determining whether a departure has sailed, ended, or is "in the past" (e.g., booking eligibility, walk-in check-ins, blowout alternatives, closeout state, sitemap/stats visibility) must include a **1-hour buffer** on the scheduled departure or arrival time.
- **A new page ships with a `loading.tsx` and `export const instant = true`.** That file is the
  route's `<Suspense>` boundary — what a client navigation into the segment paints, and what stands
  in the static shell while the page's request-scoped reads stream in. Shape it like the body it
  replaces (an `animate-pulse` wrapper, `bg-surface-sunken` bars, `border-border bg-surface` cards),
  never a spinner. **Never put an `await` above `{children}` in a `layout.tsx`**: a layout wraps the
  page, so no boundary can be placed between them, and one request-scoped read there costs every
  route beneath it its static shell — put the read in an async child inside its own `<Suspense>`,
  with a fallback that holds its height. `next build` fails on a route that breaks this
  (`blocking-prerender-dynamic` / `blocking-prerender-client-hook`), naming the component. See ADR
  20260804-instant-navigation.
- **A queue in a closing message is not a queue.** Ending a turn with "next I'll drop
  the retired table" starts nothing: the message is sent, the turn ends, and the next turn has only
  what is written down. On 2026-08-15 a session did that three turns running and the user sat
  watching silence until they asked whether anything was still working — nothing had broken, the
  work simply never began. So a turn ends in exactly one of three states: the thing is **done**, it
  is **filed** as a `needs-triage` GitHub issue where a cold reader can run it, or it is **handed over**
  in as many words ("I've stopped here, I need X from you"). A turn that ends on a question is a
  fine ending. A turn that ends on an intention is not. More than one item in flight goes in the
  task list (`TaskCreate`/`TaskUpdate`), never in prose. `scripts/unfinished-promises.mjs` is a
  `Stop` hook that blocks a turn whose closing message promises work while the tree is dirty — it
  reads the transcript, skips handoff phrasings, and fails open, so treat it as a reminder rather
  than an adversary.
- **There is no legacy. Delete it.** DiveDay is pre-pilot: no users, no data anyone would miss
  (H-49, extending H-47). A table nothing writes gets **dropped**, not carried behind a `seq` column
  so its dead rows sort nicely. A code path that exists only to tolerate old rows gets **deleted**,
  not documented. A lifecycle rule that exists only to age out abandoned objects gets **removed**,
  not waited out. Do not write reconciliation, backfill, dual-read, or version-tolerance code for
  pre-pilot data, and do not read the absence of one as an oversight to fix — three follow-ups
  proposed exactly that in one week, and each was a migration spent on rows that have never had a
  reader. When in doubt the answer is the smaller tree.
  **Two things this does not relax**, because they are not about the value of the data:
  the **destructive-migration guard** and the expand/contract rule keep the *previous release* alive
  while a migration runs inside the production build, and having no users does not help a shop
  watching its schedule mid-deploy — a destructive migration still carries its
  `-- diveday:allow-destructive <rule> <table>.<column>: <why>` line, where "pre-pilot, no users,
  H-49" is now a sufficient *why*. And **H-02's retention windows and the erasure path** are
  promises about data we *will* hold; they stand. This rule expires the moment the first pilot shop
  has real divers in the system — Aaron will say so, and it is not an agent's call to make.
- **Every delete is soft, and the word on screen is still "Delete."** A user pointing at a thing and
  asking for it gone sets `deleted_at`; the row stays and history holds (ADR
  20260820-every-delete-is-soft, extending 20260719-crud-archive-semantics to every entity). This is
  the default, not a list of blessed tables: a new table holding anything a user can delete gets
  `deleted_at`, a partial index over the live rows only, and `deleted_at is null` in every
  active-workspace read. The column is `deleted_at` — `archived_at` is not a second spelling of it.
  **Never say so.** Not Archive, Unarchive, Deactivate, Retire, Hide, or "soft delete" in anything a
  person reads — button, confirm, toast, notice, filter, empty state; a staff list of deleted records
  is "Deleted" and its action is "Restore". No sentence explains which history survived: a caption
  reassuring the reader about an outcome they never doubted earns nothing, and "archive" makes a
  shop stop mid-afternoon to work out whether we mean the thing they asked for. Reversibility is a
  promise we keep, not a concept they hold. The euphemism does not have to be one of those words to
  be one: "Takes this diver off your active lists", under a heading saying **Delete** and above a
  button saying **Delete Adaeze Nwosu**, was the only one of the three that declined to say it
  (issue #779). `pnpm check:repo` now refuses that family too.
  **A publish state is not a delete, and says so.** Hiding a review and taking a course off the
  public site are both *unpublishing*: `tripReviews.isPublished` is reversible by republishing and a
  hidden review still counts against the shop's suppression share (ADR
  20260813-review-moderation-has-a-floor), and `courses.is_active` is the toggle on the "Live at
  /s/<slug>/courses/<slug>" line — neither table has a delete at all. So "Hidden" is the honest word
  in both, the ban on **Hide** does not reach them, and the test is whether the thing is *gone* or
  merely *not shown*. A diver's own words are the clearest case: a shop cannot delete a review it
  did not write, only decline to publish it.
  **Two exceptions.** *Legal erasure*, where an obligation
  requires real destruction — it stays one-way, stays a separate column from `deleted_at`
  (`people.anonymized_at` plus its check constraint), never becomes the primary action, and is the
  one place the distinction *is* expressed, because the reader is choosing between two outcomes and
  one has no undo. And *machinery nobody pointed at*: H-02's bounded retention prune, child rows
  rewritten wholesale when their parent saves (`trip_dives`, `trip_schedule_days` — a replace), a
  single-use token consumed on use, seed and test teardown. This does **not** touch the rule above
  it: "There is no legacy. Delete it." governs the *tree* — a dead table still gets dropped, a dead
  code path still gets deleted. This one governs *rows at runtime*. `pnpm check:repo` enforces the
  vocabulary half over the message bundles. `deleteTrip` (`src/db/trips-schedule.ts`) is migrated as
  of 2026-08-20 — it stamps `trips.deleted_at` and leaves all five child tables attached, and
  `scripts/check-live-trips.mjs` (in `pnpm check:repo`) fails the build on any read of `trips`, or
  any join from a surviving child table, that neither carries `liveTrip()` (`src/db/trips-live.ts`)
  nor says `diveday:allow-deleted-trips: <why>`. That gate exists because the failure is silent and
  public: an unfiltered read shows an anonymous visitor a departure the shop took off the board. The *internal*
  vocabulary matches the screen as of the same day — `deleteCertification` and
  `waiver_templates.deleted_at` — so `deleted_at` is now the only spelling in the tree.
- **Secrets never enter the repo** — `.env*` is gitignored.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
