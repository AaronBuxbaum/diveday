# First light — canvas

- **Status:** Live (its ADR is Proposed — this canvas may still be edited)
- **Date:** 2026-08-27
- **ADR:** [20260827-first-light](../../../architecture/decisions/20260827-first-light.md)
- **Published:** https://claude.ai/code/artifact/1c3b7811-c61e-414a-89b1-6e8576d6742d

The fifth design canvas, speaking the Clearwater language
([20260827-clearwater-surface-language](../../../architecture/decisions/20260827-clearwater-surface-language.md))
on the doors — the pages a person meets before any surface the program improved — and on the
shop's first morning. Conventions: [design-artifacts.md](../../design-artifacts.md). **Nothing
here is normative** — the ADR decides; [SPEC.md](SPEC.md) carries journeys, acceptance tests and
interface contracts.

## Artboards

| File | What it shows |
| --- | --- |
| `Main.dc.html` | Sign in at desktop: the door grammar — one column, one act, quiet footer |
| `OnboardPhone.dc.html` | Onboard as the shop's first form: two group labels, the live slug hint, one-line reassurance |
| `Doors.dc.html` | The terminal states as a specimen strip: the ask, sent, and the two dead-link tiers (account never names a shop; booking offers the shop's hand) |
| `FirstMorning.dc.html` | Day zero on the shop home: three presence-derived rows under one group label |
| `FirstBooking.dc.html` | The coral morning: the first booking ever carries the mark, then never again |

`canvas.json` places them and sets the launch view.

## The fiction every board holds to

- **June Okafor opens Torchlight Divers** (Islamorada) on **Tuesday, Sep 1, 2026**: the onboard
  form mid-type (slug `torchlight`, timezone Miami / Key West), then the first morning on
  `/shop/torchlight` — contact and units already settled from signup morning, three steps
  remaining: site, departure, payments. Her first booking, **Ravi Chandra** on Sat Sep 5's
  8:30 AM Two-Tank — Alligator Reef ($110), carries the coral mark.
- **The doors borrow the program's standing week** where a shop must exist: dead booking links
  offer **Blue Mantis Divers** (+1 305 555 0142 · hello@demo.invalid); sign-in shows Dana Reyes's
  email; the claim journey is **Noor Rahman** claiming the second of Yara Halabi's two Saturday
  seats — the same booking the diver's-thread canvas ends on.
- **Tessa Brandt** is Blue Mantis's new hire for the invite journey (F3).

Every name, number and time is demo-seed fiction. Nothing here is real customer data.

## Slices

**A canvas has authority over a surface only while that surface's slice is `open`**
([design-artifacts.md](../../design-artifacts.md)). Slice bodies and pins: [SPEC.md](SPEC.md) and
[roadmap.md](../../../product/features/roadmap.md#10-first-light-design-complete).

| Slice | Status | Lands in | Pinned by |
| --- | --- | --- | --- |
| 10a — the door speaks Clearwater | open | — | — |
| 10b — onboard is the shop's first form | shipped | `src/app/onboard/page.tsx` | `src/components/SuggestShopLink.test.tsx`, `src/app/onboard/copy.test.ts`, `src/app/onboard/actions.instrumentation.test.ts` |
| 10c — claim joins the thread | open | — | — |
| 10d — the first morning | open | — | — |

## Implementing a slice

Load the [`design-implementation`](../../../../.claude/skills/design-implementation/SKILL.md) skill
first. The prompt below is self-contained; replace the slice id.

```
Implement slice 10d of the DiveDay first-light redesign.

Start by loading the `design-implementation` skill, then read, in this order:
  1. docs/architecture/decisions/20260827-first-light.md — normative
  2. docs/architecture/decisions/20260827-clearwater-surface-language.md — the language
  3. the slice's entry in docs/product/features/roadmap.md (section 10)
  4. the slice table in docs/design/canvases/20260827-first-light/README.md
  5. the code for every surface the slice touches, as it exists today
  6. the slice's section of SPEC.md in that canvas directory
  7. the artboards, last — they argue, they do not decide

Non-negotiable, from the ADRs:
  - Shipped code outranks the canvas; the ADR outranks both.
  - Forgot-password stays enumeration-safe; /verify's bare GET never mutates; a dead invite
    never names the shop; a dead booking link always offers the shop's hand.
  - A door renders one primary and nothing else button-shaped; EntryShell/EntryDone stay the
    chokepoints; terminal glyphs are drawn SVG, never emoji.
  - The first morning is presence-derived — zero new columns, nothing dismissable; the coral
    mark renders only while the first booking is the only booking ever.

Build to this repo's standards (tokens, primitives, bundles in every locale, clock and timezone
rules, loading.tsx + instant = true). Close the loop in the same PR: doc comment names the ADR, a
rule test pins the behavior, the slice table updates, the roadmap slice moves on ship. Verify:
pnpm check, light+dark screenshots at phone and desktop, the design-review pass, e2e + visual
coverage. Account for every visual diff.
```

## Working on it

Plain HTML with inline styles — open any board in a browser. Rebuild and republish with the
`/design` skill's helper to the **same URL** above.
