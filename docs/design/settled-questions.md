# Settled questions

The register of things that **look like a design defect, were investigated, and are right**. It
exists for the same reason [accessibility-tradeoffs.md](accessibility-tradeoffs.md) does: so a
deliberate choice stays visible and revisitable rather than becoming an invisible default that the
next reviewer re-raises from scratch.

A design sweep produces two outputs — the findings, which become issues, and the non-findings. The
repo had a home for the first and none for the second, so every sweep re-derived the same dozen
false positives (issue #826).

## What belongs here

A row goes in when **all** of these are true:

- It genuinely looks like a defect. Somebody reading the surface cold would open an issue about it.
- It genuinely is not, for a reason that survives measurement or reading the code.
- **The reasoning already lives somewhere real** — a doc comment, a test, an ADR — and the row
  points at it. This register is an index, never a second source of truth: a row that *explains*
  rather than *points* is one that can drift away from the code without anyone noticing.

## What does not belong here

- **Anything still true as a defect.** If it is wrong, file it. This is not a place to retire work.
- **A rule.** A rule that applies generally belongs in [principles.md](principles.md) or
  [forms-and-controls.md](forms-and-controls.md); this is for the specific instance a reader will
  trip over.
- **Everything ever considered.** The bar is the one above: without the row, a competent reviewer
  files an issue.

## How to use it

A design review reads this first and adds to it — see the
[design-review skill](../../.claude/skills/design-review/SKILL.md). Adding a row is part of the
sweep that produced it, not a follow-up.

## Register

| Looks wrong | Why it is right | Where the reasoning lives |
| --- | --- | --- |
| Roll call shows "Mark boarded" **and** "Mark not boarded" — the button pair principle 8 forbids | Tri-state, not a toggle: `not_boarded` is a *recorded* no-show and distinct from unrecorded. The two are not peers: the affirmative is a borderless 56px mark on the row, and the exception is a plain bordered control that renders only inside an opened person panel, so it costs a tap on the name first | `src/app/shop/[shopSlug]/trips/[id]/manifest/_components/RollCallControls.tsx` |
| Settings rows point their caret two ways, down on some and right on others | The caret's **direction** is what distinguishes expand (`SettingsRow`, down) from navigate (`SettingsDoorRow`, right); the file documents two shapes over one anatomy | `src/app/shop/[shopSlug]/settings/_components/SettingsRows.tsx` |
| The departure progress bar carries state in colour | The bar is decorative and `aria-hidden`; the exact counts are plain text directly beneath it (principle 6 is about what a *reader* must rely on) | `src/components/BoardingBar.tsx` |
| The orders table's Status column is blank on most rows | "Paid" on 45 of 50 rows is the expected state formatted as information. Blank is principle 9 done right | `src/app/shop/[shopSlug]/orders/page.tsx` |
| The departure log repeats "Awaiting roll call" 33 times | It is an evidentiary document, where an absence is stated rather than left blank | `src/app/shop/[shopSlug]/trips/[id]/log/page.tsx` |
| The trip overview renders three primary buttons | Three sections, 600–1,100 px apart. Principle 8 counts what is on screen *together* | `docs/design/principles.md` §8 |
| The shop home has no good news in it | It has two, outside the row kinds and rendering nothing when untrue: "Today's boats are all clear 🤙" — now "no danger or warning row on any of today's stations or at the desk" — and the whole-week empty state. A demo shop with a full queue shows neither | `src/app/shop/[shopSlug]/_components/today/DaySpine.tsx`, principles.md §3 |
| The gear register's "All home" good news renders in a coral/pink tinted box that reads as an alert | It is the app's one earned-moment vocabulary, and the Today all-clear it is compared against draws the *same* component with the same border and fill — the three hand-rolled versions of this line were unified for exactly that reason (issue 761). Coral appears nowhere else on a page, so the fill is what rations joy rather than a warning tone; a bespoke borderless variant here would re-fork what that change closed | `src/components/EarnedMoment.tsx`, `src/app/shop/[shopSlug]/_components/today/DaySpine.tsx` |
| The tip picker's custom amount field shows no focus ring of its own | Focus shows on the bordered box around the field: its `<label>` wears `has-[:focus-visible]:focus-ring`, the global ring at +2px around the whole box, the way every stand-in for a hidden or partial control does. The field is a 64px strip of that box, so its own ring would circle the digits alone. The pixel probe reads only the input, so it calls this `focus-invisible` | The comment above the preset pills in `src/app/ready/[token]/_components/TipAmountPicker.tsx`; `scripts/pixel-probe-settled.json` |
| A table row's link shows no focus ring on its text | Focus shows on the link's `::after` overlay, the target a pointer actually has: `focus-visible:after:focus-ring-inset` draws the ring inside the overlay's own edge. Ringing the text as well would draw focus twice. The pixel probe reads only an element's own outline, so it calls this `focus-invisible`. How far the overlay reaches, the cell or the whole row, is issue #1989 | `RowLink`'s doc comment in `src/components/ui/table.tsx`; `scripts/pixel-probe-settled.json` |
| Staff surfaces are denser than the diver's | Measured, controls per 1,000 px at rest: Settings **9.1**, public schedule **10.7**, Today **11.6**, Orders **17.0**. Settings is the *calmest* surface in the app. A first measurement that counted inside closed `<details>` was wrong by 6× | issue #826 |
| The course editor's roster link 404s | Reproducible three times at the HTTP level — and only against a dev database where a demo shop had been minted. Pristine database: fine | issue #826 |

The last two are the strongest argument for the register: both were drafted as issues and **killed by
measuring**. Without a written home, the next sweep spends the same afternoon reaching the same answer.
