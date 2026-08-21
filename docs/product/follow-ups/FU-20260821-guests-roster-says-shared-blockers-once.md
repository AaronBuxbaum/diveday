# FU-20260821-guests-roster-says-shared-blockers-once — Group the roster's repeated blocker sentences above the list

- **Status:** Open
- **Raised:** 2026-08-21 — trip-page redesign branch `claude/trip-page-redesign-45e8d6` (shell + Overview slice)
- **Kind:** improvement
- **Effort:** L
- **Touches:** `src/app/shop/[shopSlug]/trips/[id]/guests/page.tsx`, `src/app/shop/[shopSlug]/trips/[id]/_components/RosterSection.tsx`, `src/i18n/locales/en-US/staff/trips.json`, `src/i18n/locales/es-ES/staff/trips.json`, `e2e/trip-admission.spec.ts`, `e2e/depth-and-age-surfaces.spec.ts`, `e2e/visual.spec.ts`

## What I noticed

On a departure where most divers share the same gap, the Guests roster prints the same sentences
once per card. The seeded Wreck Trip renders "Advanced Open Water or higher is required for this
trip.", "Deep specialty is required; no certification is on file.", "Nitrox certification is
required; no certification record is on file." and the identical ~40-word depth advisory
("Reaches 40 m — deeper than the 18 m their certification qualifies them for…") on **nine of ten
cards** — a ~6,700px page whose middle is one warning photocopied nine times. Principle 9 names
this exactly: "A list that would repeat a warning per row states it once above the list."

The sentences are computed per booking (`readinessBlockerText`, `depthWarningText`) — they are not
literally trip-level — but on a real trip with a shared requirement they *resolve* identically for
everyone missing it, and equal-weight repetition drowns the one diver whose blocker is different
(a waiver still unsigned, an outstanding payment).

## Why it isn't already done

Outside the redesign slice that shipped: this changes what several e2e specs assert per card
(`trip-admission`, `depth-and-age-surfaces`, `gear-fit-and-age` assert blocker/advisory wording on
a diver's card) and touches how readiness is displayed, which is safety-adjacent and deserves its
own `dive-domain-expert` review rather than riding along in a visual PR. There is also a written
decision in `RosterSection.tsx` (~line 535) that deliberately keeps every card's work block open —
the grouping has to be designed so a per-diver "why can't *this* person board" answer never
degrades at the card.

## Proposed change

Aggregate identical blocker sentences (and the identical depth advisory) across the visible
roster: any sentence shared by ≥3 cards moves into one grouped strip above the list — "7 divers
need Advanced Open Water or higher", with the depth advisory said once — while each affected card
keeps a short per-diver line naming only its blockers (compact labels, not the full sentences),
plus everything unique to that diver at full length. The `?rf=blocked` filter and per-card
actions stay exactly as they are. Not proposing: collapsing settled cards (separately decided
against, see the RosterSection comment), or moving any per-diver *action* off its card.

## Prompt

```text
In the DiveDay repo, apply principle 9 ("say a shared fact once") to the staff trip Guests
roster. Read docs/design/principles.md #9, then
"src/app/shop/[shopSlug]/trips/[id]/_components/RosterSection.tsx" (including the design comment
around line 535 that deliberately keeps each card's work block open — do not collapse settled
cards), "src/i18n/readiness-labels.ts", and "src/i18n/depth-labels.ts". On the guests page,
blocker sentences and depth advisories that render identically on 3+ cards should be stated once
in a grouped strip above the roster with a diver count; affected cards keep a compact per-diver
line naming their own blockers, and any blocker unique to a diver keeps its full sentence on the
card. All copy goes through src/i18n/locales/*/staff/trips.json in both en-US and es-ES. Update
the assertions in e2e/trip-admission.spec.ts, e2e/depth-and-age-surfaces.spec.ts and any other
spec pinning per-card blocker wording, and the trip-guests visual captures list if capture
composition changes. Launch a dive-domain-expert review of the result — readiness display is
safety-adjacent. Run pnpm check and the touched e2e specs. Delete
docs/product/follow-ups/FU-20260821-guests-roster-says-shared-blockers-once.md in the same
change.
```
