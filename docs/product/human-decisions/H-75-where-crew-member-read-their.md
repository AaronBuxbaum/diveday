# H-75: Where does a crew member read their own fly-safe answer — the day close-out,…

- **Status:** Deferred
- **Human owner:** Product owner + dive operations lead

## Decision or approval needed

**Where does a crew member read their own fly-safe answer — the day close-out, their own staff record, or nowhere?** The answer in `src/lib/fly-safe.ts` reaches a person through a **booking**: `getRecapPageData` resolves it from a booking id and `sendRecaps` sends it to booking rows. Crew are not bookings — they are `trip_assignments` rows, read through `src/db/trips-crew.ts` — so a divemaster never receives one at all. Raised by a `dive-domain-expert` review on PR #1552 as an adjacent gap and filed as issue #1557.

## Minimum outcome to record

The surface a crew member reads it on, or an explicit statement that DiveDay does not answer this for crew, and why.

## Unblocks / follow-up

**Deferred 2026-09-10 (Aaron Buxbaum), issue #1557 — not now.** Four facts keep this re-openable rather than closed. **(a)** The fly-safe answer belongs to a *person who dived*; a booking is only how DiveDay learns about the dive, so nothing in the domain puts crew outside it. **(b)** Divemasters diving five or six days a week are the population DAN's "multiple days of diving" clause is most about, and they are the one group the feature cannot reach — the gap is widest exactly where the guidance matters most. **(c)** The query is not the blocker: `peopleWhoDivedBefore` in `src/db/executed-dives.ts` already takes person ids and would answer for a crew person unchanged. **(d)** What is missing is a *surface*, and a new page nobody navigates to informs nobody — a line on the day close-out or on the staffer's own record is the likelier answer whenever this is picked up, because a crew member is already looking at one of those at the end of a working day. The limit is written into the `src/lib/fly-safe.ts` module docstring, which is where the next session reads before extending it.

Part of the [human decision log](README.md#decision-register).
