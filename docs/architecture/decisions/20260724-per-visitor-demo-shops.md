# 20260724-per-visitor-demo-shops — Separate real shops from demo shops entirely

- **Status:** Accepted
- **Date:** 2026-07-24

Supersedes [20260718-production-demo-seed](20260718-production-demo-seed.md) (whose own "revisit
when the demo becomes per-visitor" clause is this change). Revises
[20260720-trial-shops-are-not-demo](20260720-trial-shops-are-not-demo.md): that ADR made an
onboarded shop `isDemo: false` while still letting a checkbox seed sample data into it; this ADR
removes that seeding path entirely.

## Context

Onboarding carried a "Start with sample trips" checkbox that seeded fake trips, bookings, and staff
into a **real** shop (`isDemo: false`). Two problems forced a rethink. First, a real footgun: a shop
that keeps the default checkbox and then imports its actual roster (the `/switching/spreadsheet`
flow) permanently mixes seeded people with customer data, with no reset control on a non-demo shop.
Second, a latent correctness bug: `seedShopWithDemoData` inserts the canonical Blue Mantis staff
emails (`marcus@/keiko@/sal@bluemantis.example`), and `user_accounts.email` is **globally** unique —
so seeding a second shop with sample data collides (`23505`) against the always-seeded demo tenant.
Fake data and a real tenant were conflated; they should never share a shop. The e2e/Argos fleet
depends on one stable canonical demo (`blue-mantis`) reached via `DEV_STAFF_LOGINS` and
`/api/test/reset`, which must be preserved.

## Decision

- **Real shops never seed.** `/onboard` always creates a clean shop (owner, roles, account, default
  waiver only). The `seedDemoData` field, its checkbox, and the seeding branch are removed.
- **Seeded data lives only in demo shops**, minted **fresh per visitor**. "Try the live demo"
  (`enterDemoAction`) calls a new `createDemoShop()` that: generates a unique slug + display name;
  inserts the shop `isDemo: true`; creates an owner + instructor/divemaster/captain with
  **per-shop-unique** generated emails and accounts; seeds the schedule via the already
  `shopId`-parameterized `seedDemoSchedule`; then signs the visitor into the generated owner using
  the existing `isDemo` bypass token (`src/lib/credentials.ts`), so no generated password is stored
  or transmitted.
- **The canonical `blue-mantis` demo is retained** as the deterministic test fixture: `seedIfEmpty`
  still seeds it in every environment, `DEV_STAFF_LOGINS`/`DEMO_SHOP_SLUG` still resolve to it, and
  the reaper never touches it. Public visitors no longer land on it; the fleet still does.
- **Uniqueness & concurrency:** generated slugs retry on collision under the same
  `pg_advisory_xact_lock`/`23505` handling as
  [20260723-concurrency-safe-demo-bootstrap](20260723-concurrency-safe-demo-bootstrap.md);
  per-shop-unique emails avoid the global `user_accounts` unique index. Pinned singletons
  (`DEMO_RECAP_BOOKING_ID`) stay on `blue-mantis` only — generated demos use random ids.
- **TTL reaper:** an idempotent cron endpoint (same shape as the pre-trip reminder cron) deletes
  generated demo shops older than **7 days** (window configurable via env), keyed on `shops.created_at`
  and excluding the canonical demo.
- **Abuse bounds:** minting is a public unauthenticated action, so two limits apply. A per-IP token
  bucket (`demoCreate`) caps one visitor's burst; because that does *not* bound the fleet-wide total
  (an IP-rotating attacker, a fail-open limiter, a multi-instance deployment), a hard **aggregate
  cap** on live minted demos (`DEMO_SHOP_MAX_LIVE`, default 200) evicts the oldest minted demo before
  each mint. Together with the reaper, total storage is bounded, not just per-visitor burst.
- **Demo data is public, not private.** A minted demo is addressable by its slug and any visitor can
  role-switch into it via the `isDemo` bypass token, so it is world-readable at owner level — fine
  for a throwaway playground, but a minted-demo banner warns against entering real customer data. It
  is deliberately *not* a private workspace.

## Alternatives considered

- **Keep one shared demo shop** — everyone edits the same tenant, mid-demo collisions, and the
  global-email bug remains latent; rejected.
- **Keep the checkbox but isolate seeded emails** — fixes the collision but keeps fake data in a real
  shop, the exact conflation this removes; rejected.
- **Ephemeral in-session demo (no DB rows)** — no reaper needed, but breaks server actions and
  multi-client booking simulation (per [20260718-dynamic-demo-onboarding](20260718-dynamic-demo-onboarding.md)); rejected.
- **No reaper, accept growth** — simplest, but per-visitor minting grows the DB unbounded; rejected
  in favor of the 7-day TTL.

## Consequences

Real shops are always clean, so importing a real roster is safe and the onboarding form loses a
field. Each visitor gets a private, disposable demo they can freely edit and reset; DB growth is
bounded by the reaper. The canonical `blue-mantis` fixture is unchanged, so the ~25 staff specs and
`/api/test/reset` keep working; `demo.spec` is rewritten to assert generic identity (no "Dana")
since the button now mints a generated shop. New surface to maintain: a slug/name generator, the
`createDemoShop` seeding path (owner + unique emails), `shops.created_at`, and the reaper cron.
Revisit if per-visitor minting proves abusable (tighten the aggregate cap, add a CAPTCHA) or if the
demo needs to outlive 7 days (make the window per-shop, or convert-to-trial on signup). If demos
must ever hold private data, bind the demo session to the mint (a cookie/nonce) so only the minting
visitor can role-switch in, rather than anyone with the slug.
