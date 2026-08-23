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
| Roll call shows "Mark boarded" **and** "Mark not boarded" — the button pair principle 8 forbids | Tri-state, not a toggle: `not_boarded` is a *recorded* no-show and distinct from unrecorded. The exception control drops its border to demote itself | `src/app/shop/[shopSlug]/trips/[id]/manifest/_components/RollCallControls.tsx` |
| The Today queue pills two kinds and leaves the rest in bare caps | Deliberate — a pill renders only for danger and warning, with the contrast arithmetic for both in the file. It *is* principle 9 applied, not an omission of it | `src/app/shop/[shopSlug]/_components/today/KindChip.tsx` |
| Settings rows use `›` and `⌄` interchangeably | The chevron's **direction** is what distinguishes navigate from expand; the file documents three shapes over one anatomy | `src/app/shop/[shopSlug]/settings/_components/SettingsRows.tsx` |
| The departure progress bar carries state in colour | The bar is decorative and `aria-hidden`; the exact counts are plain text directly beneath it (principle 6 is about what a *reader* must rely on) | `src/components/BoardingBar.tsx` |
| The orders table's Status column is blank on most rows | "Paid" on 45 of 50 rows is the expected state formatted as information. Blank is principle 9 done right | `src/app/shop/[shopSlug]/orders/page.tsx` |
| The departure log repeats "Awaiting roll call" 33 times | It is an evidentiary document, where an absence is stated rather than left blank | `src/app/shop/[shopSlug]/trips/[id]/log/page.tsx` |
| Tone glyphs are emoji (✅ ⚠️ ❌) | Text dingbats were tried and reverted — they read as a font falling back | `src/components/ui/tone.ts` |
| The trip overview renders three primary buttons | Three sections, 600–1,100 px apart. Principle 8 counts what is on screen *together* | `docs/design/principles.md` §8 |
| The shop home has no good news in it | It has two, outside the row kinds and rendering nothing when untrue: "Today's boats are all clear 🤙" and the queue's empty state. A demo shop with a full queue shows neither | `src/app/shop/[shopSlug]/_components/today/TodayQueue.tsx`, principles.md §3 |
| Staff surfaces are denser than the diver's | Measured, controls per 1,000 px at rest: Settings **9.1**, public schedule **10.7**, Today **11.6**, Orders **17.0**. Settings is the *calmest* surface in the app. A first measurement that counted inside closed `<details>` was wrong by 6× | issue #826 |
| The course editor's roster link 404s | Reproducible three times at the HTTP level — and only against a dev database where a demo shop had been minted. Pristine database: fine | issue #826 |

The last two are the strongest argument for the register: both were drafted as issues and **killed by
measuring**. Without a written home, the next sweep spends the same afternoon reaching the same answer.
