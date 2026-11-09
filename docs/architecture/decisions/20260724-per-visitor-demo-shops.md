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
Fake data and a real tenant were conflated; they should never share a shop. The e2e/visual-regression
fleet depends on one stable canonical demo (`blue-mantis`) reached via `DEV_STAFF_LOGINS` and
`/api/test/reset`, which must be preserved.

## Decision

- **Real shops never seed.** `/onboard` always creates a clean shop (owner, roles, account, default
  waiver only). The `seedDemoData` field, its checkbox, and the seeding branch are removed.
- **Seeded data lives only in demo shops**, minted **fresh per visitor**. "Try the live demo"
  (`enterDemoAction`) calls a new `createDemoShop()` that: generates a unique slug + display name;
  inserts the shop `isDemo: true`; creates an owner + instructor/divemaster/captain with
  **per-shop-unique** generated emails and accounts; seeds the schedule via the already
  `shopId`-parameterized `seedDemoSchedule`; then signs the visitor into the generated owner using
  the existing `isDemo` bypass token (`src/db/credentials.ts`), so no generated password is stored
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

## Amendment 2026-10-16: the demo wears the visitor's shop name (H-20261014-demo-wears-visitor-shop)

The "Try the demo" door on Get set up asks, optionally, for the visitor's own shop name, and the
demo's staff screens wear it: the shop nav, Today's greeting and the sample email preview. It is
**never written to the database**. It lives in one signed cookie (`diveday_demo_name`, httpOnly,
path `/shop`, seven days, HMAC keyed by HKDF from the auth secret, bound to the minted demo's shop
id and to its own expiry; `src/features/demo-shop-name/rules.ts`), cleaned to 60 characters with control and
format characters stripped (`cleanVisitorShopName`). So the name never reaches the storefront, a
sent email, a search engine or another visitor, and the canonical `blue-mantis` demo never reads
it. The "Demo shop" banner stays, and every demo shop's storefront is now `noindex`
(`shopSearchListingRobots` reads `isDemo`), so a page wearing a real shop's name cannot be indexed
as that shop. Leaving the field empty keeps the generated name, and an empty submit clears the
cookie.

## Operator-assisted recovery

There is no new self-service access door and no required email before trying the demo. The
operator uses `scripts/demo-access.ts` with an explicitly configured `DATABASE_URL`, preferably
read-only credentials. It opens a read-only transaction, never calls the seeding database factory,
and never changes accounts, issues tokens, or sends messages.

```sh
NODE_ENV=production pnpm exec tsx scripts/demo-access.ts list --query coral
NODE_ENV=production pnpm exec tsx scripts/demo-access.ts list --since 2026-11-09T09:00:00Z
NODE_ENV=production pnpm exec tsx scripts/demo-access.ts credentials --slug coral-cove-divers
```

`list` returns at most 100 recent demo matches with generated name, exact slug and creation time
in UTC, not account emails. Narrow the query/time window when necessary. Ask the requester for
any demo URL from browser history, a screenshot showing the URL or generated shop name, and the
approximate time they entered. Match these before explicitly selecting the exact slug. The
visitor's typed shop name deliberately remains only in their signed browser cookie, not the
database; without any identifier or usable time correlation, the operator cannot reliably infer
which demo belongs to a person. Do not guess: provide a fresh sample shop instead.

`credentials` prints the selected sample owner's existing sign-in details for the operator to
review and send manually. Its query requires a demo shop, exclusively demo-namespace owner/captain
accounts, and exactly one live active owner. It refuses missing/reaped shops, real identities,
disabled/deleted owners and ambiguous ownership. The deployment must still allow demo sign-in.
Run it with the deployment's `APP_HOST` and runtime flags; do not post its output to a public issue
or CI log. These details are reusable public sample access, not a private or revocable magic link.
Do not enter real customer data. Demos normally expire after seven days and can be evicted earlier.

Real accounts already use `/forgot-password` and the emailed single-use reset flow. Demo addresses
are non-routable and demo mail is held, so that flow cannot recover demos. This operator tool does
not reset a real password, disable two-factor authentication or grant access to a real shop.
