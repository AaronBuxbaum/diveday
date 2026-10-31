# The route map, in full

[AGENTS.md](../../AGENTS.md) carries the route-map rows nearly every session needs. These are the
rest: where each area lives, by what you need. Read this file when the task names an area
AGENTS.md's rows do not, before searching for it. Each row says *where*; the path-scoped rule in
`.claude/rules/` for that area says *how* and *why*, and loads when you open a matching file.
A row moves between here and AGENTS.md in one commit, never duplicated.

| You need | Go to |
| --- | --- |
| Public pages (landing, sign-in) | `src/app/` |
| An unknown public URL (a 404 that is really a 404) | refused in `src/proxy.ts` before the shell — the URL's shape first, then one existence read where no closed list settles it; a page's own `notFound()` is only the second layer. An unrecognised shape passes through untouched, so `src/app/edge-refusal-coverage.test.ts` fails on a dynamic public route not taught to `publicRouteShape` |
| Bearer-token pages (waiver signing, trip-prep "ready", recap, email verify, password reset, staff calendar feed) | `src/app/waivers/[token]`, `src/app/ready/[token]`, `src/app/recap/[token]`, `src/app/verify/[token]`, `src/app/reset-password/[token]`, `src/app/calendar/[token]` — the URL *is* the capability |
| Account lifecycle (sign-up welcome/verify, forgot/reset password) | `src/app/onboard/`, `src/app/forgot-password/`; tokens in `src/db/account-tokens.ts` / `src/lib/account-tokens.ts`; accounts in `src/db/user-accounts.ts` |
| Course pages (public content / staff roster + editor) | `src/app/s/[shopSlug]/courses/**` and `src/app/shop/[shopSlug]/courses/**`; content shapes in `src/lib/courses.ts`; templates in `src/content/course-templates.ts`; progression order in `src/db/courses.ts` |
| The staff schedule builder (add / move / copy / remove a departure) | `src/app/shop/[shopSlug]/schedule/board/_components/ScheduleBuilder.tsx` + `schedule/board/actions.ts`; mutations in `src/db/trips-schedule.ts`, reached through the `@/db/trips` barrel. The one place a trip is created |
| A repeating trip (every Saturday, Mon+Thu, daily) | `src/lib/recurrence.ts` (pure cadence math), `src/db/trips-series.ts` (materialization), nightly roll at `src/app/api/cron/trip-series/` |
| SMS delivery receipts | `src/lib/notifications/sms-events.ts` + `src/app/api/webhooks/sms/`; runbook [docs/engineering/sms-delivery-receipts-runbook.md](../engineering/sms-delivery-receipts-runbook.md) |
| Environment variables — adding one, or asking who supplies one | one registry, `config/env-registry.mjs`; everything else is generated from it (ADR 20260812-env-provenance-registry) |
| AWS credentials, and what deploying still leaves for a human | §16 and §17 of `infra/lib/infra-stack.ts`; [docs/engineering/infrastructure-runbook.md](../engineering/infrastructure-runbook.md). **Two stacks, one region knob**: mail is its own stack (`infra/lib/email-stack.ts`) and every region is `config/aws-regions.mjs` |
| Logs, metrics, alarms, dashboards, and how fast the app feels | `src/lib/log.ts`, `src/lib/observability/`, the one registry `infra/lib/observability.ts`; [docs/engineering/cloudwatch-observability-runbook.md](../engineering/cloudwatch-observability-runbook.md) |
| Email: sending and delivery outcomes | `src/lib/notifications/` + `src/app/api/webhooks/ses/`; [docs/engineering/ses-email-runbook.md](../engineering/ses-email-runbook.md) |
| The Today work queue, the day spine, the close-out | `src/lib/today.ts` / `src/db/today.ts`, `src/lib/closeout.ts` / `src/db/closeout.ts`; the spine in `_components/today/` |
| Buddy teams (who dives with whom, and the split-team alert) | `src/db/buddy-pairs.ts`, the alert in `src/lib/manifests.ts`, words in `src/i18n/buddy-labels.ts`, the builder on `src/app/shop/[shopSlug]/trips/[id]/manifest/` |
| Retention / pruning of append-only tables | `src/lib/retention.ts` (`RETENTION_DAYS`), `src/db/retention.ts`, `src/app/api/cron/retention/` |
| The gear register (the shop's own fleet, service clocks, reservations) | `src/lib/gear.ts`, `src/db/gear.ts`, `src/i18n/gear-labels.ts`, `src/app/shop/[shopSlug]/gear`; `pnpm task:context gear` |
| Staff seating a diver (the roster, walk-in counter, diver record, global Add-booking) | one consequence path: `src/db/seat-diver.ts`, driven by `src/app/actions/seat-diver.ts`; the global door is `src/app/shop/[shopSlug]/bookings/new` |
| Payments, orders, discount codes (Stripe Connect) | `src/lib/payments/`; state in `src/db/orders.ts`, `payments.ts`, `checkouts.ts`, `refunds.ts`, `stripe-accounts.ts`; codes in `src/lib/promo-codes.ts` + `src/db/shop-promos.ts`, deals in `src/db/trip-promos.ts` |
| The back-office queues (unconfirmed Stripe calls, deletions that never finished) | with the object each is about — the Orders index and Settings' "Data" group — never on Reports |
| A diver asking for a day that is not on the board | `src/components/DateRequestForm.tsx`, `src/app/actions/inquiry.ts`, `src/db/interests.ts` (`askForDate`), `src/db/interest-dates.ts`, `src/lib/date-requests.ts`, staff at `src/app/shop/[shopSlug]/requests` |
| Diver reviews and ratings | `src/lib/reviews.ts` + `src/db/reviews.ts`; written from `/recap/[token]`, moderated at `shop/[shopSlug]/reviews` |
| SEO structured data, `og:site_name`, link-preview cards | `src/lib/structured-data.ts` + `src/components/JsonLd.tsx`; `openGraphSite` in `src/lib/site-metadata.ts`; `allowSvgRasterization()` in `src/lib/og-rasterizer.ts` before every `ImageResponse` |
| Notifications (email/SMS/WhatsApp) | `src/lib/notifications/`; `courtesy.ts` picks the channel; state in `src/db/notifications.ts`; a shop's own WhatsApp sender in `whatsapp-signup.ts` + `src/app/shop/[shopSlug]/settings/whatsapp/` |
| Data portability (CSV export/import), scheduled backups | `src/db/export.ts` / `src/db/import.ts`, `src/features/backup-export/`; staff UI under `src/app/shop/[shopSlug]/settings/` — security-sensitive, see hard rules |
| Offline boat manifests | `src/lib/offline-manifests.ts` + `offline-manifest-store.ts`; viewer `src/app/offline-manifest/`; worker `src/worker/manifest-sw.ts` |
| A dive site's briefing — what a diver reads, and which field writes it | `dive-sites/_components/SiteFields.tsx` writes it; `src/components/SiteBriefing.tsx` renders it on site and trip pages; the field guide is `src/lib/dive-site-field-guide.ts` + `src/i18n/marine-life-labels.ts` |
| Starting content a shop copies, and species it picks | `src/content/dive-site-templates.ts`, `src/content/course-templates.ts` (copied, then the shop's); `src/db/marine-life-catalog.ts` (DiveDay's words); photos by `pnpm content:photos` |
| Feature modules | `src/features/<feature>/` — `index.ts` is the whole public surface; `calendar-sync`, `backup-export`, `integrations` |
| Outbound integrations a shop connects for itself (Shopify, QuickBooks, Zapier) | `src/features/integrations/`; rows in `src/db/integrations.ts` + `src/db/integration-events.ts`; staff at `src/app/shop/[shopSlug]/settings/integrations`; callbacks under `src/app/api/integrations/` |
| A Claude assist (a draft, a sort, a value read off a card or a website) | `runAssist` / `assistsAvailable` in `src/db/assists.ts`; the seam in `src/lib/claude/` (`callStructured`, `webFetchTool`, models and prices); on screen `src/components/assists/AssistDraftButton.tsx`; fake in `src/test/fakes.ts`; ADR 20261018-claude-assists |
| Staff calendar subscriptions (iCalendar feeds) | `src/features/calendar-sync/` + `src/app/calendar/[token]/route.ts`; staff UI at `src/app/shop/[shopSlug]/settings/calendar/` |
| Dev/e2e staff logins | `src/db/dev-credentials.ts` |
| Why a route paints instantly (or doesn't) | its `loading.tsx` and `export const instant = true` (ADR 20260804-instant-navigation; the **instant-navigation** skill) |
| A design for a surface that does not exist yet | [docs/design/design-artifacts.md](../design/design-artifacts.md) first; canvases in `docs/design/canvases/` |
| DB client / test db factory | `src/db/client.ts` (`getDb()`, `createTestDb()`) |
| Domain logic (framework-free) | `src/lib/` — capacity in `trips.ts`, dates in `format.ts` |
| A domain term, or an ADR | `docs/product/glossary/` by domain; ADRs indexed in `docs/architecture/decisions/README.md` (generated; the guard names the command) |
| Auth: session, gates, edge check | `src/lib/auth.ts` / `auth-secret.ts` / `authz.ts` + `session.ts`; edge layer `src/proxy.ts` |
