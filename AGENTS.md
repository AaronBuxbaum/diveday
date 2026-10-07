# DiveDay — agent guide

Delight-first dive shop operations: **bookings, waivers, cert checks, trip prep, boat manifests**.
Competitors have the features; we win on experience. AI agents are the developers. This file,
`.claude/rules/`, `docs/`, scripts, and tests are the provider-neutral source of truth;
provider-specific folders are adapters and must not introduce unique requirements.

## Read first

1. This file — the rules every session needs whatever it touches.
2. The **path-scoped rules** in `.claude/rules/`: one file per area (`db`, `domain`, `surfaces`,
   `i18n`, `e2e`, `infra`, `docs`, `scripts`), each the rules and route map for the paths its
   `paths:` frontmatter names. Claude Code loads one when you read a matching file; another
   provider reads the one for the paths it will touch. Nothing in them is optional.
3. `pnpm task:context <area>` when the task matches an area (no argument lists them).
4. [docs/README.md](docs/README.md), and only the documents relevant to the task.
5. The Next.js warning at the bottom before framework-touching work.

## Context economy

- Never read `pnpm-lock.yaml`, generated `drizzle/`, `.next/`, `playwright-report/`, or
  `test-results/` whole; Grep them for the one line a diagnosis needs. The session hooks refuse the
  whole-file form at both doors (`Read` and the shell).
- Locate symbols with Grep and read the narrow range; `scripts/guard-read.mjs` refuses a
  whole-file `Read` of a file over 900 lines, and an explicit `offset` or `limit` always passes.
- Read `foo.test.ts` before `foo.ts`: tests are the contract.
- Iterate with one focused test and quiet output. The whole suite belongs to CI; the shell guard
  refuses a bare `pnpm test` / `pnpm e2e` / `pnpm check`.
- Redirect a long run to a file and read the failing part; never pipe it through `tail`.
- Send a broad search or a verbose run to a subagent; the `Explore` agent does not load this file.

## Commands

| Command | What |
| --- | --- |
| `pnpm dev` | dev server at localhost:3000; wait for **`dev: serving … — warmed in Ns`**, not Next's `✓ Ready`. One per checkout (the **run** skill) |
| `pnpm task:context <area>` | bounded paths, invariants, and validation for a task |
| `pnpm test <file> --reporter=dot` | focused Vitest run |
| `pnpm test:changed` | before you push: the tests your diff reaches. After a `src/db/schema.ts` edit, run the schema guards by path instead |
| `pnpm typecheck` | tsc |
| `pnpm lint` / `pnpm lint:fix` | Biome check / autofix |
| `pnpm check:repo` | 48 static guards, concurrently; each names itself and the offending line. The *why* of each: [docs/agents/repo-checks.md](docs/agents/repo-checks.md) |
| `pnpm e2e <spec> --reporter=line` | build, then one Playwright spec; `pnpm e2e:run <spec>` reuses a `pnpm e2e:build` |
| `pnpm db:generate` | a Drizzle migration after editing `src/db/schema.ts` (the **schema-change** skill) |
| `node scripts/screenshot.mjs <path…>` | phone and desktop PNGs of a page against a running `pnpm dev` |

The rest (`pnpm check`, `check:context-budget`, `gates`, `agent:health`, `visual`, `build`,
`db:reset`, each guard by name, the session hooks) are in `package.json`,
[docs/agents/verifying.md](docs/agents/verifying.md) and
[docs/agents/working-rules.md](docs/agents/working-rules.md#commands). Pass args to a `pnpm`
script directly, never after a literal `--`, which silently runs the whole suite; the shell guard
refuses it.

## Route map (don't re-derive this)

The rows below say *where*; the path-scoped rule for that area says *how* and *why*, and loads
when you open the file.

| You need | Go to |
| --- | --- |
| Public pages (landing, sign-in) | `src/app/` |
| A shop's diver-facing pages (schedule, booking, courses) | `src/app/s/[shopSlug]/**` — no auth anywhere in it; paths from `src/lib/public-routes.ts`. `/shop/**` is staff, without exception |
| An unknown public URL (a 404 that is really a 404) | refused in `src/proxy.ts` before the shell — the URL's shape first, then one existence read where no closed list settles it; a page's own `notFound()` is only the second layer. An unrecognised shape passes through untouched, so `src/app/edge-refusal-coverage.test.ts` fails on a dynamic public route not taught to `publicRouteShape` |
| Where a diver can go on a shop's public pages | `src/components/PublicShopNav.tsx`, assembled in `src/app/s/[shopSlug]/layout.tsx` — never a per-page cross-link |
| Bearer-token pages (waiver signing, trip-prep "ready", recap, email verify, password reset, staff calendar feed) | `src/app/waivers/[token]`, `src/app/ready/[token]`, `src/app/recap/[token]`, `src/app/verify/[token]`, `src/app/reset-password/[token]`, `src/app/calendar/[token]` — the URL *is* the capability |
| Account lifecycle (sign-up welcome/verify, forgot/reset password) | `src/app/onboard/`, `src/app/forgot-password/`; tokens in `src/db/account-tokens.ts` / `src/lib/account-tokens.ts`; accounts in `src/db/user-accounts.ts` |
| Course pages (public content / staff roster + editor) | `src/app/s/[shopSlug]/courses/**` and `src/app/shop/[shopSlug]/courses/**`; content shapes in `src/lib/courses.ts`; templates in `src/db/course-templates.ts`; progression order in `src/db/courses.ts` |
| The staff schedule builder (add / move / copy / remove a departure) | `src/app/shop/[shopSlug]/schedule/board/_components/ScheduleBuilder.tsx` + `schedule/board/actions.ts`; mutations in `src/db/trips-schedule.ts`, reached through the `@/db/trips` barrel. The one place a trip is created |
| A repeating trip (every Saturday, Mon+Thu, daily) | `src/lib/recurrence.ts` (pure cadence math), `src/db/trips-series.ts` (materialization), nightly roll at `src/app/api/cron/trip-series/` |
| Staff surfaces (all `/shop/**`, auth-gated) | `src/app/shop/` |
| Where staff can go (the sidebar, the phone tab bar, ⌘K "Go to") | one registry of sections, `src/lib/staff-destinations.ts`; two consumers — `src/components/ShopSectionNav.tsx`, `src/components/search/CommandPalette.tsx` |
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
| Staff seating a diver (the roster, walk-in counter, diver record, global Add-booking) | one consequence path: `src/db/seat-diver.ts`, driven by `src/app/actions/seat-diver.ts`; the global door is `src/app/shop/[shopSlug]/bookings/new` |
| Payments, orders, discount codes (Stripe Connect) | `src/lib/payments/`; state in `src/db/orders.ts`, `payments.ts`, `checkouts.ts`, `refunds.ts`, `stripe-accounts.ts`; codes in `src/lib/promo-codes.ts` + `src/db/shop-promos.ts`, deals in `src/db/trip-promos.ts` |
| The back-office queues (unconfirmed Stripe calls, deletions that never finished) | with the object each is about — the Orders index and Settings' "Data" group — never on Reports |
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
| An idea, question, risk, or cleanup you are **not** doing in this change | a GitHub issue labelled `needs-triage` ([docs/agents/issue-tracker.md](docs/agents/issue-tracker.md)'s "Filing a follow-up"), `waiting-on-external` when nobody here can move it. Committed work lives in `docs/product/features/`, human-owned calls in `docs/product/human-decisions/README.md` |

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

Other sessions share this checkout. The full statement of each rule:
[docs/agents/working-rules.md](docs/agents/working-rules.md#parallel-work).

- Read the branch and dirty count every prompt opens with before touching shared working-tree
  state; the shell guard refuses a wholesale discard on a dirty tree.
- **Claim the issue before you start**: the `in-progress` label and a `## Claim` comment naming
  branch, worktree, start time and owned paths; clear it when you stop
  ([docs/agents/issue-tracker.md](docs/agents/issue-tracker.md)'s "Claiming an issue").
- Before non-trivial work read the open PRs and `pnpm gates`' "Claimed — in flight"; on overlap
  pick another slice. A **stale** claim is a dead session: take the work.
- Never bare `git stash` / `git stash pop` (the shell guard refuses both); prefer a worktree, then
  a WIP commit, then `git stash push -u -m "<tag>"` applied by sha.
- A unique branch slug and an early draft PR naming owned paths, schema changes and ADR ids; ADR
  ids are `YYYYMMDD-short-slug`, never the next integer. Trial-merge the target before calling
  work complete.
- **Stack by default**: cut every branch from the one you opened last while it is still open,
  related or not, pixels included; open each as a draft at its first commit with `base` on the
  branch below; never independent PRs off `main`. The **stacked-prs** skill has the mechanics and
  the exceptions.

## Hard rules

One line each, with what enforces it; the full statement and its incident:
[docs/agents/working-rules.md](docs/agents/working-rules.md#hard-rules).

- **A background job you start is yours to end**; check with
  `node scripts/stray-processes.mjs --list`, never `TaskList`, and never pipe a long run through
  `tail`/`head` (`Stop` hook `scripts/stray-processes.mjs`, `scripts/guard-bash.mjs`).
- **Verify before commit; CI runs anything whole.** Yours: the guard you touched,
  `pnpm test <file>`, `pnpm typecheck`, `pnpm lint`, one e2e spec, `pnpm test:changed` before you
  push; *look at* UI you changed. Never report unverified work as done
  ([docs/agents/verifying.md](docs/agents/verifying.md)).
- **A thought you don't act on is a `needs-triage` issue**, ending in a prompt a fresh session can
  paste (`pnpm check:follow-ups`; [issue-tracker.md](docs/agents/issue-tracker.md)'s "Filing a follow-up").
- **A failing or flaky test is part of the work**, even when unrelated: never skipped, never a
  wider timeout; search open PRs for a fix in flight first (`pnpm check:e2e-hygiene`).
- **A pushed PR is not done until its visual diffs are explained** (the **visual-triage** skill)
  **and every review thread is fixed, declined with a reason, or filed**.
- **New runtime dependency → ADR** (`pnpm check:adrs`); **new domain concept → glossary**
  (`pnpm check:glossary`); **invalidated doc → fixed in the same PR** (`pnpm check:docs`).
- **Safety-critical surfaces** (manifests, roll call, cert gating, medical flags) get boring code,
  adversarial tests and a `dive-domain-expert` review; **security-sensitive changes** (auth, tokens,
  personal or medical data, export/import) a `security-reviewer` review.
- **`app → features → lib/db`, one way; routes stay thin** (`pnpm check:architecture`).
- **Tests travel with behavior**: a bug fix starts with a failing regression test; every important
  flow gets an `e2e/` spec and every important surface a capture in `e2e/visual.spec.ts`
  (`pnpm check:route-coverage`).
- **Copy from a bundle; every sentence earns its place; every delete is soft and says "Delete"; a
  date names its zone and no locale is hard-coded; time comes from the clock; a new page ships a
  `loading.tsx`**: the path-scoped rules, enforced by `pnpm check:repo`.
- **There is no legacy. Delete it** (H-49; `.claude/rules/db.md`).
- **Text a human will copy is written unwrapped** (`.claude/rules/docs.md`).
- **A turn ends done, filed, or handed over**, or on a question; never on an intention. Two items
  in flight go in the task list (`Stop` hooks `scripts/unfinished-promises.mjs`,
  `scripts/unpushed-work.mjs`).
- **Secrets never enter the repo** (`.claude/settings.json` denies key material to the file tools).

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
