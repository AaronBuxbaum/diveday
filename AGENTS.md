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
| `pnpm check:env` | validate `.env.local` when present; local fallbacks make the file optional |
| `pnpm check:repo` | environment, architecture/feature-module, design-token, clock, ADR, doc-link, locale-coverage, hard-coded-copy, domain-layer-copy, route-coverage, and agent-layer (skills/index/task-context) safeguards |
| `pnpm check` | repository safeguards + lint + typecheck + unit tests — **the pre-commit bar** |
| `pnpm check:copy` | find hard-coded user-facing copy in `src/app`/`src/components`; `node scripts/check-copy.mjs --report <path>` lists it, `--write` banks a reduction, `--absorb` records growth arriving from a merge |
| `pnpm check:domain-strings` | find English sentences returned from `src/lib`/`src/db` (the `.message`/`_LABELS` leak — ADR 20260731-domain-layer-copy-leaks); same `--report <path>` / `--write` / `--absorb` as `check:copy` |
| `pnpm check:tokens` | find raw hex colors and palette-scale Tailwind classes in components (ADR-0004); ratcheted via `scripts/tokens-baseline.json`, same `--report <path>` / `--write` / `--absorb` as `check:copy`. Next metadata-file conventions (OG images, icons, manifest) are exempt by design — tokens can't reach a Satori bitmap |
| `pnpm check:architecture` | layer boundaries (now including `src/components`/`src/i18n`) and feature-module contracts; pre-existing debt is ratcheted in `scripts/architecture-baseline.json`, same `--write` / `--absorb` as `check:copy` |
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
| Course pages (public content / staff roster + editor) | diver-facing `src/app/s/[shopSlug]/courses/**`; staff roster, path builder, and editor `src/app/shop/[shopSlug]/courses/**`; content shapes and parsers in `src/lib/courses.ts`; DiveDay-published templates in `src/db/course-templates.ts` |
| Certification paths (the catalog's progressions) | `src/db/course-paths.ts`; diver-facing `src/app/s/[shopSlug]/courses/paths/**`, staff builder `src/app/shop/[shopSlug]/courses/paths/**`. Guidance, never a gate — admission stays on each course's `minimum_certification_level` |
| The staff schedule builder (add / move / copy / remove a departure) | `src/app/shop/[shopSlug]/schedule/board/_components/ScheduleBuilder.tsx` + `schedule/board/actions.ts`; the mutations and their refusals live in `src/db/trips-schedule.ts` (`moveTrip`, `duplicateTrip`, `deleteTrip`), still reached through the `@/db/trips` barrel |
| Staff surfaces (all `/shop/**`, auth-gated) | `src/app/shop/` |
| Where staff can go (nav tabs, ⌘K "Go to", `g`-key shortcuts) | one registry, `src/lib/staff-destinations.ts` — path, permission gate, badge source, shortcut key, nav group. `src/components/ShopNavLinks.tsx`, `src/components/search/CommandPalette.tsx`, and the shortcut sheet all derive from it; `src/components/ShopNav.tsx` resolves the one label record they share. Add a destination there, never to a consumer |
| SMS delivery receipts | `src/lib/notifications/sms-events.ts` + `src/app/api/webhooks/sms/`; the AWS-side pipeline is section 10 of `infra/lib/infra-stack.ts`; setup in [docs/engineering/sms-delivery-receipts-runbook.md](docs/engineering/sms-delivery-receipts-runbook.md) |
| Email: sending and delivery outcomes | `src/lib/notifications/` + `src/app/api/webhooks/ses/`; setup in [docs/engineering/ses-email-runbook.md](docs/engineering/ses-email-runbook.md). Mail *to* DiveDay is hosted mailboxes, not code |
| The Today work queue (ranking rules / assembly) | `src/lib/today.ts` / `src/db/today.ts`. The shop home renders it in one of two views chosen by `?view=` — **by urgency** (`src/components/today/TodayQueue.tsx`) or **by departure**, the old "Not ready" page folded in (`src/app/shop/[shopSlug]/_components/BlockerGroups.tsx`, grouping in `src/lib/blockers.ts` / `src/db/blockers.ts`). `/shop/[shopSlug]/blockers` is now a 308 to `?view=departures` (ADR 20260803-not-ready-is-a-view) |
| The end-of-day close-out (the "everyone is home" ritual) | assembly in `src/lib/closeout.ts`, facts + the append-only `day_closeouts` trail in `src/db/closeout.ts`, surface at `src/app/shop/[shopSlug]/close-out/`. Composes from Today's own readers — never a second detector; closing is a recorded act, never a gate (ADR 20260804-day-closeout) |
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
| Discount codes | shop-wide in `src/lib/promo-codes.ts` + `src/db/shop-promos.ts` (staff page `shop/[shopSlug]/promos`); one-trip last-minute deals stay in `src/db/trip-promos.ts`. Both resolve in `bookSpot`; Stripe owns the arithmetic |
| Diver reviews and ratings | `src/lib/reviews.ts` + `src/db/reviews.ts`; written from `/recap/[token]`, moderated at `shop/[shopSlug]/reviews`, displayed on the public schedule (`/s/[shopSlug]`) |
| Copy and languages | `src/i18n/` — diver messages in `locales/<locale>/diver.json` (`diverTranslator`, `DiverIntlProvider` + `useTranslations()` for Client Components), staff messages in `staff.json` (`staffTranslator`, **server-side only** — staff Client Components take words as props). `requestTranslator()`/`requestLocale()` negotiate from `Accept-Language`, falling back to `shops.default_locale`. No switcher and no `[locale]` route by design. `pnpm check:locale` enforces translation coverage; `pnpm check:copy` blocks new hard-coded copy. **Any diver Client Component that reads copy needs `DiverIntlProvider` above it** — without one it throws during the server render and the whole page silently degrades to a blank client-only 200. That is no longer tribal knowledge: `src/i18n/provider-coverage.test.ts` fails on a consumer with no provider in an ancestor segment, or a provider whose `namespaces` list is short. Spanish strings: read `src/i18n/locales/es-ES/README.md` first — terminology and register are already decided |
| SEO structured data | `src/lib/structured-data.ts` + `src/components/JsonLd.tsx`; never in `?embed=1` mode or on a bearer-token page |
| Link-preview cards and icons (`ImageResponse`) | the five `opengraph-image.tsx` plus `icon.tsx`/`apple-icon.tsx`. **Every one calls `allowSvgRasterization()` (`src/lib/og-rasterizer.ts`) before building its `ImageResponse`** — `next/image`'s optimizer disables libvips' SVG loader process-wide on first use, and satori's output is SVG, so without it the card throws mid-stream and severs the socket rather than returning an error (ADR 20260804-og-svg-rasterizer) |
| Notifications (email/SMS/WhatsApp) | `src/lib/notifications/` (SES email adapter, SNS SMS adapter, Meta Cloud API WhatsApp adapter); `courtesy.ts` picks WhatsApp-or-SMS; delivery/retry state in `src/db/notifications.ts` |
| A shop's own WhatsApp sender | Onboarding via Meta Embedded Signup in `src/lib/notifications/whatsapp-signup.ts` + `src/app/shop/[shopSlug]/settings/whatsapp/`; rows in `src/db/whatsapp-accounts.ts`, tokens sealed by `src/lib/secret-box.ts`; delivery statuses in `src/app/api/webhooks/whatsapp/`; setup in [docs/engineering/whatsapp-cloud-api-runbook.md](docs/engineering/whatsapp-cloud-api-runbook.md) |
| Data portability (CSV export/import) | `src/db/export.ts` / `src/db/import.ts`; staff UI at `src/app/shop/[shopSlug]/settings/import/` — security-sensitive, see hard rules |
| Scheduled backup to shop-owned storage | `src/features/backup-export/` (bundle assembly, sealed credentials, SigV4 upload, delivery ledger); weekly cron `src/app/api/cron/backup-export/`; staff UI `src/app/shop/[shopSlug]/settings/backup/` — security-sensitive like export, see hard rules (ADR 20260804-shop-owned-backup-export) |
| Offline boat manifests | `src/lib/offline-manifests.ts` + `offline-manifest-store.ts` (encrypted IndexedDB); viewer at `src/app/offline-manifest/` |
| Domain logic (framework-free) | `src/lib/` — capacity in `trips.ts`, dates in `format.ts` |
| Feature modules | `src/features/<feature>/` — one `index.ts` is the whole public surface, `README.md` states what it owns; deep imports fail `pnpm check:architecture`. First one is `calendar-sync` (ADR 20260730-feature-module-contracts) |
| Staff calendar subscriptions (iCalendar feeds) | `src/features/calendar-sync/` + `src/app/calendar/[token]/route.ts`; staff UI at `src/app/shop/[shopSlug]/settings/calendar/` |
| Auth: edge config / providers / gates | `src/lib/auth.config.ts` / `auth.ts` / `authz.ts` + `session.ts`; edge layer in `src/proxy.ts`. `/shop/**` is staff-only end to end — there is no public-route allowlist any more |
| Dev/e2e staff logins | `src/db/dev-credentials.ts` |
| Design tokens | `src/app/globals.css` (semantic only, ADR-0004) |
| Form/button/control wrappers | `src/components/ui/` — `form.tsx` (`Field`, `FieldGrid`, `controlClass`), `button.ts` (`buttonClass`) |
| Paging a staff list (prev / "Page 3 of 7" / next) | one component, `src/components/Pager.tsx`, words from the one `shared.pager.*` key set; one query shape, `offsetPage` in `src/db/paging.ts`. **Every paged staff list wears it** — orders, the by-departure view, divers, reports, reviews, the dive-site library and the published site catalog, courses, both promo lists, the waiver signature log, and the add-booking departure picker (ADR 20260803-one-pagination-model); a new paged list uses it from the start. Keyset cursors (`src/db/cursor.ts`) are the one earned exception — the schedule board pages a stream with no end to count. A list's **count must share the row query's exact scope** (joins, `where`, `having`, `now`), or the pager promises pages that render nothing |
| Why a route paints instantly (or doesn't) | Each page declares `export const instant = true` and owns a body-shaped `loading.tsx` — that file *is* the Suspense boundary, and what a client navigation into the segment paints. `instant = false` survives on exactly one shell, `src/app/shop/[shopSlug]/layout.tsx`, which cannot be instant because its cross-tenant `notFound()` must run before `{children}` (ADR 20260804-instant-navigation) |
| "What should this code do?" | Read `foo.test.ts` before `foo.ts` — tests are the contract |

## Skills and providers

The canonical process is this file, `docs/`, scripts, and tests. Claude-specific playbooks are indexed
in [.claude/skills/README.md](.claude/skills/README.md): **new-feature**, **verify**, **i18n-copy**,
**design-review**, **brand-voice**, **schema-change**, **debug**, **e2e-and-visual**, **visual-triage**, **adr**,
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
- **Copy comes from a message bundle, never a component.** Diver copy in
  `src/i18n/locales/<locale>/diver.json`, staff copy in `staff.json`. `pnpm check:copy` is a
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
