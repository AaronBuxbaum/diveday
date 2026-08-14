# 20260813-review-moderation-has-a-floor — A hide states its case, and a curated record loses its star rating

- **Status:** Accepted
- **Date:** 2026-08-13
- **Amends:** [20260729-verified-diver-reviews](20260729-verified-diver-reviews.md), which made reviews
  *verified* and left moderation unconstrained. The publish rule and the provenance gate are
  unchanged; what changes is what a hide costs and what DiveDay will vouch for afterwards.

## Context

Two mechanisms combined into something neither intends on its own.

**The publish rule is about words, not about content.** `publishesImmediately` is the whole
moderation policy: a review carrying a comment waits for staff, because those words land on the
shop's public page; a bare rating counts the moment it is given, because there is no text to
moderate. Reasonable as written.

**The hide power was unconditional.** `setReviewPublished` cleared `publishedAt` on any review in the
shop, with no reason captured, no record of the act, and no distinction between a review that was
never published and one the shop took down — including the bare 1-star that had published itself
under the rule above. So "publishes immediately" was not a floor; it was a default a single tap
reversed.

**And what survives is presented as an impartial measurement.** `reviewAggregate` averages only
published rows, and `aggregateRatingOf` emits that average and count as schema.org
`aggregateRating` in the JSON-LD on the public schedule — the field search engines read to draw star
ratings beside a result.

The `trip_reviews` docblock explains why this is invisible from outside while arguing for something
else entirely: aggregates are computed over published rows only "so the number a visitor sees and the
reviews under it always describe the same set." That is a good property. It also means curation is
internally consistent by construction — hide the bad ones and the average moves to match, so there is
no seam a reader could notice.

Put together: a shop could hide every review below five stars, keep a 5.0 average over a
credible-looking count, and have DiveDay publish it in a format designed to be trusted by a machine.

## Decision

**Keep the shop's power to take a review down. Make it a recorded act with a stated case, and stop
publishing the rating as a machine-readable claim once too much of the record has been removed.**

- **`review_moderation_events`** — append-only, shaped like `buddy_team_events`: every publish and
  every hide, who did it, and for a hide, why. The reason is a code from a deliberately short list
  (`abusive`, `names_a_person`, `wrong_subject`, `spam`, `other`); `other` is the escape hatch that
  keeps a shop from ever being stuck, and it is the one value that requires words. Both rules are
  `check` constraints as well as domain refusals, so the trail cannot hold a hide with no case even
  if a future caller forgets. The update and its event are one transaction.
- **A hide is refused without a reason.** `setReviewPublished` returns `reason_required` /
  `note_required` and writes nothing. The action surfaces that as a notice rather than defaulting a
  reason — a default reason is a sentence DiveDay would be putting in the shop's mouth. Publishing
  states nothing: releasing a diver's words needs no justification.
- **`aggregateRating` is withheld above one-in-five suppression.** `ratingIsRepresentative` compares
  what a shop has taken down against everything it has ruled on (published + hidden). Below the
  line, a shop is plausibly removing the spam and the review about the wrong boat. Above it, the
  average describes a set somebody chose. The share counts *judged* reviews, not surviving ones, or
  a shop could dilute its own suppression by publishing more.
- **The share does not apply until ten reviews have been ruled on**
  (`MIN_JUDGED_REVIEWS_FOR_SUPPRESSION`, added 2026-08-14 — see the amendment below).
- **A queued review is not a suppressed one.** A review carrying words that nobody has read yet has
  never been hidden, and it must not count against the shop. Only a recorded `hidden` act does —
  which is the second reason the trail exists, and the load-bearing one.
- **The shop's own page keeps its stars.** What is withheld is the JSON-LD, where DiveDay is the
  party telling a third party that a number describes a real record. On `/s/<shop>` the average sits
  directly above the reviews it is drawn from, where a reader can see what they are looking at.

## Alternatives considered

**Leave it alone — it is the shop's own page.** The honest case, and it is real: `/s/<shop>` is the
shop's page, the reviews are its own customers', and every business curates its testimonials.
DiveDay has never claimed the reviews are an independent verdict. Rejected because of one specific
tag: the moment `aggregateRating` goes out, this stops being a testimonial wall and becomes a rating
DiveDay vouches for to machines. The FTC's 2024 Rule on Consumer Reviews and Testimonials treats
suppressing negative reviews while presenting the remainder as representative as deceptive, and
Google's structured-data policies require `aggregateRating` to reflect a genuine, unbiased set —
both land on the platform as well as the business.

**Record the reason and keep emitting the rating regardless.** Gives an audit trail nobody outside
the shop reads, and leaves the machine-readable claim exactly as it was. It answers "what did they
say?" without answering "should we still be publishing this?".

**Drop `aggregateRating` entirely.** The smallest possible change, and it removes DiveDay's exposure
without constraining any shop. Rejected as throwing away a real benefit for every honest shop —
which is nearly all of them — to defend against a case a threshold already handles.

**Constrain what may be hidden** (say, refuse to hide anything but abuse). Rejected outright: a shop
that cannot remove a review naming a diver by name, or written about the wrong trip, will be angry
with DiveDay rather than with the reviewer, and rightly.

## Consequences

- Hiding a review is now two taps and a choice instead of one tap. That is the intended friction, and
  it is the smallest amount that produces a record.
- The staff Reviews page changes shape: the per-row Hide button becomes a disclosure holding the
  reason picker. Expect a visual diff there.
- `ReviewAggregate` gains `suppressedCount`, so every producer and consumer of it moves together —
  which is why it is on that type rather than threaded separately to the one place that reads it.
- `getShopReviewAggregate` now runs a second bounded count per call. It is indexed on
  `(shop_id, occurred_at)` and the review pages already run several queries; if it ever shows up in a
  trace, the fix is to fold it into the same statement, not to cache the answer.
- A shop that crosses the line loses its search-result stars until it republishes enough of its
  record. As of the 2026-08-14 amendment below, it is told so on its own Reviews page.

## Amendment, 2026-08-14 — the share waits for ten judged reviews, and the shop is told

Two gaps in the decision above, closed together because the first one decides how the second is
worded.

**The ratio had no floor under it.** A shop with three reviews that took down one piece of spam sat
at 33% and lost its search-result stars over a single honest act. A shop with two hundred reviews was
barely constrained by the same fraction. That is backwards: the small shop is the one with no
capacity to game anything, and a record curated into a 5.0 — the case this rule exists for — cannot
be built out of nine reviews.

`MIN_JUDGED_REVIEWS_FOR_SUPPRESSION = 10` now gates the share. Below ten judged reviews
`ratingIsRepresentative` returns true on the share alone; the tenth closes the window. What it does
*not* forgive is an absent average — a shop with nothing published still emits no `aggregateRating`,
which is `aggregateRatingOf`'s own `count < 1` guard and the reason the predicate's first line is
`count === 0`, not `judged === 0`.

The cost is stated plainly: for a shop's first nine judged reviews, suppression is unconstrained.
That is the window this amendment deliberately opens, and it is bounded by the fact that a rating
over fewer than ten reviews is not one a reader is relying on. The alternative considered was an
absolute allowance (the first two hides never count, at any size), rejected because it makes the rule
two numbers to explain instead of one, and because it never fully closes.

**And a shop over the line could not find out.** The rating was withheld silently: the Reviews page
showed a cheerful "4.9" that DiveDay had stopped publishing. Now the page carries the hidden count as
a fourth stat, and a shop over the line gets a warning banner saying the rating still shows on its
own page, is no longer going to search engines, and how many reviews republishing would take to bring
it back (`reviewsToRepublishForRating`). Two predicates rather than one, because
`ratingIsRepresentative` is false for a shop with no reviews as well as for a curated one, and only
the second has anything to act on: `ratingIsWithheld` is the question the surface actually asks.

The words address the situation and never the shop's character. The common case is a small shop that
removed real spam, and the fix is entirely in its hands.
