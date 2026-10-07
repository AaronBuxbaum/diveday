---
paths:
  - "src/lib/**"
  - "src/features/**"
---

# Rules for `src/lib/` and `src/features/`

Framework-free domain logic and the feature modules. Each rule names what enforces it; the
reasoning and the longer form of every row are in
[docs/agents/repo-checks.md](../../docs/agents/repo-checks.md#the-domain-rules).

## Where things are

- **Capacity** in `src/lib/trips.ts`, **dates** in `src/lib/format.ts`.
- **Buying a seat vs. boarding**: `src/lib/trip-admission.ts` (booking-time) is weaker than
  `src/lib/readiness.ts` (boarding-time); admission never refuses someone readiness would clear.
- **Payments**: `src/lib/payments/`; codes in `src/lib/promo-codes.ts`, deals in
  `src/db/trip-promos.ts`; both resolve in `bookSpot`, and Stripe owns the arithmetic.
- **Today and the close-out**: `src/lib/today.ts`, `src/lib/closeout.ts`; one detector, and closing
  is a recorded act, never a gate (ADR 20260804-day-closeout).
- **Notifications**: `src/lib/notifications/`; `courtesy.ts` picks the channel.
- **Offline manifests**: `src/lib/offline-manifests.ts`; two `no-store` routes read through its
  response types (ADR 20260726-shopwide-offline-manifest-priming).
- **Dive-site difficulty** is one of three codes in `src/lib/dive-site-difficulty.ts`, never free
  text (ADR 20260813-dive-site-difficulty-is-a-code).
- **Course depth** is a marker (`{depth18}`) resolved by the shop's unit; a broken marker is
  refused at save (ADR 20260814-course-depth-markers).
- **Auth**: `src/lib/auth.ts`, `src/lib/session.ts`; `src/proxy.ts` is convenience, not the
  boundary.
- **Staff destinations**: `src/lib/staff-destinations.ts`, one registry (ADR 20261001-logbook).
- **Staff notices**: `noticeUrl`, `noticeFromParam`, `shopPath` in `src/lib/staff-notices.ts`;
  never hand-build the string (notice-code guard).
- **Feature modules**: `src/features/<feature>/index.ts` is the whole public surface
  (ADR 20260730-feature-module-contracts). A Zapier hook URL is pinned to `hooks.zapier.com`.

## Rules

- **`app → features → lib/db`, one way**: `pnpm check:architecture`.
- **Time is read through the clock** (`nowDate()`/`nowMs()` from `src/lib/clock.ts`), never
  `new Date()` or `Date.now()`: `pnpm check:clock`. Freeze the clock at the harness, never mask
  moving text.
- **The one-hour departure buffer is asked through `hasSailed()`/`hasReturned()`**, never a second
  constant or a hand comparison: departure-buffer guard.
- **`src/lib` and `src/db` return codes, not sentences**; a registry feeding the UI holds bundle
  keys: `pnpm check:domain-strings` (ADR 20260731-domain-layer-copy-leaks).
- **Every formatter takes a required `timeZone`**; a value with no instant says `"UTC"`
  (`src/lib/calendar-date.ts`): `pnpm check:timezone`. Every `Intl` formatter comes from
  `src/lib/intl-cache.ts`: `pnpm check:intl-cache`.
- **A formatted date or time is one unit**, joined by `keepUnitsWhole` (`src/lib/date-parts.ts`)
  with U+00A0 inside; a test matches it with a string query or a regex that spells `\s`.
- **Safety-critical logic** (manifests, roll call, cert gating, medical flags) gets boring code,
  failure-path and adversarial tests, and a `dive-domain-expert` review; auth, tokens and personal
  or medical data get a `security-reviewer` review.
