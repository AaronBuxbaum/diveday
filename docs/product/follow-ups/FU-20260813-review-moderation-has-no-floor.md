# FU-20260813-review-moderation-has-no-floor — Decide what a shop may hide, given the survivors are published as a star rating

- **Status:** Open
- **Raised:** 2026-08-13 — branch `claude/follow-up-decisions-xgj9o3`, a sweep of the codebase for
  policy questions the product currently answers by accident rather than by decision.
- **Kind:** question
- **Effort:** M
- **Touches:** `src/lib/reviews.ts`, `src/db/reviews.ts`, `src/lib/structured-data.ts`,
  `src/app/shop/[shopSlug]/reviews`, `src/app/s/[shopSlug]/page.tsx`

## What I noticed

A shop moderates its own reviews with no constraint at all, and the set that survives is published to
Google as a machine-readable rating.

Two mechanisms combine into something neither one intends on its own.

**The publish rule is about words, not about content.** `publishesImmediately`
(`src/lib/reviews.ts`) is the whole moderation policy: a review carrying a comment waits for staff,
because those words land on the shop's public page; a bare rating with no comment counts the moment
it is given, because there is no text to moderate. Reasonable as written.

**The hide power is unconditional.** `setReviewPublished` (`src/db/reviews.ts`) clears `publishedAt`
on any review in the shop, with no reason captured, no record of the act, and no distinction between
a review that was never published and one the shop took down. That includes the bare 1-star that
published itself under the rule above. So the "publishes immediately" path is not a floor — it is a
default that a single tap reverses.

**What survives is presented as an impartial measurement.** `reviewAggregate` averages only published
rows, and `aggregateRatingOf` (`src/lib/structured-data.ts`) emits that average and count as
schema.org `aggregateRating` in the JSON-LD on the public schedule page — the field search engines
read to draw star ratings beside a result. The same number renders on `/s/<shop>` above the fold.

The `trip_reviews` schema docblock explains why this is invisible from the outside, while arguing for
something else entirely: aggregates are computed over published rows only *"so the number a visitor
sees and the reviews under it always describe the same set."* That is a good property — it stops a
4.2 sitting above a list of five-star reviews. It also means curation is internally consistent by
construction: hide the bad ones and the average moves to match, so there is no seam a reader could
notice. Nothing is wrong with the reasoning; it just was not written with a shop deliberately pruning
in mind.

Put together: a shop can hide every review below five stars, keep a 5.0 average over a count that
looks credible, and have DiveDay publish it in a format designed to be trusted by a machine. Nothing
in the product prevents it, records it, or discloses it. A diver reading the stars has no way to know
they are looking at a curated set, and DiveDay is the party making the machine-readable claim.

## Why it isn't already done

It is a policy question about whose page it is, and it has a legal edge I am not qualified to weigh.

The honest case for leaving it alone: `/s/<shop>` is the shop's own page, the reviews are its own
customers', and every shop on every platform curates its testimonials. DiveDay is not TripAdvisor and
has never claimed the reviews are an independent verdict — the ADR that introduced them
(20260729-verified-diver-reviews) is about making them *verified*, not about making them impartial.
Constraining a shop's control over its own page is a real product cost, and a shop that finds itself
unable to remove a review naming a diver by name, or written about the wrong trip, will be angry with
DiveDay rather than with the reviewer.

The case against: the moment DiveDay emits `aggregateRating`, it stops being the shop's testimonial
wall and becomes a rating DiveDay vouches for to third parties. The FTC's 2024 Rule on Consumer
Reviews and Testimonials treats suppressing negative reviews while presenting the remainder as
representative as a deceptive practice, and Google's own structured-data policies require that
`aggregateRating` reflect a genuine, unbiased set. Both land on the *platform* as well as the
business. This is jurisdiction- and counsel-shaped, which is why it is a question rather than a
change I made.

**Recommendation, as a middle path:** keep the shop's ability to take a review down, but make it
a recorded act with a stated reason drawn from a short list (abuse or harassment, names a person,
about a different trip or shop, spam), and stop emitting `aggregateRating` for a shop whose hidden
count is a large enough share of its total. The shop keeps control of its page; DiveDay stops
vouching for a number it can see has been curated. This is a recommendation, not a decision — the
threshold in particular is the owner's call, and possibly counsel's.

## Proposed change

Answer the question first. Under each answer:

**"Leave it as-is."** Then say so in the reviews ADR and add one honest line of copy near the public
rating — that reviews are published at the shop's discretion — so the disclosure exists somewhere. No
code beyond that string in both locale bundles.

**"Constrain hiding" (the recommendation).** `tripReviews` gains a nullable hidden-reason column and
a hidden-at timestamp; `setReviewPublished` takes the reason on the hide arm and refuses without one;
the moderation page at `src/app/shop/[shopSlug]/reviews` asks for it with radio options rather than
free text, so the values are countable. Then in `src/lib/structured-data.ts`, extend the input
`aggregateRatingOf` receives so it can withhold the block — it already omits the field for a shop
with no published reviews, so "omit rather than emit noise" is the established shape and this is one
more condition on the same decision, not a new one. The reason list is user-facing copy and lands in
both locale bundles in the same change.

**"Stop publishing aggregateRating entirely."** The smallest change of the three: delete
`aggregateRatingOf`'s call site and keep the on-page average as an unstructured display. Worth
naming as an option — it removes the whole problem at the cost of a search-result feature the shop
never asked for.

Do **not** make hiding harder without touching the structured data. The exposure comes from the
combination; constraining moderation alone leaves DiveDay still asserting a curated number, and
tightening the screws on shops is the half with all of the cost and none of the protection.

## Prompt

```text
Decide, then implement, what a dive shop may hide from its own public reviews — given that whatever
survives is published as schema.org aggregateRating in the JSON-LD on its public schedule page.

Read first:
  - docs/product/follow-ups/FU-20260813-review-moderation-has-no-floor.md (the full write-up; its
    "Proposed change" section states what to build under each answer)
  - src/lib/reviews.ts — publishesImmediately is the entire moderation policy
  - src/db/reviews.ts — setReviewPublished (unconditional hide, no reason recorded) and
    reviewAggregate, which averages published rows only
  - src/lib/structured-data.ts — aggregateRatingOf, and note it ALREADY omits the block for a shop
    with no published reviews, so withholding it is an existing shape rather than a new concept
  - docs/architecture/decisions/20260729-verified-diver-reviews.md

The constraint that makes this non-obvious: the exposure is the COMBINATION of unconditional hiding
and a machine-readable rating, so a change to only one half is the wrong fix. Constraining moderation
alone still leaves DiveDay asserting a curated number to search engines; suppressing the structured
data alone leaves the page itself unchanged. Whatever is chosen has to address both or deliberately
accept one.

If the recommendation is taken, done means: tripReviews carries a hidden reason and timestamp; the
hide arm of setReviewPublished refuses without a reason; the moderation page at
src/app/shop/[shopSlug]/reviews collects it as a fixed choice, not free text; aggregateRatingOf can
withhold its block; and every new string lands in BOTH locales under src/i18n/locales/.

Follow the schema-change skill for the migration. Tests travel with it: unit tests for the new
predicate in src/lib/reviews.ts and the hide path in src/db/reviews.ts, plus a structured-data test
asserting the block is absent for a heavily-moderated shop. Run pnpm check and look at the
moderation page in light and dark before calling it done.

Delete docs/product/follow-ups/FU-20260813-review-moderation-has-no-floor.md as part of the change.
```
