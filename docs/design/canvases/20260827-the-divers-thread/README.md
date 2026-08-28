# The diver's thread — canvas

- **Status:** Live (its ADR is Proposed — this canvas may still be edited)
- **Date:** 2026-08-27
- **ADR:** [20260827-the-divers-thread](../../../architecture/decisions/20260827-the-divers-thread.md)
- **Published:** https://claude.ai/code/artifact/4393533c-ccf3-49c7-b58d-36388528148f

The third design canvas in this repo, speaking the Clearwater language
([20260827-clearwater-surface-language](../../../architecture/decisions/20260827-clearwater-surface-language.md))
on the diver's side of the product. Conventions:
[design-artifacts.md](../../design-artifacts.md). **Nothing here is normative** — the ADR decides;
[SPEC.md](SPEC.md) beside these boards carries the journeys, acceptance tests and interface
contracts.

## Artboards

| File | What it shows |
| --- | --- |
| `Main.dc.html` | The journey map: five beats on one link, and the six invariants every beat keeps |
| `TripPhone.dc.html` | The booking page on a phone, unrolled: hero (price once), pitch, one-line requirement, the terminal form with the money as one block |
| `TripDesktop.dc.html` | The same page at desktop — the thread measure holds, centered |
| `ReadyPhone.dc.html` | The thread page, prep state: one status figure, settled steps as check lines, the current step open inline, future steps quiet |
| `WaiverPhone.dc.html` | The waiver at the Sign step: the step rail, the release fully present, medical settled to a line, one primary |
| `AfterPhone.dc.html` | The same link after the boat is home: the keepsake record, the crew's word, one review ask, quiet doors |

`canvas.json` places them and sets the launch view.

## The fiction every board holds to

The same Blue Mantis Divers as the Clearwater canvas, two days later in the same week. On
**Thursday evening (Aug 27)**, Yara Halabi books the last two spots on **Saturday's Two-Tank —
French Reef** (Sat, Aug 29 · 11:00 AM – 2:30 PM · Mantis II · Keiko Tanaka, Sal Moretti · $95) for
herself and **Noor Rahman** — which is what turns the storefront's "Only 2 spots left" into the
staff board's full boat. She pays **$235** at booking ($190 fare + $45 full rental set for Noor;
tax added at checkout). Yara's Advanced card is verified; Noor claims their seat and their
self-declared Open Water sits with the shop for verification; both waivers are signed Thursday
night (Yara's emergency contact: Samir Halabi). Prep state on Yara's own thread — the thread is
strictly per-booking: 2 of 4 steps done (her waiver signed · Thu, $235 paid · Thu evening; French
Reef gates no certification, so no such step renders), next is her own gear sizes, and Day-of
waits. Noor's facts — seat claimed, waiver signed — read in the footer's party section, never as
steps in Yara's spine. Saturday delivers 27&deg;C water, 24 m of visibility, calm seas, dives to 12 m and 14 m
(French Reef swim-throughs, White Sand Bottom Cave), a green turtle on tank two, Keiko's shoutout,
and a five-star review in the seed's own words. It is Yara's third dive day with the shop.

Every name, number and time is demo-seed fiction. Nothing here is real customer data.

## Slices

**A canvas has authority over a surface only while that surface's slice is `open`**
([design-artifacts.md](../../design-artifacts.md)). Slice bodies and pins:
[SPEC.md](SPEC.md) and
[roadmap.md](../../../product/features/roadmap.md#7-the-divers-thread-design-complete).

| Slice | Status | Lands in | Pinned by |
| --- | --- | --- | --- |
| 7a — the thread shell and measure | shipped | `src/components/thread/ThreadShell.tsx` | `src/components/thread/ThreadShell.test.tsx` |
| 7b — the trip page sells, then closes | shipped | `src/app/s/[shopSlug]/trips/[id]/_components/MoneyBlock.tsx` | `src/app/s/[shopSlug]/trips/[id]/page.composition.test.ts` |
| 7c — the thread page's step spine | shipped | `src/lib/thread-steps.ts` | `src/lib/thread-steps.test.ts`, `src/app/ready/[token]/page.composition.test.ts` |
| 7d — the after-state and the recap fold | open | — | — |
| 7e — the waiver paces itself | open | — | — |

## Implementing a slice

Load the [`design-implementation`](../../../../.claude/skills/design-implementation/SKILL.md) skill
first. The prompt below is self-contained; replace the slice id.

```
Implement slice 7a of the DiveDay diver's-thread redesign.

Start by loading the `design-implementation` skill, then read, in this order:
  1. docs/architecture/decisions/20260827-the-divers-thread.md — normative
  2. docs/architecture/decisions/20260827-clearwater-surface-language.md — the language it speaks
  3. the slice's entry in docs/product/features/roadmap.md (section 7)
  4. the slice table in docs/design/canvases/20260827-the-divers-thread/README.md
  5. the code for every surface the slice touches, as it exists today
  6. the slice's section of SPEC.md in that canvas directory
  7. the artboards, last — they argue, they do not decide

Non-negotiable, from the ADRs:
  - Shipped code outranks the canvas; the ADR outranks both.
  - One measure on the thread; status said once by the spine; money resolves in one block.
  - Coral fires exactly three times: booked, paperwork done, home from the dive.
  - The release text stays fully presented; waiver/medical wording stays English (H-01/H-03).
  - The embed contract, JSON-LD, capability-token discipline and anti-enumeration behavior of
    find-my-booking are untouched.
  - Every colour-carried state also carries a word; drawn SVG, never emoji, on anything new.

Build to this repo's standards (tokens, primitives, bundles in every locale, clock and timezone
rules, loading.tsx + instant = true). Close the loop in the same PR: doc comment names the ADR, a
rule test pins the behavior, the slice table updates, the roadmap slice moves on ship. Verify:
pnpm check, light+dark screenshots at phone and desktop, the design-review pass, e2e + visual
coverage, conversion-reviewer for the trip page and after-state. Account for every visual diff.
```

## Working on it

Plain HTML with inline styles — open any board in a browser. Rebuild and republish with the
`/design` skill's helper to the **same URL** above.
