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
| `pnpm dev` | dev server at localhost:3000 |
| `pnpm task:context <area>` | bounded paths, invariants, and validation for a task |
| `pnpm check:env` | the two structural facts about configuration: `.env.example` still matches `config/env-registry.mjs` (it is generated, and the CDK stack reads it at synth to build the credentials secret), and `.env.manual` speaks only for values a human is the source of. Then reports which manual values are unset and what each one switches off — a report, never a failure, since every one is legitimately absent |
| `pnpm env:manual` | create or refresh `.env.manual`, the one configuration file a human edits. Never overwrites a value; on first run it lifts the manual values out of a pre-split `.env.local` |
| `pnpm check:repo` | environment, architecture/feature-module, design-token, clock, timezone, Intl-cache, ADR, doc-link, locale-coverage, hard-coded-copy, domain-layer-copy, route-coverage, destructive-migration, e2e-hygiene, follow-up-register, agent-layer (skills/index/task-context), Open-Graph-site and infra-ASCII safeguards. The infra-ASCII one (`scripts/check-infra-ascii.mjs`) refuses any non-ASCII character in the text a deploy carries out of this repo — all of `infra/`, plus `config/env-registry.mjs`, `scripts/render-env-example.mjs`, and the generated `.env.example`, since the credentials secret embeds that file at synth. Comments and string literals in those end up in a deployed CloudFormation template and Secrets Manager secret string, and something in that pipeline mangles non-ASCII: an em dash and two `≤`/`≥` symbols came back from a real deploy as `?` (ADR 20260812-diff-role-assumes-file-publishing-role). Everywhere else in the repo keeps its normal punctuation. The destructive-migration one (`scripts/check-migrations.mjs`, also run by `scripts/vercel-build.mjs` before `pnpm db:migrate`) refuses a `DROP`/rename/type-change in any migration newer than the previous release unless the SQL itself carries a `-- diveday:allow-destructive <rule> <table>.<column>: <why>` line — migrations apply inside the production build while the *previous* release is still serving, and there are no down migrations (ADR 20260806-destructive-migration-guard). The Open-Graph-site one (`scripts/check-open-graph.mjs`) refuses an `openGraph` block under `src/app` that does not spread `openGraphSite` (or `sharedLinkCard`, which contains it) — Next merges `metadata` shallowly, so a page-level block *replaces* the root layout's and silently takes `og:site_name`/`og:type` with it. Six pages were in that state before 2026-08-12, and the marketing surface had lost its card image the same way in 2026-08-03; the failure only renders in someone else's chat window, and the e2e route lists that assert the tags are hand-maintained, so a page added tomorrow is not on them. A route that genuinely must not name the site says `diveday:allow-bare-open-graph: <why>` |
| `pnpm check:follow-ups` | every entry in `docs/product/follow-ups/` — the register where you leave an idea, question, risk, or deliberately-skipped cleanup for the human to triage — is still actionable cold: dated ADR-style id, the four sections filled with real prose, `Touches:` paths that exist, and a fenced prompt long enough and specific enough to hand a session with none of your context. Closing an entry means deleting the file, never marking it done |
| `pnpm check:intl-cache` | every `Intl` formatter is built through `src/lib/intl-cache.ts`, never a bare `new Intl.*` at the call site. Constructing one costs ~12x reusing it (measured) and this app formats on essentially every render, so the constructor is a per-render tax that shows up as CI e2e flake under load. Regressed twice before it was checked — most recently as an `Intl.PluralRules` per interpolated message. `Intl.Locale` is exempt: a parsed locale value, not a compiled formatter |
| `pnpm check:e2e-hygiene` | no timing guesses in `e2e/`: `waitForTimeout` sleeps, `networkidle` waits, spec-level `retries:`, and hand-rolled retry loops are refused unless the line carries `diveday:allow-e2e-hygiene <rule>: <why>` naming the mechanism that makes it deterministic. The suite runs `retries: 0` so a flake fails loudly and gets root-caused; every one of these shapes converts a deterministic failure into an intermittent pass instead — the exact class a 2026-08-06 review stripped back out of the tree after their written justifications proved false. The fix for a race is always waiting for what the destination page itself renders (see the **debug** skill) |
| `pnpm check` | repository safeguards + lint + typecheck + unit tests — **the pre-commit bar** |
| `pnpm check:copy` | find hard-coded user-facing copy in `src/app`/`src/components`; `node scripts/check-copy.mjs --report <path>` lists it, `--write` banks a reduction, `--absorb` records growth arriving from a merge |
| `pnpm check:domain-strings` | find English sentences returned from `src/lib`/`src/db` (the `.message`/`_LABELS` leak — ADR 20260731-domain-layer-copy-leaks); same `--report <path>` / `--write` / `--absorb` as `check:copy` |
| `pnpm check:tokens` | find raw hex colors and palette-scale Tailwind classes in components (ADR-0004); ratcheted via `scripts/tokens-baseline.json`, same `--report <path>` / `--write` / `--absorb` as `check:copy`. Next metadata-file conventions (OG images, icons, manifest) are exempt by design — tokens can't reach a Satori bitmap |
| `pnpm check:architecture` | layer boundaries (now including `src/components`/`src/i18n`) and feature-module contracts; pre-existing debt is ratcheted in `scripts/architecture-baseline.json`, same `--write` / `--absorb` as `check:copy` |
| `pnpm check:timezone` | every `Intl.DateTimeFormat`/`toLocale*String` under `src/app`, `src/components`, `src/lib`, `src/db`, `src/features` names a `timeZone`. Omitting it renders in the **host** zone — UTC on every server and CI box — so a 7:30 AM departure silently reads 11:30 AM and no test on a UTC machine can tell. The `src/lib/format.ts` formatters take `timeZone` as a **required** parameter, so calls through them are already proven by `pnpm typecheck`; this covers code reaching for `Intl` directly. A deliberate `timeZone: "UTC"` passes — the rule is *name* a zone, not name the shop's, because a date-only value or a wall-clock time of day genuinely has no instant in it |
| `pnpm check:route-coverage` | every `src/app/**/page.tsx` route is listed in `scripts/route-coverage.json` with the `e2e/` specs and `e2e/visual.spec.ts` captures that cover it, or a written `exempt` reason for having neither. The coverage lists are hand-maintained (a spec usually *clicks* its way to a route, which no grep can see); `--write` regenerates only the mechanical facts and refuses to add an exemption or drop coverage, `--absorb` records a merge-in loss, `--report` prints the per-route table |
| `pnpm gates` | report (never a gate, never in `check`): days since each `docs/product/human-decisions.md` H-/V- row last moved, reconciled against `rollout.md`'s "next 30 days". Ages derived from dated outcomes in the rows and `git blame`, printed as `≥ N` when a shallow clone can only bound them. Nothing it reports is an agent's to close |
| `pnpm lint` / `pnpm lint:fix` | Biome check / autofix |
| `pnpm typecheck` | tsc |
| `pnpm test <file> --reporter=dot` | focused Vitest run with low-noise success output |
| `pnpm test:changed` | run only the tests affected by your diff against `origin/main` — a mid-iteration check across a handful of touched files; still run full `pnpm check` before commit. Selection follows the import graph, and migrations are read off disk rather than imported, so a change under `drizzle/` deliberately reruns the whole suite (`forceRerunTriggers` in `vitest.config.ts`) |
| `pnpm e2e <spec> --reporter=line` | use local Chromium, build, then run a focused Playwright suite |
| `pnpm e2e:run <spec> --reporter=line` | fast-iteration path: build once with `pnpm e2e:build`, then `pnpm e2e:run <spec> --reporter=line` reuses that build and skips the rebuild |
| `pnpm build` | production build |
| `pnpm db:generate` | generate a Drizzle migration after editing `src/db/schema.ts` (see the **schema-change** skill) |
| `pnpm db:reset` | clear the dev PGlite database; next `pnpm dev` re-migrates and re-seeds |
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
| Course pages (public content / staff roster + editor) | diver-facing `src/app/s/[shopSlug]/courses/**`; staff roster and editor `src/app/shop/[shopSlug]/courses/**`; content shapes and parsers in `src/lib/courses.ts`; DiveDay-published templates in `src/db/course-templates.ts`. The roster reads in **progression order** — `progressionOrder` in `src/db/courses.ts`, shared by `listCourses`/`listActiveCourses`/`pagedCourses` — never alphabetically, and the shop-built certification paths it replaced are gone (ADR 20260805-remove-certification-paths) |
| The staff schedule builder (add / move / copy / remove a departure) | `src/app/shop/[shopSlug]/schedule/board/_components/ScheduleBuilder.tsx` + `schedule/board/actions.ts`; the mutations and their refusals live in `src/db/trips-schedule.ts` (`moveTrip`, `duplicateTrip`, `deleteTrip`), still reached through the `@/db/trips` barrel. The add panel is also the **one place a trip is created**: "More options" discloses the full former `/trips/new` form in place (description, multi-day, deposit, cancellation window, repeat, per-dive plan), and `/shop/[shopSlug]/trips/new` is a 308 Route Handler to `schedule/board?add=full` carrying `?course=` (ADR 20260806-one-trip-create-form) |
| A repeating trip (every Saturday, Mon+Thu, daily) | cadence math in `src/lib/recurrence.ts` (framework-free, a pure `seriesOccurrenceDates`), materialization in `src/db/trips-series.ts`, nightly horizon roll at `src/app/api/cron/trip-series/`. A run has **no limit**: `trip_series.ends_on` null means it keeps going, and dates are materialized into a rolling `SERIES_HORIZON_DAYS` window. Every instance is an ordinary independent `trips` row — a deleted one leaves a `trip_series_skips` row so the roll never puts it back, and a moved one keeps its `series_occurrence_date` so the roll never re-fills the slot it left. The cadence is editable in place (`updateSeriesCadence`), and **narrowing one cancels nothing** — the orphaned dates are listed back with their head counts and taken off only on a second tap (ADR 20260810-open-ended-recurring-trips) |
| Staff surfaces (all `/shop/**`, auth-gated) | `src/app/shop/` |
| Where staff can go (nav tabs, the "More" menu/sheet, ⌘K "Go to") | one registry, `src/lib/staff-destinations.ts` — path, permission gate, badge source, nav group. `src/components/ShopNavLinks.tsx` (header tabs + the "More" menu), `src/components/StaffTabBar.tsx` (the phone dock, whose sixth slot opens the "More" bottom sheet), and `src/components/search/CommandPalette.tsx` all derive from it; `src/components/ShopNav.tsx` resolves the one label record they share, and `currentStaffNavDestinationId` is the one answer to "which row is current". Add a destination there, never to a consumer. **Five `primary` tabs; the dock's sixth slot is More and that is the ceiling** — a sixth destination tab means demoting one into the `daily`/`setup` groups, not growing the bar (ADR 20260813-more-is-the-shops-other-door). `src/components/ShopIdentityMenu.tsx` holds only the reader's own session (language, sign out) — never a place in the shop |
| SMS delivery receipts | `src/lib/notifications/sms-events.ts` + `src/app/api/webhooks/sms/`; the AWS-side pipeline is section 10 of `infra/lib/infra-stack.ts`; setup in [docs/engineering/sms-delivery-receipts-runbook.md](docs/engineering/sms-delivery-receipts-runbook.md) |
| Environment variables — adding one, or asking who supplies one | one registry, `config/env-registry.mjs`: per key, who produces it (`stack` / `derived` / `manual`), which destinations carry it, and what being absent costs. **A value this repository already knows is not configuration and does not go here** — DiveDay's own origin, sender, Connect client id and Sentry DSN are compiled in beside the code that reads them, behind `src/lib/configured.ts`, with their variables surviving only as overrides; the `constant` provenance that used to carry them is gone, because deploying a value the repo already knows is a round trip that can corrupt it, and once did (issue #517). Everything derives from it — `.env.example` is generated (`node scripts/render-env-example.mjs --write`), `.env.manual` is the only file a human edits, `.env.local`/`.env.vercel`/`.env.github` are generated from the credentials secret plus `.env.manual`, and nothing merges: a stack-produced key in `.env.manual` is refused, not ignored. Add a variable there and nowhere else (ADR 20260812-env-provenance-registry) |
| AWS credentials, and what deploying still leaves for a human | one Secrets Manager secret holding a filled-in `.env.example` (§16 of `infra/lib/infra-stack.ts`), and one registry of manual steps (§17) that renders to both stack outputs and the generated [docs/engineering/manual-actions.md](docs/engineering/manual-actions.md). Add a step to the registry, never to a runbook; regenerate with `pnpm test infra -u`. Reasoning lives in [docs/engineering/infrastructure-runbook.md](docs/engineering/infrastructure-runbook.md) |
| Logs, metrics, alarms, dashboards, and how fast the app feels | `src/lib/log.ts` writes the line and `src/lib/observability/` ships it to CloudWatch; browser Core Web Vitals arrive via `src/app/web-vitals-client.tsx` → `src/app/api/vitals/`, and CloudWatch RUM via `src/app/rum-client.tsx` — all telemetry mounts through the one `src/app/observability-client.tsx` so the capability-URL redaction cannot be bypassed. What is counted and alarmed is one registry, `infra/lib/observability.ts`, expanded in §13 of `infra/lib/infra-stack.ts`; add a signal there, never a graph at a call site. An `$.event` code and a vital's `field` are contracts a test reads out of `src/` — renaming one silently stops a metric filter counting. Setup, thresholds, cost and troubleshooting in [docs/engineering/cloudwatch-observability-runbook.md](docs/engineering/cloudwatch-observability-runbook.md) |
| Email: sending and delivery outcomes | `src/lib/notifications/` + `src/app/api/webhooks/ses/`; setup in [docs/engineering/ses-email-runbook.md](docs/engineering/ses-email-runbook.md). Mail *to* DiveDay is hosted mailboxes, not code |
| The Today work queue (ranking rules / assembly) | `src/lib/today.ts` / `src/db/today.ts`. The shop home renders it in one of two views chosen by `?view=` — **by urgency** (`src/app/shop/[shopSlug]/_components/today/TodayQueue.tsx`) or **by departure**, the old "Not ready" page folded in (`src/app/shop/[shopSlug]/_components/BlockerGroups.tsx`, grouping in `src/lib/blockers.ts` / `src/db/blockers.ts`). `/shop/[shopSlug]/blockers` is now a 308 to `?view=departures` (ADR 20260803-not-ready-is-a-view) |
| The end-of-day close-out (the "everyone is home" ritual) | assembly in `src/lib/closeout.ts`, facts + the append-only `day_closeouts` trail in `src/db/closeout.ts`, surface at `src/app/shop/[shopSlug]/close-out/`. Composes from Today's own readers — never a second detector; closing is a recorded act, never a gate (ADR 20260804-day-closeout). It is also where a departure's **log** is generated (`/shop/[shopSlug]/trips/[id]/log`, owner-only) — writing the day up is an evening act, so its door is here rather than in the manifest header a crew works at the rail |
| Buddy teams (who dives with whom, and the split-team alert) | writers and readers in `src/db/buddy-pairs.ts` (named for its table, `buddy_pair_members`; every word a human reads says "team"), the alert in `src/lib/manifests.ts` (`buddyAlertFor`, `splitBuddyTeamIds`), words in `src/i18n/buddy-labels.ts`, the team builder on `src/app/shop/[shopSlug]/trips/[id]/manifest/`. A team is two or more, a member is a booking **or** a crew person, and every act appends to `buddy_team_events` — informs, never gates (ADR 20260804-buddy-teams) |
| How demanding a dive site is | `dive_sites.difficulty_level`, one of three codes (`src/lib/dive-site-difficulty.ts`), worded by `src/i18n/dive-site-labels.ts` and chosen from a `<select>` beside `fit_tone`. Never free text — it renders to a diver and has to arrive in their language (ADR 20260813-dive-site-difficulty-is-a-code). `siteFit()` believes a chosen level outright and only falls back to its keyword sniff when there is none |
| Readiness words and tone ("Blocked" / "Ready", everywhere) | `src/i18n/readiness-labels.ts` — `readinessStatusText`/`readinessStatusTone`. Never spell a status inline in a surface |
| DB schema (source of truth — never read `drizzle/`) | `src/db/schema.ts` |
| DB client / test db factory | `src/db/client.ts` (`getDb()`, `createTestDb()`) |
| Queries and seed data | `src/db/shops.ts`, plus two barrels over sibling modules: `src/db/trips.ts` re-exports `trips-create/-series/-record/-schedule/-crew/-roster.ts`, and `src/db/seed.ts` orchestrates the `seed-*.ts` scenarios. Import from the barrel; edit the sibling |
| Adding demo/seed data | a new `src/db/seed-<scenario>.ts` plus one line in `src/db/seed.ts`'s orchestrator — never wedge rows into an existing scenario, which is how this file became the repo's top conflict magnet (ADR 20260803-seed-scenario-modules) |
| Retention / pruning of append-only tables | `src/lib/retention.ts` holds `RETENTION_DAYS` (the one table a human edits; the values are HD-11's call), `src/db/retention.ts` runs the bounded prune, `src/app/api/cron/retention/` is the weekly surface. The `stripe_webhook_events` window is asserted against Stripe's retry horizon, not merely commented |
| Whether a diver may *buy* a seat vs. *board* | two different gates, deliberately: **trip admission** (`src/lib/trip-admission.ts`, booking-time — "could this diver ever be cleared?") is weaker than **readiness** (`src/lib/readiness.ts`, boarding-time — "are they cleared now?"), and admission may never refuse someone readiness would clear. Both compose the same effective requirement via `getTripSiteRequirement` |
| The booking transaction (capacity enforcement) | `src/db/bookings.ts` — read its tests first |
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
| A dive site's briefing — what a diver reads, and which field writes it | Every sentence comes off the site row: `fit_tone`/`fit_note` for "Welcoming dive" and the line under it, `landmarks` as `{name, kind, note}` (parsed by `src/lib/dive-site-landmarks.ts`), `field_guide_tips_heading` for the "slow down" aside. The one exception is the **field guide**, which is a *selection* rather than a sentence: `dive_site_creatures` rows name catalog species (`src/lib/dive-site-field-guide.ts`) and the words on each card are DiveDay's, in both languages, resolved per reader by `src/i18n/marine-life-labels.ts` (ADR 20260813-marine-life-is-diveday-copy). All of it is written on the one form, `src/app/shop/[shopSlug]/dive-sites/_components/SiteFields.tsx` plus its two list editors. **Nothing on that page is DiveDay's words at render time** — the hard-coded landmark table and the canned fit sentences are gone (ADR 20260813-dive-site-briefings-are-the-shops-own-words) |
| Starting content a shop copies and then owns (site templates, courses) | `src/db/dive-site-templates.ts` (34 real Florida sites, published into the catalog by `src/db/seed-dive-site-catalog.ts`) and `src/db/course-templates.ts`. Both are `i18n-exempt-file`: picking one **copies** its words onto the shop's row, and nothing is read back at render, so a later correction never rewrites what a shop published. Browse and read a site template before taking it at `dive-sites?view=catalog&template=<slug>` |
| Species a shop *picks* but does not write (the field guide) | `src/db/marine-life-catalog.ts` — 148 wider-Caribbean species as slug + Latin binomial + category code, no prose, photos under `public/marine-life/` (add one with `node scripts/fetch-marine-life-photo.mjs <slug> --search "<Latin name>"`, which enforces the licence and writes the credit). The **opposite** contract to the two templates above and the line worth knowing: a shop chooses which faces a site shows and in what order, and DiveDay writes them once in every language (`marineLife.*` in `diver.json`, resolved by `src/i18n/marine-life-labels.ts`). A dive plan for one reef is the shop's to write; what a stoplight parrotfish looks like is not. `MARINE_LIFE_CATALOG` is `as const`, so a species added without its copy is a **compile** error (ADR 20260813-marine-life-is-diveday-copy). A species DiveDay does not carry is refused by the picker and the ask lands in `marine_life_requests` (`src/db/marine-life-requests.ts`) — a table nothing renders, queried directly when deciding what the catalog grows by |
| Domain logic (framework-free) | `src/lib/` — capacity in `trips.ts`, dates in `format.ts` |
| Feature modules | `src/features/<feature>/` — one `index.ts` is the whole public surface, `README.md` states what it owns; deep imports fail `pnpm check:architecture`. First one is `calendar-sync` (ADR 20260730-feature-module-contracts) |
| Staff calendar subscriptions (iCalendar feeds) | `src/features/calendar-sync/` + `src/app/calendar/[token]/route.ts`; staff UI at `src/app/shop/[shopSlug]/settings/calendar/` |
| Auth: edge config / providers / gates | `src/lib/auth.config.ts` / `auth.ts` / `authz.ts` + `session.ts`; edge layer in `src/proxy.ts`. `/shop/**` is staff-only end to end — there is no public-route allowlist any more |
| Dev/e2e staff logins | `src/db/dev-credentials.ts` |
| Design tokens | `src/app/globals.css` (semantic only, ADR-0004) |
| Form/button/control wrappers | `src/components/ui/` — `form.tsx` (`Field`, `FieldGrid`, `controlClass`), `button.ts` (`buttonClass`) |
| Where a form says what happened (refused, saved) | **Beside the form, never in a banner at the top of the page.** Field-level refusals go on the field (`Field`'s `error` prop, which wires `aria-invalid`/`aria-describedby` for you); form-level ones go in the action row (`FormStatus`) — both in `src/components/ui/form.tsx`, with `FieldErrorFocus` to move the cursor to the offending box. A page's `?notice=` is routed to the form that produced it by `noticeForForm` (`src/lib/staff-notices.ts`); the page banner is left for what is genuinely about the page. See [docs/design/forms-and-controls.md](docs/design/forms-and-controls.md) |
| Paging a staff list (prev / "Page 3 of 7" / next) | one component, `src/components/Pager.tsx`, words from the one `shared.pager.*` key set; one query shape, `offsetPage` in `src/db/paging.ts`. **Every paged staff list wears it** — orders, the by-departure view, divers, reports, reviews, the dive-site library and the published site catalog, courses, both promo lists, the waiver signature log, and the add-booking departure picker (ADR 20260803-one-pagination-model); a new paged list uses it from the start. Keyset cursors (`src/db/cursor.ts`) are the one earned exception — the schedule board pages a stream with no end to count. A list's **count must share the row query's exact scope** (joins, `where`, `having`, `now`), or the pager promises pages that render nothing |
| Why a route paints instantly (or doesn't) | Each page declares `export const instant = true` and owns a body-shaped `loading.tsx` — that file *is* the Suspense boundary, and what a client navigation into the segment paints. `instant = false` survives on exactly one shell, `src/app/shop/[shopSlug]/layout.tsx`, which cannot be instant because its cross-tenant `notFound()` must run before `{children}` (ADR 20260804-instant-navigation) |
| "What should this code do?" | Read `foo.test.ts` before `foo.ts` — tests are the contract |
| An idea, question, risk, or cleanup you are **not** doing in this change | one file per item in `docs/product/follow-ups/`, copied from its `TEMPLATE.md` — the human's triage inbox, not a backlog. Committed work still lives in `docs/product/features/`, human-owned calls in `docs/product/human-decisions.md` |

## Skills and providers

The canonical process is this file, `docs/`, scripts, and tests. Claude-specific playbooks are indexed
in [.claude/skills/README.md](.claude/skills/README.md): **new-feature**, **verify**, **i18n-copy**,
**design-review**, **brand-voice**, **schema-change**, **debug**, **instant-navigation**,
**e2e-and-visual**, **visual-triage**, **adr**,
**marketing-page**, **switching-pages**, and **commercial-outreach**.
Other providers
should read the corresponding `SKILL.md` directly when useful. If a skill conflicts with canonical
docs, tests, or code, the skill is stale and must be fixed in the same change.

## Parallel work

- Assume multiple work scopes can be in flight in this working directory at once — other
  sessions or terminals may have uncommitted changes, staged work, or a mid-rebase state at
  any time. Run `git status` before anything that touches shared working-tree state, not just
  before destructive commands.
- Before starting non-trivial work, list the repo's open PRs and read their declared owned
  paths. Overlap with your plan → pick a different slice or coordinate in that PR's thread;
  never assume you are the only session running.
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
- Before fixing a failing or flaky test, search open PRs for one that already touches the same
  spec or test name. Two sessions independently patching the same broken test race each other and
  produce conflicting fixes. If one is already in flight, coordinate in that PR's thread instead
  of pushing a second, competing fix.

## Hard rules

- **Verify before commit** — `pnpm check` green minimum; e2e when flows changed; *look at* UI
  you changed (screenshots, light + dark). Never report unverified work as done.
- **A thought you don't act on goes in the register, not in your closing message.** Finishing a
  change with an idea you left undone, a question only a human can answer, a risk you noticed in
  passing, or a cleanup you deliberately scoped out? File it as one file in
  [docs/product/follow-ups/](docs/product/follow-ups/README.md), in the same commit, and list it in
  the PR description. A closing message is read once and gone; that folder is where the human
  triages. Each entry is written for a reader with none of your context and ends with a prompt they
  can paste into a fresh session — see its `TEMPLATE.md`. This never replaces doing the work you
  were asked to do, and a failing test is never a follow-up (next rule). Nor is it a place to open
  a second front: never act on someone else's entry as a drive-by.
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
- **Screenshots are full-size and unfiltered; bound the *page*, not the capture.** A surface that
  screenshots enormous is telling you the page is unbounded, and the fix is pagination (or a
  default range) in the product, where a real shop benefits from it — never a `?filter=` in the
  spec that shrinks the picture and leaves users scrolling 17,000px. Narrowing a capture to make
  it cheap also silently narrows what it can catch. The orders index was found this way: 323
  seeded orders, no pager, no baseline at all.
- **Semantic tokens only** in components — no raw hex, no palette-scale classes (ADR-0004).
- **Forms and buttons go through the wrappers** — stacked fields via `<Field>`/`<FieldGrid>`,
  button-shaped things via `buttonClass()`, controls via `controlClass`. Hand-rolled class strings
  are how fields fall out of alignment and button labels drift off-center. See
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
- **Read time through the clock.** `src/lib`, `src/db`, and `src/features` never call `new Date()` / `Date.now()`
  directly — use `nowDate()` / `nowMs()` from `src/lib/clock.ts` (default a `now` parameter to it).
  This is what lets the e2e fleet freeze one instant so the clock-anchored seed and every render
  stay pixel-stable for visual regression; in production the clock is the native call, unchanged.
  `pnpm check:clock` enforces it. Never stabilise a visual test by masking moving text — freeze the
  clock at the Playwright harness boundary.
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
- **Secrets never enter the repo** — `.env*` is gitignored.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
