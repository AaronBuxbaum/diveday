# People, not lists — canvas

- **Status:** Live (its ADR is Proposed — this canvas may still be edited)
- **Date:** 2026-08-27
- **ADR:** [20260827-people-not-lists](../../../architecture/decisions/20260827-people-not-lists.md)
- **Published:** https://claude.ai/code/artifact/05b97947-119c-4019-9af0-8181097ff233

The fourth design canvas, speaking the Clearwater language
([20260827-clearwater-surface-language](../../../architecture/decisions/20260827-clearwater-surface-language.md))
on the staff surfaces about people. Conventions:
[design-artifacts.md](../../design-artifacts.md). **Nothing here is normative** — the ADR decides;
[SPEC.md](SPEC.md) carries journeys, acceptance tests and interface contracts.

## Artboards

| File | What it shows |
| --- | --- |
| `Main.dc.html` | The diver record with its one idea: a status ledger that leads (and renders nothing when clear), the story as one ledger, the file as inset groups, Book as the one primary |
| `DiverPhone.dc.html` | The record on a phone: status, story, the file as doors |
| `Divers.dc.html` | The roster as one ledger, grouped by initial letter, badges only for exceptions |
| `Reviews.dc.html` | Reviews as a worklist: "Waiting on you" leads, the four stat tiles collapse to one aggregate line |
| `Waivers.dc.html` | The waiver surface: materiality as a choice then one Publish, and the signature log as a day-grouped ledger |
| `Requests.dc.html` | Date requests: day groups own the count and the advice, one quiet act per group |

`canvas.json` places them and sets the launch view.

## The fiction every board holds to

The same Blue Mantis week as the Clearwater and diver's-thread canvases, read at three declared
moments:

- **Wednesday evening, Aug 26** — the record and the roster. **Grace Mensah** (grace.m@example.com
  · +1 305 555 0177 · DAN insurance on file · second visit): booked on Thursday's 7:00 Two-Tank
  Reef — Molasses &amp; French, paid $95, waiver signed Wednesday 4:18 PM against release v4; her
  PADI Open Water (card ···7231, added Wednesday by Grace) waits for verification — the record's
  one open item; sizes BCD M · wetsuit ML long · fins 38, rents BCD and wetsuit; one note (Dana,
  Aug 26: prefers a long wetsuit); past: Jul 12 Benwood &amp; Elbow, and a Mar 3 visit brought
  across from the old system. Roster facts: 312 divers; Diego Alvarez carries an open
  balance (his $120 night-dive order) and is booked Thu 7:30 PM; Priscilla Adeyemi, Bjorn Aasen,
  Sofia Marchetti and Yara Halabi last aboard Wed Aug 26; Omar Haddad Sun Aug 23; Meera Iyer Fri
  Aug 21; Hana Kobayashi is imported history.
- **Thursday night, Aug 27** — the waiver surface. Release v4 (published Aug 12), 27 standing
  signatures, 4 boarding within 14 days; signed today: Priya Sharma's paper signature recorded by
  Keiko at 6:41 AM (she signed at the counter before boarding the 7:00 boat), Yara Halabi
  9:41 PM, Noor Rahman 10:07 PM (one flagged medical answer); Wednesday: Grace 4:18 PM, and Lena
  Fischer's paper signature recorded by Dana (not sealed).
- **Monday, Aug 31** — reviews. ★4.3 across 83 published, 4.6 from 12 this month; waiting: Yara's
  five stars (the turtle, from Saturday's French Reef boat) and Diego's three stars (choppy
  ride, from the Thursday night dive);
  published: Lars P.'s standout, Sofia M.'s four stars, one rating-only; hidden: one one-star
  hidden by Dana (not about the diving). Requests: Priya Sharma (3 divers, certified, Fri Sep 4
  flexible), Emmet O&#8217;Brien (2, Sep 4–5), June Park (2, Sep 9, Discover Scuba ask), Marisol
  Vega (refresher, any weekday).

Every name, number and time is demo-seed fiction. Nothing here is real customer data.

## Slices

**A canvas has authority over a surface only while that surface's slice is `open`**
([design-artifacts.md](../../design-artifacts.md)). Slice bodies and pins: [SPEC.md](SPEC.md) and
[roadmap.md](../../../product/features/roadmap.md#8-people-not-lists-design-complete).

| Slice | Status | Lands in | Pinned by |
| --- | --- | --- | --- |
| 8a — the shared person-row vocabulary | open | — | — |
| 8b — the diver record recomposition | open | — | — |
| 8c — the roster ledger | open | — | — |
| 8d — reviews as a worklist | open | — | — |
| 8e — the waiver surface | open | — | — |
| 8f — requests in the language | open | — | — |

## Implementing a slice

Load the [`design-implementation`](../../../../.claude/skills/design-implementation/SKILL.md) skill
first. The prompt below is self-contained; replace the slice id.

```
Implement slice 8b of the DiveDay people-not-lists redesign.

Start by loading the `design-implementation` skill, then read, in this order:
  1. docs/architecture/decisions/20260827-people-not-lists.md — normative
  2. docs/architecture/decisions/20260827-clearwater-surface-language.md — the language
  3. the slice's entry in docs/product/features/roadmap.md (section 8)
  4. the slice table in docs/design/canvases/20260827-people-not-lists/README.md
  5. the code for every surface the slice touches, as it exists today
  6. the slice's section of SPEC.md in that canvas directory
  7. the artboards, last — they argue, they do not decide

Non-negotiable, from the ADRs:
  - Shipped code outranks the canvas; the ADR outranks both.
  - The record's status ledger renders nothing when the diver is clear; Book is the one primary.
  - Badges mark exceptions only; counts are quiet text; groups own shared facts.
  - H-54's materiality semantics, the review-suppression floor, merge/erase gates and every
    personal-data behavior are contracts — only rendering moves. security-reviewer before merge.
  - Every colour-carried state also carries a word; drawn SVG, never emoji, on anything new.

Build to this repo's standards (tokens, primitives, bundles in every locale, clock and timezone
rules, loading.tsx + instant = true). Close the loop in the same PR: doc comment names the ADR, a
rule test pins the behavior, the slice table updates, the roadmap slice moves on ship. Verify:
pnpm check, light+dark screenshots at phone and desktop, the design-review pass, e2e + visual
coverage. Account for every visual diff.
```

## Working on it

Plain HTML with inline styles — open any board in a browser. Rebuild and republish with the
`/design` skill's helper to the **same URL** above.
