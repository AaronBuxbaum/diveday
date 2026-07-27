# DiveDay — design-partner one-pager

Leave-behind for a Phase 1 design-partner conversation (dock visit, warm intro, ScubaBoard/Facebook
follow-up, or an EVE/DiveShop360 defector). The founder personalizes this before every conversation
— the shop's name, which of the three profiles they fit, and which incumbent they're leaving if
any — and delivers it in person or by email himself; it is never sent automatically. Source of the
offer and phases: [rollout.md](../rollout.md#phase-1--design-partners-septoct-2026). Governed by
the [claims policy](../marketing.md) like any other buyer-facing material — see the
`commercial-outreach` skill before editing.

---

## What DiveDay is

A calmer way to run a dive day: bookings, waivers, cert checks, rental-fit trip prep, and the boat
manifest in one place, so the front desk, the boat, and the diver share one source of truth instead
of a whiteboard, a clipboard, and three apps. Built for the shop that's tired of chasing paperwork
the morning of a trip. (Feature claims below are drawn from `productFeatureGroups` in
`src/lib/marketing.ts` — keep this list in sync with that file, not the other way around.)

- A live schedule divers book themselves — never past what the boat can hold.
- Waivers signed from home, with medical flags raised long before the boat; C-cards verified once
  and kept with the diver.
- Every diver's rental sizes on the trip's prep list — the boat is packed without a clipboard.
- Roll call that keeps working with no signal, saved to a phone, print backup included.
- A one-ZIP export of the shop's own records, any time, no phone call, no fee.

## The offer — free, hands-on, and real

- **Free through the pilot.** No cost, no card, no commitment beyond the conversation below.
- **Founder-run concierge migration.** The shop sends its own export from its current system —
  DiveDay never logs into another system on their behalf, ever. The founder maps the data and
  imports it personally.
- **A weekly 30-minute call** and a **direct line to the founder** (shared thread), for the length
  of the pilot — not a support ticket queue.
- **The founding-shop price, locked for two years**, if and when the pilot converts — today's
  founding price from `earlyAccessPrice` in `src/lib/marketing.ts`; state the live number from that
  page or the pricing page when presenting this, never a number written down here.

In exchange: the shop runs real dive days on DiveDay, lets the founder watch and learn from what
breaks, and — if it goes well — agrees to a named quote or case study (consent terms live in the
pilot agreement, not here).

## Is this shop a fit? (bring the right pitch)

1. **Boat-charter-heavy** (daily two-tank trips) — the pitch is the manifest, roll call, and prep
   list replacing the pre-trip scramble.
2. **Course-heavy** (steady Open Water pipeline) — the pitch is the course catalog, sessions, and
   waiver/medical flow for students.
3. **Leaving EVE or DiveShop360** — the pitch is the concierge migration plus the live
   `/switching` guide for their specific system: their own export click-path, the import honesty
   table, nothing glossed over.

## What happens next

1. This conversation — answer questions, show the demo shop live on a phone (the dock demo).
2. If they're in: the pilot agreement (data handling, case-study/quote rights, no-warranty
   posture — [legal.md](legal.md)'s contract set).
3. Week 0: concierge import of their real upcoming week, staff accounts, one training session with
   front desk and a captain.
4. Weeks 1–4: they run real trips; the founder tracks the [metrics](../rollout.md#metrics--the-scoreboard)
   and is present for the first boat day.

## Notes for whoever's presenting this

- State the live price from `src/lib/marketing.ts` / the pricing page in conversation — never read
  a number off this document, since it isn't the source of truth and can drift.
- Everything above is already authorized (rollout.md, H-12 in
  [human-decisions.md](../human-decisions.md)) — don't improvise a new commitment (a discount, a
  different lock period, a feature promise) in the room. If a shop asks for something not on this
  page, note it and take it back rather than agreeing on the spot.
- The insurer one-pager ([insurance.md](insurance.md)) answers "does this affect my coverage?" —
  have it ready; it usually comes up in the first conversation.
