---
paths:
  - "src/**"
  - "docs/architecture/decisions/**"
---

# Experience beats speculative hardening

Decided by Aaron, 2026-11-06: DiveDay has no users yet, and a rule that adds a step, a refusal or a
dead link for an honest diver to guard against an unlikely risk is the wrong trade. Delight comes
first.

## Rules

- **Trust the honest case.** A diver, a party lead and a staffer are who they say they are until
  something real says otherwise. Do not make them prove it a second time.
- **A refusal, expiry, lockout or revoked link needs a named, plausible harm** (a real person
  hurt, medical data leaked, money lost). "An attacker could" with no one who would is not one.
- **Never revoke a link the person may be using.** A resend re-sends the live link; revoke on a
  contact change, on use, or when the trip ends.
- **A review finding of the defense-in-depth kind** (exploitable only with database access, a
  guessed secret, or a forwarded link whose holder gains nothing) is closed with a one-line
  reason, not built. Do not file it as an issue.
- **Keep the real rules**: a minor's guardian signature, medical clearance before boarding, no
  leaking one shop's or diver's data to another, payment integrity, and erasure promises.
- **When a safety rule and the experience collide, say so in the PR** and pick the lighter fix.
