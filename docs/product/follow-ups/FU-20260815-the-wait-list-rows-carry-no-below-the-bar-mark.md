# FU-20260815-the-wait-list-rows-carry-no-below-the-bar-mark — Say on a wait-list row that this diver ranks below the departure's minimum, as the deal list now does

- **Status:** Open
- **Raised:** 2026-08-15 — the `dive-domain-expert` review of the change that added the mark to the
  last-minute-deal recipient list (ADR 20260814-self-declared-cards, 2026-08-15 amendment).
- **Kind:** improvement
- **Effort:** S
- **Touches:** `src/app/shop/[shopSlug]/trips/[id]/_components/WaitlistSection.tsx`,
  `src/app/shop/[shopSlug]/trips/[id]/guests/page.tsx`, `src/i18n/readiness-labels.ts`,
  `e2e/visual.spec.ts`

## What I noticed

`/shop/<shop>/trips/<id>/guests` draws two lists of people the shop might contact about this
departure, and they now behave differently.

On the **last-minute-deal** panel a recipient who ranks below the departure's effective minimum reads
*"Open Water · below this departure's minimum"*. On the **wait-list** panel twelve inches up the same
page, the identical diver reads *"Open Water"* in calm muted text, with an **Invite** button beside
their name.

The reasoning written into the shared label function said the wait list has "no trip in hand and so
no bar to be under". That is false about DiveDay's own model: a wait list is per-trip
(`trip_waitlist_entries.trip_id`, ADR 20260813-wait-list-is-a-lead-list), and `guests/page.tsx` has
already folded that departure's requirement into `dealRequirement` at the top of the same render, for
the panel below. The docstring and the ADR now say the real reason, which is scope — this entry.

The wait-list invite is arguably the act that needs the mark more. The deal blast is bulk mail; the
invite is a staffer, one person at a time, deliberately offering a freed seat on this exact
departure to a named diver.

## Why it isn't already done

The change that added the mark was scoped to the deal panel — that was the screen the finding came
off, and the session that did it did not own `WaitlistSection.tsx`'s surrounding page. Doing it
properly also needs a decision the deal panel did not: the deal list already *reorders* to lift
below-the-bar names to the top, and a wait list explicitly must not be reordered (it is a set of
leads, not a queue, and its order is "who asked first"). So this is the mark without the ordering,
which is a slightly different shape and worth doing deliberately.

## Proposed change

Pass the folded requirement into `WaitlistSection` and mark the row with the sibling that already
exists.

1. `guests/page.tsx` already computes `dealRequirement` (`combineCertRequirements` over the trip and
   every site it visits). Pass its `minimumCertificationLevel` to `WaitlistSection`.
2. In the row, when a level is on file and `certificationRank(level) < certificationRank(minimum)`,
   render `certificationSummaryBelowRequirementText` instead of `certificationSummaryText`
   (`src/i18n/readiness-labels.ts`). No new copy: the phrase and both locales already exist.
3. Leave the **tone** alone. It means "nobody has seen this card" and only that.
4. Re-shoot the wait-list visual capture.

**Not** proposed: reordering the wait list, filtering it, hiding anyone, or disabling the Invite
button. A wait list is leads in the order they asked, and this informs the staffer who is about to
choose (ADR 20260813-wait-list-is-a-lead-list, ADR 20260814-self-declared-cards decision 4).

## Prompt

```text
Make a wait-list row say, in words, that the diver ranks below the departure's certification
minimum — exactly as the last-minute-deal recipient list beside it already does.

Read first, in this order:
  - docs/product/follow-ups/FU-20260815-the-wait-list-rows-carry-no-below-the-bar-mark.md (this file)
  - docs/architecture/decisions/20260814-self-declared-cards.md, the 2026-08-15 amendment: it argues
    why the mark is a word and never a second tone, and why the tone must keep meaning exactly one
    thing ("nobody has seen this card")
  - docs/architecture/decisions/20260813-wait-list-is-a-lead-list.md
  - src/app/shop/[shopSlug]/trips/[id]/_components/WaitlistSection.tsx and its test
  - src/app/shop/[shopSlug]/trips/[id]/guests/page.tsx (see `dealRequirement`, already folded)
  - src/i18n/readiness-labels.ts — `certificationSummaryText` and its sibling
    `certificationSummaryBelowRequirementText`, which is the function to call

Constraints that make this non-obvious:
  - Do NOT reorder, filter, or hide anyone, and do not disable the Invite button. The deal list
    lifts below-the-bar names to the top; a wait list may not, because its order is who asked
    first. This is the mark without the ordering.
  - Do NOT widen `certificationSummaryText` with a trip-shaped parameter — the sibling exists so a
    caller with no departure in hand cannot say something it cannot know.
  - Do not overload the warning tone. Colour is never the only carrier of meaning
    (docs/design/principles.md #6).
  - No new strings: the phrase exists in both locales as `shared.certificationSummary.belowRequirement`.
    If you do add one, both en-US and es-ES in the same change (pnpm check:locale), and read
    src/i18n/locales/es-ES/README.md first.

Done when: a wait-listed Open Water diver on an Advanced Open Water departure reads "Open Water ·
below this departure's minimum" on their own row, with a unit test in WaitlistSection.test.tsx
covering both the marked and unmarked cases and one asserting the tone still tracks only whether a
card has been seen; the wait-list visual capture is re-shot; pnpm check is green; and
docs/product/follow-ups/FU-20260815-the-wait-list-rows-carry-no-below-the-bar-mark.md is deleted as
part of the change.
```
