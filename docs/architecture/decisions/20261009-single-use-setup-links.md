# 20261009-single-use-setup-links — `/onboard` opens with a single-use link per request, not a standing key

- **Status:** Accepted
- **Date:** 2026-10-09
- **Amends:** [20260925-shops-are-set-up-by-hand](20260925-shops-are-set-up-by-hand.md) (its setup key), [20261007-setup-request-form](20261007-setup-request-form.md) (the onboarding mail now carries the link), [20260805-demo-try-alerts](20260805-demo-try-alerts.md) (its 2026-10-06 amendment's proof)

## Context

Since 2026-09-25 `/onboard` has opened only for `ONBOARD_SETUP_KEY`, one long random value in
the deployment's environment. It worked, and its own ADR named its cost: the key is a standing
credential, shared, reusable and unexpiring, so the link could never be sent to a shop, and
anyone who ever saw it (a forwarded mail, browser history, a request log) could create shops
until it was rotated. That ADR also named the shape to move to when shops should fill the form in
themselves: "a per-invite token (hashed, expiring, spent in the same transaction as the shop
insert, like `src/db/account-tokens.ts`)". Every shop still comes through the set-up request form
(ADR 20261007-setup-request-form), so each request is the natural place to mint one.

The same key was also the founder's proof for marking a browser as his own, so his demo tries do
not alert him (`/api/demo/quiet?setup=<key>`).

## Decision

- **One link per set-up request.** `announceSetupRequest` mints a link for the stored request
  (`issueSetupLink`, `src/db/setup-links.ts`) and the onboarding mail carries it as
  `/onboard?setup=<token>`, with the date it stops working and the line "Send it only to someone
  you have spoken to." The onboarding inbox is the founder's, which is what makes minting there a
  founder-only act: a requester never sees the link unless the founder sends it. For a shop that
  never filled the form in, the founder fills it in for them.
- **Shaped like an account token.** 32 random bytes, base64url; stored only as a SHA-256 hash in
  `shop_setup_links` beside the request it was minted for (cascading with it, so a requester's
  erasure takes the link too). It expires after `SETUP_LINK_TTL_MS`, two weeks.
- **Spent with the shop.** `onboardAction` spends the link first thing inside the transaction that
  creates the shop, by a conditional update, so two submissions racing on one link create one
  shop, and a refusal later in the transaction (slug taken, email taken) rolls the spend back with
  everything else.
- **Judged by shape before the database.** A posted value that is not 43 base64url characters is
  refused before a database handle is taken and is never echoed into a `Location:` header. A
  well-shaped value is echoed on a bounce and judged again by the page.
- **The page tells nobody which way a link failed.** Unknown, spent, expired and mistyped all draw
  one closed door, "This setup link no longer works", with the set-up form's door. With no link at
  all, the page is the closed door it was.
- **The form opens with the request's answers**: shop name, contact name and email, each
  replaced by whatever a bounce carries back.
- **`ONBOARD_SETUP_KEY` is deleted**, with `src/lib/onboard-setup-key.ts`, its dev and e2e keys
  and its registry row. The e2e fleet mints a link per onboarding through
  `/api/test/seed-setup-link` (`e2e/setup-link.ts`), gated like every test route.
- **The demo-quiet proof becomes its own key**, `DEMO_QUIET_KEY`, at `/api/demo/quiet?key=<key>`.
  It is still a standing secret, because it marks a browser for 400 days, but it opens nothing but
  a quiet browser: a leaked copy costs the founder some alerts, never a shop. `key` joins `setup`
  in the telemetry redaction list (`src/lib/capability-urls.ts`).
- **A workstation prints the link** when the mail did not leave (`NODE_ENV` not production and no
  `DATABASE_URL`), because a dev run has no inbox. A deployment never does.

## Alternatives considered

- **A founder-only page that mints links** behind a secret or a signed-in operator account. Either
  brings back a standing credential or invents a platform-operator identity, which the earlier ADR
  already declined as the larger surface. The onboarding inbox is already the founder's.
- **A CLI script against the production database.** Declined in 20260925 for the same reasons:
  production credentials on a laptop, and a second path to keep in step with the action.
- **Keeping the key and adding links beside it.** Two doors to the same form, one of them the
  standing credential this replaces; there is no legacy to carry (H-49).

## Consequences

- Every set-up request mints a link, including spam the honeypot and rate limits missed. Each
  exists only as a hash and in the founder's inbox, and a spam requester never receives it unless
  the founder replies quoting it. The mail's Reply-To is the requester, whose address nothing has
  verified, so the mail says to send the link only to someone the founder has spoken to.
- A link that expires before the shop uses it is replaced by a fresh request, not extended.
- The production deployment needs `DEMO_QUIET_KEY` set for the quiet browser to work, and
  `ONBOARD_SETUP_KEY` can be removed from it; a browser marked under the old key is unmarked.
- `shop_setup_links` sits outside retention: one row per request, deleted with it.
