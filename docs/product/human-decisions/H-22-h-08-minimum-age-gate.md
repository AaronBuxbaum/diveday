# H-22: H-08's minimum-age gate as approved (2026-07-24, option B — "collect it, fail open") did…

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

H-08's minimum-age gate as approved (2026-07-24, option B — "collect it, fail open") did not specify how the anonymous public booking form should behave, and a `security-reviewer` pass on the implementation ([20260724-gear-fit-fallback](../../architecture/decisions/20260724-gear-fit-fallback.md)) found that refusing a public booking on age is an exploitable oracle: it lets anyone who can guess a diver's email learn whether that email belongs to a child under a course's minimum age (10/12/15/18), probing for free since the check ran ahead of the capacity check. The fix that shipped goes further than "fail open on a missing date" — it never refuses the public form on age at all (even with a date on file and a real underage match), relies entirely on the `under_minimum_age` readiness blocker to catch it downstream, and gives that blocker copy worded identically to the identity-mismatch blocker so its presence discloses nothing on the diver's own checklist either. Was this narrower scope — publicly silent on age, full disclosure withheld even from the diver-facing checklist — the intended shape of "option B," or should the public path refuse more visibly once identity is confirmed (e.g. after `identityUnconfirmedAt` clears), accepting some reduced oracle risk for a clearer diver-facing signal?

## Minimum outcome to record

Confirm the shipped behavior (silent public path, generic diver-facing copy, staff see the real reason) as final, or specify a different disclosure boundary once a diver's identity is confirmed.

## Unblocks / follow-up

No code currently blocked — this is a retroactive confirmation of a security-motivated implementation choice, not a gate on new work. A different answer would be a follow-up change to `src/db/bookings.ts` and `src/lib/readiness-summary.ts`. **Decided + shipped 2026-07-25: name the real reason on the diver's own checklist.** Before choosing, the assistant flagged that the example gate this row itself suggested — "once `identityUnconfirmedAt` clears" — doesn't actually work: that flag only fires on a *mismatched* submitted name (H-13), so an attacker who already knows a specific child's real name and email gets `nameMatches: true` on the first request and never trips it, meaning that gate would disclose immediately to exactly the more-targeted attacker it needed to stop. **The product owner chose to proceed with that gate anyway** — the common non-adversarial case (a family whose child isn't old enough) now gets an actionable message — with the known gap written down rather than silently shipped. `DIVER_VOICE.under_minimum_age` (`src/lib/readiness-summary.ts`) now names the real reason whenever no identity mismatch is also present; the mismatched-name case still gets the fully generic line. See [20260725-checklist-age-disclosure](../../architecture/decisions/20260725-checklist-age-disclosure.md) for the full tradeoff and the stated escape hatch (a real identity-proof primitive, if one is ever built).

Part of the [human decision log](README.md#decision-register).
