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

AGENTS.md and [the route map](../../docs/agents/route-map.md) say where (capacity, dates, payments,
Today, notifications, offline manifests, auth). What they do not say:

- **Admission is weaker than readiness**: `src/lib/trip-admission.ts` (booking-time) never refuses
  someone `src/lib/readiness.ts` (boarding-time) would clear.
- **Codes and deals** both resolve in `bookSpot`, and Stripe owns the arithmetic.
- **Closing the day** is a recorded act, never a gate, and Today has one detector
  (ADR 20260804-day-closeout).
- **Offline manifests**: two `no-store` routes read through the response types in
  `src/lib/offline-manifests.ts` (ADR 20260726-shopwide-offline-manifest-priming).
- **Dive-site difficulty** is one of three codes in `src/lib/dive-site-difficulty.ts`, never free
  text (ADR 20260813-dive-site-difficulty-is-a-code).
- **Course depth** is a marker (`{depth18}`) resolved by the shop's unit; a broken marker is
  refused at save (ADR 20260814-course-depth-markers).
- **`src/proxy.ts` is convenience, not the auth boundary.**
- **Optional features**: `src/lib/shop-features.ts` (the switches) and
  `src/lib/feature-coverage.ts` (every destination and `shops` boolean, a switch or a written
  `core` reason). A new feature a shop could run without gets a switch, default on.
- **Staff destinations** are one registry, `src/lib/staff-destinations.ts` (ADR 20261001-logbook).
- **Staff notices**: `noticeUrl`, `noticeFromParam`, `shopPath` in `src/lib/staff-notices.ts`;
  never hand-build the string (notice-code guard).
- **Feature modules**: `src/features/<feature>/index.ts` is the whole public surface
  (ADR 20260730-feature-module-contracts). A Zapier hook URL is pinned to `hooks.zapier.com`.

## Rules

- **`app → features → lib/db`, one way**, and `src/lib` takes only *types* from `src/db`; a
  loader that reads is a `src/db` function or a feature module: `pnpm check:architecture`.
- **Time is read through the clock** (`nowDate()`/`nowMs()` from `src/lib/clock.ts`), never
  `new Date()` or `Date.now()`: Biome rule `clock` (`pnpm lint`). Freeze the clock at the harness, never mask
  moving text.
- **The one-hour departure buffer is asked through `hasSailed()`/`hasReturned()`**, never a second
  constant or a hand comparison: departure-buffer guard.
- **`src/lib` and `src/db` return codes, not sentences**; a registry feeding the UI holds bundle
  keys: `pnpm check:domain-strings` (ADR 20260731-domain-layer-copy-leaks).
  A renderer (the page, `src/lib/notifications/**`, the file) is the only module that imports a
  translator; the rest returns a `Copy` (`src/lib/copy.ts`) it resolves: `pnpm check:architecture`
  ratchets the files still importing one (issue #2772).
- **Every formatter takes a required `timeZone`**; a value with no instant says `"UTC"`
  (`src/lib/calendar-date.ts`): Biome rule `timezone`. Every `Intl` formatter comes from
  `src/lib/intl-cache.ts`: Biome rule `intlCache`.
- **A formatted date or time is one unit**, joined by `keepUnitsWhole` (`src/lib/date-parts.ts`)
  with U+00A0 inside; a test matches it with a string query or a regex that spells `\s`.
- **Safety-critical logic** (manifests, roll call, cert gating, medical flags) gets boring code,
  failure-path and adversarial tests, and a `dive-domain-expert` review; auth, tokens and personal
  or medical data get a `security-reviewer` review.
