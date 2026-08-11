# FU-20260811-roster-all-clear-moment — Celebrate the moment the last blocker clears on a trip's roster

- **Status:** Open
- **Raised:** 2026-08-11 — the Guests/Overview recomposition (PR #452), design-critic review
- **Kind:** improvement
- **Effort:** S
- **Touches:** `src/app/shop/[shopSlug]/trips/[id]/_components/RosterSection.tsx`, `src/app/globals.css`

## What I noticed

When staff clear a trip's final blocker from the Guests roster — the "Blocked (0)" state every
shop works toward each morning — the page's only feedback is the absence of red. Principle 3
reserves joy for finished things, and "everyone on this boat is cleared to dive" is exactly such
a moment; today it passes silently.

## Why it isn't already done

It needs a client-side transition detector (the roster is server-rendered; the moment is the
*change* from blocked > 0 to blocked = 0 caused by this staffer's action, not the state itself),
plus a reduced-motion-respecting ≤400ms coral animation — a small but genuinely new mechanism
that deserved its own review rather than riding along on a recomposition PR.

## Proposed change

A one-time, ≤400ms, coral-accented flourish on the roster header ("Everyone's cleared to dive")
when a mutation on this page moves the blocked count from >0 to 0 — transform/opacity only,
gone on reload, `prefers-reduced-motion` respected (the `globals.css` kill-switch already
covers animations). Not proposing a persistent all-clear banner: a lasting state would be
"None" rendered as a status, exactly what principle 9 forbids.

## Prompt

```text
Read docs/design/principles.md (#3, #5, #9) and
src/app/shop/[shopSlug]/trips/[id]/_components/RosterSection.tsx. Add a one-time celebration
moment when a staff action on the Guests roster clears the trip's last readiness blocker: a
small coral-accented (--accent token) flourish on the roster header, ≤400ms, transform/opacity
only, respecting prefers-reduced-motion, never persisted (state transition detected client-side,
e.g. a small client component receiving the blocked count and remembering the previous render's).
Copy goes through the staff bundle in both locales. Verify with pnpm check, a screenshot pass,
and pnpm e2e:run add-diver.spec.ts --reporter=line. Delete
docs/product/follow-ups/FU-20260811-roster-all-clear-moment.md as part of the change.
```
