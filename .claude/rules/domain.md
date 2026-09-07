---
paths:
  - "src/lib/**"
  - "src/features/**"
---

# Rules for `src/lib/` and `src/features/`

Framework-free domain logic and the feature modules. Loaded when a file under these paths is
read; the universal rules stay in `AGENTS.md`.

## Where things are

- **Domain logic**: `src/lib/` — capacity in `trips.ts`, dates in `format.ts`.
- **Whether a diver may *buy* a seat vs. *board***: two different gates, deliberately. **Trip
  admission** (`src/lib/trip-admission.ts`, booking-time — "could this diver ever be cleared?") is
  weaker than **readiness** (`src/lib/readiness.ts`, boarding-time — "are they cleared now?"), and
  admission may never refuse someone readiness would clear. Both compose the same effective
  requirement via `getTripSiteRequirement`.
- **Payments and orders** (Stripe Connect): `src/lib/payments/` (checkout, connect, invoicing,
  promotions, webhook); order/refund state in `src/db/orders.ts`, `payments.ts`, `checkouts.ts`,
  `refunds.ts`, `stripe-accounts.ts`. Discount codes: shop-wide in `src/lib/promo-codes.ts` +
  `src/db/shop-promos.ts`; one-trip last-minute deals in `src/db/trip-promos.ts`. Both resolve in
  `bookSpot`; Stripe owns the arithmetic.
- **The Today work queue**: `src/lib/today.ts` / `src/db/today.ts`. `assembleDaySpine` re-files what
  `getTodayWork` ranked; no second detector. The end-of-day close-out composes from Today's own
  readers (`src/lib/closeout.ts`, `src/db/closeout.ts`) — never a second detector; closing is a
  recorded act, never a gate (ADR 20260804-day-closeout).
- **Notifications**: `src/lib/notifications/` (SES email, SNS SMS, Meta Cloud API WhatsApp);
  `courtesy.ts` picks WhatsApp-or-SMS; delivery/retry state in `src/db/notifications.ts`. A shop's
  own WhatsApp sender: `whatsapp-signup.ts`, tokens sealed by `src/lib/secret-box.ts`.
- **Offline manifests**: `src/lib/offline-manifests.ts` + `offline-manifest-store.ts` (encrypted
  IndexedDB); worker `src/worker/manifest-sw.ts`. Two API routes, deliberately not one:
  `api/offline-manifests/upcoming` answers with the whole 48-hour board, `identity` answers
  `{ shop: { slug } }` and nothing else. Both `no-store`; both read through the response types in
  `offline-manifests.ts`, never an inline cast (ADR 20260726-shopwide-offline-manifest-priming).
- **Dive-site difficulty**: `dive_sites.difficulty_level`, one of three codes
  (`src/lib/dive-site-difficulty.ts`), worded by `src/i18n/dive-site-labels.ts`. Never free text
  (ADR 20260813-dive-site-difficulty-is-a-code). `siteFit()` believes a chosen level outright and
  only falls back to its keyword sniff when there is none.
- **Recurrence**: `src/lib/recurrence.ts` is a pure `seriesOccurrenceDates`; materialization lives in
  `src/db/trips-series.ts` (see the db rules).
- **Retention windows**: `src/lib/retention.ts` — `RETENTION_DAYS` is the one table a human edits.
- **Course content**: shapes and parsers in `src/lib/courses.ts`. A depth in course prose is a
  **marker**, not words: `{depth18}` reads "18 meters" or "60 feet" by the shop's `depth_unit`,
  resolved once per page by `resolveCourseContentDepths` as a lookup into the agency pairs. A
  *broken* marker is refused when the editor saves (`courseDepthPlaceholderIssues`), never rendered
  — shop prose deliberately never touches ICU (ADR 20260814-course-depth-markers).
- **Auth**: `src/lib/auth.ts` (better-auth + credentials plugin) / `auth-secret.ts` / `authz.ts` +
  `session.ts`; edge layer in `src/proxy.ts`. `/shop/**` is staff-only end to end — there is no
  public-route allowlist any more. The proxy is convenience, not the security boundary.
- **Staff destinations**: one registry, `src/lib/staff-destinations.ts` — path, permission gate,
  badge source, nav group. Every nav consumer derives from it. **Five `primary` tabs; the dock's
  sixth slot is More and that is the ceiling** (ADR 20260813-more-is-the-shops-other-door).
- **Staff notices**: `src/lib/staff-notices.ts` — `noticeUrl(path, code, extra?)` writes,
  `noticeFromParam` reads, `shopPath(slug, ...segments)` builds. `noticeUrl` percent-encodes every
  value, merges `&bid=`/`&count=`/`&form=`, keeps an existing query and `#fragment`, and normalises
  the code to kebab; `shopPath` escapes each segment, which is what stops a client-supplied slug
  traversing out of `/shop/`. Codes are enforced kebab by `pnpm check:repo`; never hand-build the
  string.
- **SEO**: `src/lib/structured-data.ts`; `openGraphSite` in `src/lib/site-metadata.ts` (see the
  surfaces rules for why every page with an `openGraph` block spreads it).
- **Feature modules**: `src/features/<feature>/` — one `index.ts` is the whole public surface,
  `README.md` states what it owns; deep imports fail `pnpm check:architecture` (ADR
  20260730-feature-module-contracts). `calendar-sync`, `backup-export` and `integrations` exist.
  Integrations: one registry (`registry.ts`) names each provider and its event types,
  `dispatcher.ts` drains the outbox, one adapter per provider; a Zapier hook URL is pinned to
  `hooks.zapier.com` over https — never an arbitrary host.

## Dependency direction

`app → features → lib/db`, one way, enforced by `pnpm check:architecture`: `src/lib`/`src/db` may
import neither `src/app` nor `src/features`. Routes stay thin; the rules live here.

## Read time through the clock

`src/lib`, `src/db`, and `src/features` never call `new Date()` / `Date.now()` directly — use
`nowDate()` / `nowMs()` from `src/lib/clock.ts` (default a `now` parameter to it). This is what lets
the e2e fleet freeze one instant so the clock-anchored seed and every render stay pixel-stable for
visual regression; in production the clock is the native call, unchanged. `pnpm check:clock`
enforces it. Never stabilise a visual test by masking moving text — freeze the clock at the
Playwright harness boundary.

## Trips late-arrival and departure buffer

Because trips often run late, every check deciding whether a departure has sailed, ended, or is
"in the past" allows a **1-hour buffer** on the scheduled time. Ask it through `hasSailed()` /
`hasReturned()` (`src/lib/trips.ts`), never a second `*_BUFFER_MS` and never the comparison by
hand: stated in prose alone the hour reached fifteen spellings, and `pnpm check:repo` refuses the
sixteenth ([docs/agents/repo-checks.md](../../docs/agents/repo-checks.md)).

## Codes, not sentences

`src/lib` and `src/db` return **codes, not sentences**; the UI picks the words (ADR
20260731-domain-layer-copy-leaks, enforced by `pnpm check:domain-strings`). A data module that
*feeds* the UI (marketing claims, switching guides, demo roles) holds **message-bundle keys, never
words** — the key-registry pattern of `src/lib/marketing.ts` / `src/lib/demo-roles.ts` — and the
registries listed in `scripts/check-domain-strings.mjs`'s `proseFreeFiles` hard-fail on any
unexempted prose literal.

## Every formatter names its zone

The `src/lib/format.ts` formatters take `timeZone` as a **required** parameter so a missing zone is
a compile error rather than a wrong time. A value with no instant in it (a date-only calendar date,
a wall-clock time of day) says `timeZone: "UTC"` explicitly — see `src/lib/calendar-date.ts`.
Every `Intl` formatter is built through `src/lib/intl-cache.ts`, never a bare `new Intl.*` at the
call site (constructing one costs ~12x reusing it; `pnpm check:intl-cache`).

## Safety and security

Safety-critical logic (manifests, roll call, cert gating, medical flags) gets boring code,
failure-path and adversarial tests, and a `dive-domain-expert` review. Auth/authz, token flows and
anything touching personal or medical data get a `security-reviewer` review before merge.
