# FU-20260815-a-wait-listed-uncertified-diver-is-not-marked-below-the-bar — Decide whether "I'm not certified yet" reads as below the bar on a wait-list row, as it does on the deal panel

- **Status:** Open
- **Raised:** 2026-08-15 — while closing
  FU-20260815-the-wait-list-rows-carry-no-below-the-bar-mark (the wait-list row now says when a
  diver ranks below the departure's minimum).
- **Kind:** question
- **Effort:** S
- **Touches:** `src/app/shop/[shopSlug]/trips/[id]/_components/WaitlistSection.tsx`,
  `src/app/shop/[shopSlug]/trips/[id]/guests/page.tsx`, `src/lib/last-minute-list.ts`

## What I noticed

The two lists on `/shop/<shop>/trips/<id>/guests` now agree about a diver who holds a *level* —
both say *"Open Water · below this departure's minimum"* when the departure asks for Advanced Open
Water. They still disagree about the joiner who answered **"I'm not certified yet"**.

On the deal panel that answer is treated as below *any* requirement a departure sets — a rung, a
specialty, or nitrox — because "there is no card" refutes all three without a comparison
(`ranksBelow`, `src/lib/last-minute-list.ts`). Their row reads *"Not certified yet — diver's word ·
below this departure's minimum"* and is lifted to the top.

On the wait list the same person reads *"Not certified yet — diver's word"*, warning-toned, with an
Invite button beside them — and the departure they would be invited onto may be a gated wreck
charter.

## Why it isn't already done

The change that added the mark was scoped by its own follow-up entry to the ladder comparison:
"when a level is on file and `certificationRank(level) < certificationRank(minimum)`". Only the
rung is passed into `WaitlistSection` (`minimumCertificationLevel`), so the component cannot see a
required specialty or nitrox card and deliberately claims no comparison it cannot make.

Widening it is a small change but a real call, and there is an argument on both sides. In favour:
the invite is one named diver offered one seat, the strongest act of the two, and an uncertified
person is under every bar there is. Against: the wait-list row already says *"Not certified yet —
diver's word"* in warning tone, which is arguably the louder statement, and adding "· below this
departure's minimum" to it is the panel's *ordering* rationale (a capped list that must not hide
anyone) leaking onto a list that is never capped or reordered.

My recommendation is to widen it — the two lists sitting inches apart saying different things about
the same diver is the exact failure the last change was about — but it is a judgement call about
copy density on a safety-adjacent row, not a defect.

## Proposed change

Pass the whole folded `dealRequirement` into `WaitlistSection` instead of only its
`minimumCertificationLevel`, and export the deal panel's `ranksBelow` (or lift it beside
`combineCertRequirements`) so one predicate answers "is this person under this departure's bar" for
both lists. The row keeps rendering
`certificationSummaryBelowRequirementText`; nothing else changes.

**Not** proposed: reordering or filtering the wait list, disabling the Invite button, or a second
tone. The list is leads in the order they asked (ADR 20260813-wait-list-is-a-lead-list) and the mark
is a word, never a colour (ADR 20260814-self-declared-cards decision 4).

## Prompt

```text
Decide whether a wait-listed diver who answered "I'm not certified yet" should read "· below this
departure's minimum" on their row, as the last-minute-deal panel on the same page already says
about the same person, and implement the answer.

Read first, in this order:
  - docs/product/follow-ups/FU-20260815-a-wait-listed-uncertified-diver-is-not-marked-below-the-bar.md
    (this file)
  - docs/architecture/decisions/20260814-self-declared-cards.md, the 2026-08-15 amendment
  - src/lib/last-minute-list.ts — `ranksBelow`, which is the deal panel's answer, including why a
    stated "no card" is below a specialty or nitrox requirement with no comparison
  - src/app/shop/[shopSlug]/trips/[id]/_components/WaitlistSection.tsx and its test, which today
    take only `minimumCertificationLevel` and deliberately compare only the ladder
  - src/app/shop/[shopSlug]/trips/[id]/guests/page.tsx — `dealRequirement` is already folded

Constraints that make this non-obvious:
  - If you widen it, both lists must ask ONE predicate. Two implementations of "is this person
    under the bar" on one page are free to disagree after any edit; that is why the deal panel
    returns the verdict per row rather than recomputing it.
  - Do NOT reorder, filter, or hide anyone on the wait list, and do not disable the Invite button.
    The deal list lifts below-the-bar names because it is capped; a wait list is never capped and
    its order is who asked first.
  - Do not add a second tone. The warning tone means "nobody has seen this card" and only that.
  - No new copy should be needed either way: `shared.certificationSummary.belowRequirement` exists
    in both locales.

Done when: the wait-list row and the deal row say the same thing about the same uncertified diver
(or a comment in WaitlistSection.tsx says in one sentence why they deliberately differ), unit tests
in WaitlistSection.test.tsx cover the decision, pnpm check is green, and
docs/product/follow-ups/FU-20260815-a-wait-listed-uncertified-diver-is-not-marked-below-the-bar.md
is deleted as part of the change.
```
