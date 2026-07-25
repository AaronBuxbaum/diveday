# 20260725-checklist-age-disclosure — Name the real reason on the diver's own age blocker

- **Status:** Accepted
- **Date:** 2026-07-25

## Context

[20260724-gear-fit-fallback](20260724-gear-fit-fallback.md) shipped H-08's minimum-age gate. A
`security-reviewer` pass on that work found that refusing a public booking on age is an
exploitable oracle — anyone who can guess a diver's email can probe course sessions with
different published minimums (10/12/15/18) and, from which ones get refused, learn whether that
address belongs to a child under a given age. The fix skipped the public form entirely and, on
the diver's own `/ready` checklist, worded the resulting `under_minimum_age` blocker
**word-for-word identical** to the unrelated `identity_unconfirmed` blocker, so even a diver
reading their own confirmation page couldn't tell which of the two problems applied.

That closed the leak completely but at a UX cost the original H-08 decision never specified: a
family who books their 10-year-old onto a 12+ course gets a vague "we're finishing a check up"
message instead of anything they can act on. H-08's "fail open" choice didn't settle how much the
*diver-facing* copy should say — that gap became **H-22** (`docs/product/human-decisions.md`).
The product owner reviewed the tradeoff, including the specific gap noted below, and chose to
disclose more.

## Decision

`DIVER_VOICE.under_minimum_age` (`src/lib/readiness-summary.ts`) now names the real reason: *"This
course has a minimum age that the date of birth on file doesn't meet for this session. If that's
wrong, give the shop a call and they'll sort it out."*

This is a **known, accepted narrowing** of the original mitigation, not a full reversal of it.
`identity_unconfirmed` (H-13) only flags a submitted name that doesn't **match** the name already
on file (`!nameMatches`) — it exists to catch a shared inbox, not to prove the submitter is really
the account holder. `buildDiverChecklist` always shows `identity_unconfirmed`'s generic line ahead
of `under_minimum_age`'s specific one when both apply, because `calculateReadiness` pushes the
identity blocker first (`src/lib/readiness.ts`). So the specific age copy is only ever shown when
**no name mismatch was detected** — which protects the shared-inbox / random-guessing case, but
not an attacker who already knows the exact name tied to a specific email they're targeting: that
submission gets `nameMatches: true` on its very first request and never trips the identity flag at
all. That is arguably the more concerning, targeted threat, and this decision does not close it.

## Alternatives considered

- **Gate disclosure on a real identity-proof step** (e.g. a staff-witnessed dock confirmation, or
  a second-factor email loop) before showing the specific reason. This is the version that would
  actually close the remaining gap. Deferred: no such staff action or workflow exists today, and
  building one is materially larger scope than this decision — a candidate for a future ADR if the
  gap is ever exploited or otherwise becomes unacceptable.
- **Leave the copy generic permanently** (the status quo this decision replaces). Fully closes the
  oracle, at the cost of a materially worse experience for every non-adversarial family who hits
  the gate — the overwhelming majority of cases. Rejected by the product owner as too conservative
  for the actual risk.
- **Gate disclosure on payment.** Doesn't prove identity — payment method and person-on-file are
  unrelated facts — so it wouldn't close the targeted-attacker case either; it would only add a
  small cost to guessing. Not worth the complexity over the chosen option, which is simpler and
  equally exposed to that same attacker.

## Consequences

- A family booking a course their child isn't old enough for now gets told the actual reason and
  can act on it (correct a wrong date, or understand the real constraint), instead of a message
  that gives them nothing to do but wait.
- The residual exposure is narrow and stated plainly: an attacker who already knows a specific
  person's exact name **and** email, and where that shop has a date of birth on file for them, can
  learn via a public booking + confirmation link whether that person is under a given course's
  minimum age. It requires knowing the name as stored, not just guessing an address.
- **Escape hatch:** if this is ever exploited, reported, or a real identity-proof primitive gets
  built (login, a staff-witnessed confirm, a second-factor loop), swap the disclosure gate in
  `readiness-summary.ts` from "no identity mismatch present" to that stronger check — a one-line
  change, since the `under_minimum_age` DIVER_VOICE entry is the only place this policy lives.
