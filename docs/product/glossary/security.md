# Security

- **Pending sign-in challenge** — password proof awaiting a second factor, granting no staff
  session. A random cookie handle resolves to a digest-only account/shop record, valid for five
  minutes and five submitted codes. TOTP or recovery-code consumption, challenge consumption and
  Better Auth session creation commit together. Back, restart and credential/security invalidation
  revoke it; expired rows are cleanup machinery, never exported (ADR
  [20261026-pending-sign-in-challenge](../../architecture/decisions/20261026-pending-sign-in-challenge.md)).

- **Step-up** — a fresh second-factor check for one sensitive act, bound to one Better Auth
  session and expiring on its own (`account_step_ups`, ADR
  [20260826-account-security-step-up](../../architecture/decisions/20260826-account-security-step-up.md)).
  Three purposes: `money`, `export`, `backup`. A grant from another browser, or from a session
  since revoked, never satisfies it. Being signed in is not being stepped up; **and step-up is
  only demanded of an account that has enabled two-factor**, so it is a control a staff member
  opts into rather than a floor under every account.
- **Recovery code** — one of ten single-use strings issued at two-factor enrolment, shown once and
  stored only as a salted HMAC under the deployment's own sealing key. It is a second factor, not
  a password reset: presenting one satisfies the same check a TOTP code does.
- **Address confirmation token** — a purpose-bound bearer credential verifying control of an email
  address for user accounts, shop front-desk contacts, or shore alert contacts (ADR
  [20261019-single-address-token-table](../../architecture/decisions/20261019-single-address-token-table.md)).
  Stored as a SHA-256 hash at rest, expiring and single-use upon consumption. A token issued for one
  purpose cannot be resolved or redeemed under another.
- **Capability** — a bearer link whose URL is the credential, stored as a row of `capabilities`
  under one purpose (issue #2710). The purpose decides what the row opens (an interest, a
  person, a sign-in account, or one of the shop's own addresses named by the address the link was
  mailed to), whether it belongs to a shop or to DiveDay itself (`scope`; a platform row has no
  `shop_id`), how long it lives, whether a fresh one supersedes the live one and whether a use
  spends it: one record per purpose in `src/lib/capabilities.ts`. A token minted for one purpose
  never verifies under another. The purposes are the email-unsubscribe and stop links
  (`interest_unsubscribe`, `courtesy_email_unsubscribe`, `weekly_digest_unsubscribe`,
  `shore_alert_stop`, `bookkeeper_stop`), the shore contact's `shore_alert_confirm`, and the
  account tokens `email_verification`, `password_reset` and `invite`, which name the account and
  no shop, the setup link `shop_setup`, which names a set-up request and no shop, and the staff
  calendar feeds `calendar_assignments` and `calendar_shop_trips`, reusable (opened on every
  poll, never spent) and never expiring, which refuse a diver merge rather than follow it (ADR
  [20261105-capabilities-shop-id-nullable](../../architecture/decisions/20261105-capabilities-shop-id-nullable.md)).
  Booking links stay on `booking_capabilities`, because they are derived from their row rather
  than stored as a digest.
- **Booking link** — a bearer link to one booking under one purpose (`readiness`, `confirm`,
  `claim`, `handoff`, `course_forms`), a row of `booking_capabilities` whose URL is derived, not
  stored: `c<version>.<row id>.<HMAC tag>` (ADR
  [20261104-derived-booking-link-tokens](../../architecture/decisions/20261104-derived-booking-link-tokens.md)).
  A booking holds at most one live link per purpose and audience (mailed or shown in the browser),
  so asking again hands back the same URL. A handoff link is never reused, and the
  returning-diver receipt is one-use. A wrong tag is refused before any row is read.
