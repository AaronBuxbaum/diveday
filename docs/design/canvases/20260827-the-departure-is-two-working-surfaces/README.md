# The departure is two working surfaces — canvas

- **Status:** Live (its ADR is Proposed — this canvas may still be edited)
- **Date:** 2026-08-27
- **ADR:** [20260827-the-departure-is-two-working-surfaces](../../../architecture/decisions/20260827-the-departure-is-two-working-surfaces.md)
- **Published:** https://claude.ai/code/artifact/17ad2d81-4c8a-45fe-8cf3-c0d972469bd4

The first design canvas in this repo. Read
[design-artifacts.md](../../design-artifacts.md) before editing it, adding another, or treating
anything here as normative — **it is not**. The ADR carries the decisions; these are the pictures
drawn to argue them.

## Artboards

**Page 1 — Surfaces** (the redesigned surfaces at rest)

| File | What it shows |
| --- | --- |
| `Main.dc.html` | The Trip page at desktop width: masthead, the one-line About strip, and the roster as one grouped ledger |
| `Trip.dc.html` | The same page with the About panel open — everything the old Overview tab held, as label/value rows |
| `Manifest.dc.html` | The manifest at desktop width: the count instrument, buddy-team clusters, roll call, crew |
| `TripPhone.dc.html` | The Trip page on a 390px phone, with the staff dock |
| `ManifestPhone.dc.html` | The manifest at the rail: full-screen, no dock, 56px taps, boat-mode ink |
| `System.dc.html` | The design language: the three-tier boat rule, row anatomy, roll-call states, type, colour, and what moved where |

**Page 2 — The boat flow** (the day, in sequence)

| File | What it shows |
| --- | --- |
| `FlowMap.dc.html` | The five stages dock to dock, the invariants every beat keeps, and the edge cases the flow absorbs |
| `DockComplete.dc.html` | Beat 1 — the dock count closes; one diver stayed ashore |
| `IntervalCount.dc.html` | Beat 2 — counting divers back after dive 1, calm: an open circle means "not yet" |
| `NotBack.dc.html` | Beat 3 — the crew records one diver not back; the alarm is earned and pins |
| `PersonSheet.dc.html` | Beat 4 — her sheet: today's trail, buddy states, contact as reference, one act |
| `AllBack.dc.html` | Beat 5 — she is back aboard; the checkpoint closes and the next one is offered |

`canvas.json` places them on the two pages and sets the launch view.

## The fiction every board holds to

One departure: **Sunrise Two-Tank — Molasses Reef**, Fri Sep 11, 7:00–10:30 AM, boat *Mantis II*,
$95 a seat, 12 seats, 10 booked, 2 waiting. Seven divers ready; three blocked at the desk (Amara
Osei and Felix Grant have no certification on file, Mateo Duarte's is awaiting verification). At the
dock all three clear and sail; Georg Fischer oversleeps and stays ashore, carried forward dimmed at
every later checkpoint and outside its denominator. Crew: Keiko Tanaka (divemaster) and Sal Moretti
(captain). Eleven souls sail. After dive 1, Meera Iyer is late up the ladder and is recorded not
back at 8:29, then back aboard at 8:33.

Every name, number and time here is demo-seed fiction. Nothing in this directory is real customer
data, and nothing in a future canvas may be either.

## Slices

Which surfaces this canvas still speaks for. **A canvas has authority over a surface only while that
surface's slice is `open`** — once a slice ships, the shipped code is the design for it and anything
here that disagrees is stale ([design-artifacts.md](../../design-artifacts.md)). The slice bodies,
with their dependencies, are in
[roadmap.md](../../../product/features/roadmap.md#5-the-departures-two-working-surfaces-design-complete).

| Slice | Status | Lands in | Pinned by |
| --- | --- | --- | --- |
| 5a — the boat manifest at phone size | shipped | `src/app/shop/[shopSlug]/trips/[id]/manifest/_components/RollCallControls.tsx` | `src/app/shop/[shopSlug]/trips/[id]/manifest/_components/DiverRollCall.test.tsx` |
| 5b — the person sheet | open | — | — |
| 5c — emergency numbers become buried reference | open | — | — |
| 5d — the roster becomes one grouped ledger | shipped | `src/app/shop/[shopSlug]/trips/[id]/_components/RosterSection.tsx` | `src/app/shop/[shopSlug]/trips/[id]/_components/RosterSection.test.tsx` |
| 5e — Overview folds into Trip's Details panel | open | — | — |
| 5f — emoji status marks become drawn SVG | open | — | — |

`pnpm check:design-canvases` holds this table: a `shipped` row must name a file that exists and
mentions this canvas's ADR id, and a canvas whose slices are all `shipped` or `dropped` may not
still call itself `Live`.

One deliberate deferral: `/offline-manifest` keeps its current composition for now — the
divergence from the live manifest's instrument language is known and accepted until a slice
recomposes it; it inherits component-level restyles only.

Two more things here are stale by design rather than mistakes to redraw:

- The chrome strips in these boards predate H-62 — Close-out is folded into the home, and the
  tab set is Today · Check-in · Divers · Board · More.
- The type ramp and elevation defer to Clearwater 6a
  ([20260827-clearwater-surface-language](../20260827-clearwater-surface-language/SPEC.md)) — the
  weights, trackings and resting-card shadows drawn here predate that language; the layout, the
  tiers, the gestures and the status vocabulary remain this canvas's own.

## Implementing a slice

Load the [`design-implementation`](../../../../.claude/skills/design-implementation/SKILL.md) skill
first — it carries the read order (ADR, roadmap, this table, **current code**, artboards last) and
the four ship-time obligations. The prompt below is self-contained for a session with none of this
context; replace the slice id.

```
Implement slice 5a of the DiveDay trip/manifest redesign.

Start by loading the `design-implementation` skill, then read, in this order:
  1. docs/architecture/decisions/20260827-the-departure-is-two-working-surfaces.md — normative
  2. the slice's entry in docs/product/features/roadmap.md
  3. the slice table in docs/design/canvases/20260827-the-departure-is-two-working-surfaces/README.md
  4. the code for every surface the slice touches, as it exists today
  5. the artboards in that canvas directory, last — they argue, they do not decide

Non-negotiable, from the ADR:
  - Shipped code outranks the canvas; the ADR outranks both. If the canvas disagrees with a
    surface whose slice already shipped, the canvas is stale — leave the code alone and say so.
  - Roll call is never optimistic, and every result keeps its who-and-when.
  - Readiness gates boarding at the dock only; after a dive it is a physical head count.
  - Consequence decides the gesture: aboard is one tap and undoable; not-back is a deliberate
    two-step from the person's sheet; there are no call buttons on the boat.
  - An alarm is earned by a recorded fact, never by the absence of one.
  - Every colour-carried state also carries a word. Drawn SVG, never emoji.
  - The printed manifest keeps every fact the screen tucks away.

Build it to this repo's standards — semantic tokens, the form/button/card primitives, copy in every
locale's message bundle, the clock and timezone rules, a `loading.tsx` and `instant = true`. Then
close the loop in the same PR: the component names the ADR in its doc comment, a test pins the rule
(never a pixel snapshot), the canvas's slice table is updated, and the roadmap slice moves to
shipped.md when it lands.

Verify before calling it done: `pnpm check` green, screenshots in light and dark at phone and
desktop, the design-review skill's pass, an e2e spec and visual capture for the surface, and a
dive-domain-expert review because this is a safety surface. Open a PR and account for every visual
diff — a redesign that moves pixels and reports none captured nothing.
```

## Working on it

These are plain HTML files with inline styles: open one in a browser to see that board on its own.
To rebuild the published canvas from them, use the `/design` skill's helper — seed the artboards
plus `canvas.json` into a fresh payload, `--check` it, and publish to the **same URL** above so the
link in the ADR keeps working.
