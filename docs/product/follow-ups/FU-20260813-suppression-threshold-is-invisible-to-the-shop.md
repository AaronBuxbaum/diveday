# FU-20260813-suppression-threshold-is-invisible-to-the-shop — Tell a shop when its star rating has stopped being published, and why

- **Status:** Open
- **Raised:** 2026-08-13 — branch `claude/decision-workflow-options-mn0a2k`, building
  ADR 20260813-review-moderation-has-a-floor.
- **Kind:** half-done
- **Effort:** S
- **Touches:** `src/app/shop/[shopSlug]/reviews/page.tsx`, `src/lib/reviews.ts`,
  `src/i18n/locales/en-US/staff/reviews.json`

## What I noticed

A shop can now lose its search-result stars and have no way to find out.

`ratingIsRepresentative` (`src/lib/reviews.ts`) decides whether DiveDay emits schema.org
`aggregateRating` for a shop: once more than one in five of the reviews it has ruled on have been
taken down, the tag is withheld. The rule is right and the shop is unaffected on its own page — the
average still renders on `/s/<shop>` above the reviews it comes from.

What is missing is the telling. The staff Reviews page shows the public rating, the published count,
and the waiting count. It does not show how many reviews the shop has hidden, does not name the
threshold, and says nothing when the shop is over it. So the sequence a real shop hits is: hide four
reviews across two months, each for a reason that felt fine at the time, and silently stop appearing
with stars in Google — with the Reviews page still cheerfully showing "4.9".

The failure is worse than it sounds because the fix is entirely in the shop's hands: republishing one
review can put it back under the line. A shop that knew would act. A shop that does not know
experiences it as DiveDay's SEO getting worse.

This is not the same thing as arguing with the shop about its moderation. The rating is withheld
either way; the question is only whether the shop is told.

## Why it isn't already done

Scope, and a genuine question about tone I did not want to answer inside a branch that was already
changing the moderation flow.

The mechanism shipped: `getShopReviewAggregate` returns `suppressedCount`, so the page has the number
it needs with no new query. What it does not have is the words, and the words are the whole
difficulty. "Your rating is no longer published because you hide too many reviews" reads as an
accusation, and the shops most likely to see it first are the honest ones with five reviews and one
piece of spam — where one removal out of six is 17%, fine, and two is 29%, not fine, on a sample far
too small for the rule to mean much.

That last point is the real open question and it is worth answering before writing any copy:
**should the threshold have a floor under it?** A shop with three reviews and one hidden is at 25%
and loses its stars over a single act; a shop with two hundred is not meaningfully constrained by the
same ratio. A minimum judged count (say, ten) before the rule bites would match how the rest of the
product treats thin samples — but it also opens a small window where suppression is unconstrained,
which is exactly the state this ADR closed. I lean toward adding the floor and stating it, because
the alternative punishes shops for having few reviews, but it is a policy call.

## Proposed change

1. Answer the small-sample question first. If a floor is added, it goes in `src/lib/reviews.ts` beside
   `MAX_SUPPRESSED_SHARE_FOR_RATING` as a named constant with its reasoning, and
   `ratingIsRepresentative` returns true below it — with unit tests for the boundary in
   `src/lib/reviews.test.ts`.
2. Show the hidden count as a third `ShopStat` on the Reviews page, beside the public rating and the
   waiting count. A number the shop can see is most of the fix.
3. When `ratingIsRepresentative` is false, render a `StaffNoticeBanner` (tone `warning`) stating
   plainly what has happened and what changes it: the rating is still on the shop's own page, it is
   no longer published to search engines, and republishing brings it back. Address the situation, not
   the shop's character — no implication of bad faith, because the common case is not bad faith.
4. Copy in both locale bundles. A visual capture if the banner is more than one line.

Do **not** add a per-review "this hide cost you your rating" cue: the threshold is about a record,
not an act, and attaching it to whichever review happened to cross the line would misdescribe it.

## Prompt

```text
Tell a DiveDay shop when its star rating has stopped being published to search engines because too
much of its review record is hidden — and decide whether the threshold needs a small-sample floor.

Read first:
  - docs/product/follow-ups/FU-20260813-suppression-threshold-is-invisible-to-the-shop.md (this file)
  - docs/architecture/decisions/20260813-review-moderation-has-a-floor.md — the rule and why it exists
  - src/lib/reviews.ts — ratingIsRepresentative, MAX_SUPPRESSED_SHARE_FOR_RATING
  - src/app/shop/[shopSlug]/reviews/page.tsx — the ShopStat row and the notice banner it already has
  - src/lib/structured-data.ts — aggregateRatingOf, the one consumer of the rule

Answer this before writing copy: should the rule bite at all for a shop with very few reviews? Three
reviews with one hidden is 25% and loses its stars over a single act; two hundred with forty hidden
is the case the rule is actually for. A minimum judged count before it applies would match how the
rest of the product treats thin samples, at the cost of a small window where suppression is
unconstrained. State the answer in the ADR (amend it) either way.

Done means: the hidden count is visible on the Reviews page; a shop over the line gets a warning
banner saying the rating is still on its own page, is no longer published to search engines, and
comes back if it republishes — worded as a situation, never as an accusation; copy in BOTH locale
bundles; boundary unit tests in src/lib/reviews.test.ts if the floor is added.

Run pnpm check, then pnpm test src/lib/reviews.test.ts src/db/reviews.test.ts --reporter=dot.

Delete docs/product/follow-ups/FU-20260813-suppression-threshold-is-invisible-to-the-shop.md as part
of the change.
```
