# 20260729-verified-diver-reviews — Ratings and reviews from divers who provably dived

- **Status:** Accepted
- **Date:** 2026-07-29

## Context

[20260726-post-trip-review-request](20260726-post-trip-review-request.md) shipped the *ask*: a recap
page that points a happy diver at whatever public review platform the shop configured
(`shops.review_url`). What it deliberately did not ship was any review DiveDay itself holds. The
FareHarbor gap audit
([fareharbor-feature-gaps-20260726.md](../../product/assessments/fareharbor-feature-gaps-20260726.md))
left that row open: "an internal ratings display (or embedding TripAdvisor/Google's own widget)
remains open if a shop asks for one."

Two things make an internal review worth holding rather than always deferring to Google:

- **Proof.** DiveDay knows who was on the boat. A review written through a booking's own signed recap
  link is verifiable in a way an open web form never is — nobody can leave one without having dived.
  That is a claim a shop's own site can make and an aggregator's cannot.
- **The booking page needs it.** The public schedule is the surface a diver decides on, and it had no
  social proof at all. It is also where structured data now publishes an `aggregateRating`
  ([20260729-booking-page-structured-data](20260729-booking-page-structured-data.md)) — which needs a
  rating that is actually ours to publish.

## Decision

**One review per booking, written through the recap capability.** `trip_reviews` carries a 1–5
`rating`, an optional `comment`, and is unique on `booking_id`. The write path is
`submitReviewAction` on `/recap/[token]`: the signed token resolves to a booking, and shop, trip, and
person are derived from that row — never accepted from the form. A cancelled or no-show booking is
refused, the same fail-closed treatment the rest of the recap surface already gives those two. The
unique index makes a replayed submit a revision rather than a duplicate, so a bookmarked form can't
inflate a shop's average.

**A bare rating publishes; words wait for staff.** `is_published` defaults false, the same moderation
seam as `dive_site_moments`. A review with no comment has nothing to moderate and publishes on
arrival; a review carrying text lands on the shop's public schedule page, so it waits. Editing a
published review to *add* words sends it back to the queue — otherwise "rate, then edit freely" would
be a route onto a public page with nobody reading the text.

**The aggregate is computed over published rows only.** The number a visitor sees and the reviews
listed under it therefore always describe the same set. Staff moderate at
`/shop/[shopSlug]/reviews`; hiding a review drops it from both at once.

**Public display says the least it can.** A review is signed with a first name and last initial
("Marta R.", `reviewerDisplayName`) — never a full name, never an email. Comments render as React
text children, never as markup. Bare ratings count toward the average but are not listed: an empty
card tells a visitor nothing.

## Alternatives considered

- **Embed TripAdvisor's or Google's widget**, as the gap audit's FareHarbor comparison suggested —
  rejected for now. It is a third-party script on the booking page (a performance and privacy cost),
  it shows reviews DiveDay cannot verify, and it does not produce an `aggregateRating` we may
  publish as our own. The existing `shops.review_url` ask still sends divers to those platforms; this
  is additive, not a replacement.
- **Publish everything, moderate after the fact** — rejected. Diver-authored text on a shop's public
  page with no read-before-publish step makes the shop's own site the place an angry or abusive
  message lands first. The cost is friction for the shop, which the bare-rating carve-out limits to
  reviews that actually contain words.
- **Hold the aggregate over all reviews, moderate only the text** — rejected as quietly dishonest:
  "4.2 from 30 reviews" above six visible cards invites the reader to assume the six are a sample of
  the thirty, when the other twenty-four were withheld by the shop.
- **A minimum review count before showing a rating** — rejected. `docs/product/brainstorm` already
  states the house rule for computed public stats: display the real numbers, even when imperfect.
  One review reads as "1 review" and a visitor can weigh it themselves.

## Consequences

A shop gets social proof on the surface where divers decide, and it is proof of a kind aggregators
structurally cannot offer. The rating feeds the booking pages' structured data, so it can also
surface in search results.

What this makes harder: a shop that moderates nothing accumulates an unpublished queue, and its
public rating then reflects only its bare ratings. The staff Reviews page shows the waiting count for
exactly that reason, but nothing forces the issue — no nag, no auto-publish timer. Revisit if shops
report the queue going stale.

Deliberately not built: replies to reviews, per-trip (rather than per-shop) ratings on the schedule,
review-request reminders beyond the one recap link that already goes out, and any notion of a
"verified" badge beyond the plain sentence on the page. A per-trip breakdown is the most likely next
ask; the rows already carry `trip_id`, so it is a query, not a re-model.
