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

