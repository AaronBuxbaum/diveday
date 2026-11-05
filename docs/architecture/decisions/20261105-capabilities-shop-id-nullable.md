# 20261105-capabilities-shop-id-nullable — Move account tokens, setup links and calendar feeds onto `capabilities`

- **Status:** Accepted
- **Date:** 2026-11-05
- **Issue:** #3721 (#2710)
- **Amends:** [20260725-account-lifecycle-emails](20260725-account-lifecycle-emails.md), [20260726-staff-invite-accounts](20260726-staff-invite-accounts.md), [20261009-single-use-setup-links](20261009-single-use-setup-links.md), [20260730-calendar-feed-subscriptions](20260730-calendar-feed-subscriptions.md), [20261019-single-address-token-table](20261019-single-address-token-table.md)

## Context

Three bearer-link tables were left beside `capabilities`: `account_tokens`, `shop_setup_links` and
`calendar_feeds`. Each had its own module, digest helper, supersede rule, retention row and erasure
statement. Two name no shop: an account token proves a sign-in account, and a setup link exists
before its shop does. `capabilities.shop_id` was `NOT NULL`, so they could not move. Aaron's call:
make it nullable, move all three, delete the old tables and modules.

## Decision

- **`shop_id` is null exactly for a `platform` purpose.** `CAPABILITY_POLICY` gains `scope:
  "shop" | "platform"`, and `capabilities_scope_by_purpose` holds it both ways.
- **Two subjects**: `user_account` (`user_account_id`) and `setup_request` (`setup_request_id`,
  `ON DELETE CASCADE`), each a typed foreign key in `capabilities_subject_by_purpose`.
- **Purposes**: `email_verification`, `password_reset`, `invite` (platform, expiring, once-use);
  `shop_setup` (platform, 14 days, once-use; `spent_by_shop_id`, `ON DELETE SET NULL`, only on it);
  `calendar_assignments`, `calendar_shop_trips` (shop, never expire).
- **Supersede granularity**: `reissue: "supersedes"` names `per: "shop"` or `per: "subject"`
  (account and purpose, person and purpose). The mint locks that row; a partial unique index on
  live rows backs the account tokens and the feeds.
- **`use: "reusable"`**: a calendar feed is opened many times, never spent; `open` refuses a
  revoked row, and `last_accessed_at` is stamped only on these purposes.
- **`merge: "follows" | "refuse"`** on every `person` purpose. Unsubscribe links follow a diver
  merge; a calendar feed is a staff credential, so a feed on either record refuses it.
- **`spendCapability` takes `alsoRequire`**, a condition checked in the same update: an account
  token is spent only while its account is not `disabled`, never spend-then-check.
- Erasure deletes account tokens by account and revokes feeds by person; setup links go with their
  request. The account tokens keep 90 days past expiry inside the `capabilities` retention arm.

## Alternatives considered

- **Keep the three tables**: three verify paths, digest helpers and retention rows to keep in step.
- **A sentinel platform shop**: a fake tenant every shop-scoped query would have to exclude.

## Consequences

- One verify path; a token of one purpose never resolves under another, across all twelve.
- The migrations drop the old tables: links in flight die (H-20260815-no-legacy). For the deploy
  window the previous release fails on them instead of serving a link.
- Platform rows match no `shop_id` filter: reaps and erasures reach them by account or request.
- Revisit if a platform purpose needs a shop after all: add the column back to its subject.
