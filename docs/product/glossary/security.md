# Security

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
