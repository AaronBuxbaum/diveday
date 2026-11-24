# shop-setup

Starting and configuring a shop: sign-up, setup links, the first day, feature
switches, integrations, the website and embeds.

## Owns

- Starting: `shop-signup.ts`, `setup-links.ts`, `setup-request-receipts/`,
  `first-run.ts`, `first-day/`.
- Configuring: `features-page.ts`, `shop-contact-email.ts`, `shop-activity-page.ts`,
  `website-setup.ts`, `embed-settings-page.ts`.
- Connecting: `integrations/`, `integration-backfill.ts`, `connections/`.

## Does not own

The feature switches and their coverage (`src/lib/shop-features.ts`, `src/lib/feature-coverage.ts`),
and the shop row (`src/db/shops.ts`).

## Invariants

- Setup links (ADR 20261009-single-use-setup-links) are stored only as a SHA-256 hash, expire
  after `SETUP_LINK_TTL_MS`, and are spent by a conditional update in the transaction that creates
  the shop; a bounce carries the token in an HttpOnly, SameSite=Strict cookie scoped to `/onboard`,
  never a URL; every bad link draws the same closed door.
- Integration delivery drains after the response (`after()`), never inline; a webhook is
  HMAC-SHA256 signed per shop; a Zapier hook URL is pinned to `hooks.zapier.com`.
- A new feature a shop could run without gets a switch, default on.
