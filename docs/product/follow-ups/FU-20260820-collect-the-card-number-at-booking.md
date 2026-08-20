# FU-20260820-collect-the-card-number-at-booking — Ask for the agency and card number, not just the rung

- **Status:** Open
- **Raised:** 2026-08-20 — building H-27/H-29 (ADR 20260820-attested-at-booking-verified-at-boarding)
- **Kind:** half-done
- **Effort:** M
- **Touches:** `src/components/DiveDeclarationFields.tsx`, `src/lib/dive-declaration.ts`, `src/db/self-declared-cards.ts`, `src/db/bookings.ts`, `src/i18n/locales/en-US/diver.json`, `src/i18n/locales/es-ES/diver.json`

## What I noticed

The product owner's policy for the booking gate has three moving parts: an attested card is believed
before the trip, **the diver types their certification number**, and it gets verified before the dive
date. Two of the three shipped. The declaration the booking form collects is still a *level* and
nothing else — the same shape the two public wait lists have collected since FU-20260813.

Without a number, "verified asynchronously before the dive date" has nothing to work from. A staffer
opening the verify queue sees "Advanced Open Water (self-declared)" and no agency, no card number,
and therefore no way to check it against anything except the diver in front of them at the dock —
which is the sighting they would have done anyway. The asynchronous half of the policy is currently
aspirational.

`certifications.identifier` is already nullable *only* for a self-declaration, with a check
constraint saying so, so the column is waiting for this. `DIVER_CERTIFICATION_AGENCY_KEYS`
(`src/i18n/readiness-labels.ts`) already carries diver-facing agency words.

## Why it isn't already done

Scope, and one design question that deserves an answer rather than a default. The change that landed
was the gate itself (believing what is on the record) plus the plumbing that carries a declaration
into the decision without persisting it on a refusal. Adding two more fields is small; deciding what
they mean is not:

- **Is the number optional?** Optional keeps the form short and matches the marketing opt-ins, but
  then most declarations still arrive uncheckable. Required-when-a-level-is-given is stricter and
  might cost bookings from divers who do not have the card in front of them.
- **What does a staffer do with an unverifiable number?** There is no agency lookup API — H-10 was
  dropped — so "verify" still means a human sighting the physical card. A number lets them
  *pre-check* against a shop's own records and spot an obvious typo; it does not let them adjudicate
  remotely. The queue's wording should not promise more than that.

## Proposed change

Add an agency `<select>` and a card-number input to `DiveDeclarationFields`, revealed only once a
real level is picked (not on "Rather not say", not on "I'm not certified yet"). Carry them through
`diveDeclarationSchema` / `toDiveDeclaration`, through `SelfDeclaration` in
`src/lib/trip-admission.ts`, and into `recordSelfDeclaredCards`, which writes them onto the row it
already creates. The anti-displacement rule is unchanged and still does the safety work: a claim
never touches a real card.

Keep both fields **optional**, and let the level stand alone as it does today — a diver who knows
their rung but not their number is still worth believing at the sale, and refusing that submission
would trade a booking for a form field.

Do **not** make the number gate anything. It is evidence for a human to check, not a second gate,
and the boarding sighting is unchanged.

## Prompt

```text
Read docs/architecture/decisions/20260820-attested-at-booking-verified-at-boarding.md first — it
records why an attested card is believed at the sale and sighted at the boat, and it names this as
the piece that was left out.

Add an optional agency select and card-number input to src/components/DiveDeclarationFields.tsx,
shown only when the diver has picked a real level. Thread them through src/lib/dive-declaration.ts
(diveDeclarationSchema, toDiveDeclaration), the SelfDeclaration type in src/lib/trip-admission.ts,
and src/db/self-declared-cards.ts so recordSelfDeclaredCards writes agency and identifier onto the
row it already creates. src/db/bookings.ts already persists the declaration only on a completed
booking — keep that property, and add a test that a refused submission still writes nothing.

Both fields stay optional: a diver who knows their rung but not their number is still believed.
The number must not gate anything — the boarding sighting is unchanged.

Copy goes in both locales (en-US and es-ES diver.json) in the same change; check
src/i18n/locales/es-ES/README.md for register before writing Spanish. The public booking page and
the trip page both mount this component, so re-run e2e/booking*.spec.ts and expect a visual diff on
the booking form captures.

Delete docs/product/follow-ups/FU-20260820-collect-the-card-number-at-booking.md in the same commit
when the work lands.
```
