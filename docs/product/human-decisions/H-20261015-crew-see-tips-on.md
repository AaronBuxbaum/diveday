# H-20261015-crew-see-tips-on: May crew without the money permission see tips on their own boats?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**Crew Today shows a staffer their share of the week's tips on departures they crewed, including a divemaster or captain who cannot read Reports. Is that the one piece of shop money below the money gate, and does it stay the only one?** Issue #2470 flagged that the line is the first shop money shown to a role `src/lib/authz.ts` keeps out of Reports, so a later money line could cite it as precedent.

## Minimum outcome to record

Which tips a crew member sees, and that nothing else about shop money rides on it.

## Outcome

**Chosen and implemented (the issue's recommendation, 2026-10-15, built on issue #2470): confirmed, scoped to the reader's own boats.**

- **Crew may see tips on departures they crewed, and no other shop money.** The line reads "Your share of tips this week" and is the reader's equal share of each of their departures' paid tips (`crewTipShare`, `src/db/crew-tips.ts`; the split rule is the crew sheet's, `splitTipsEqually`). It is not the boat's total (issue #2468) and not the shop's.
- **It is not precedent for more.** Revenue, payments, payouts, fees, refunds and other people's shares stay behind the money permission. A new money line below that gate needs its own row here.
- **A departure the reader did not crew contributes nothing**, and a crew member with no tips this week sees no line.

`src/db/crew-tips.test.ts` pins that a captain sees only their own boats' tips, and the render site in `src/app/shop/[shopSlug]/_components/today/DaySpine.tsx` cites this row.

## Unblocks / follow-up

None.

Part of the [human decision log](README.md#decision-register).
