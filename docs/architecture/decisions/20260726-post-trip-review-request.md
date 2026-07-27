# 20260726-post-trip-review-request — Post-trip review request

- **Status:** Accepted
- **Date:** 2026-07-26

## Context

[fareharbor-feature-gaps-20260726.md](../../product/assessments/fareharbor-feature-gaps-20260726.md)
flagged that FareHarbor nudges a diver toward a public review right after a great dive — the highest-
leverage moment a shop has for word-of-mouth, and one DiveDay's recap page (the "word-of-mouth window,
weaponized" surface from `docs ADR 20260723-post-trip-recap`) wasn't using. The recap page already
exists and is already delivered post-trip; the gap was that it had nothing pointing a happy diver
anywhere public.

## Decision

- **One shop-level review link, not a review-platform integration.** `shops.review_url` is a single
  optional URL a shop sets once in Settings (wherever they want reviews — Google, TripAdvisor, Yelp,
  their own testimonials page). The recap page renders a "Leave a review" section only when it's set;
  nothing changes for a shop that hasn't configured one.
- **Plain outbound link, not an API integration.** The button is `target="_blank"` to `shop.reviewUrl`
  — DiveDay never talks to a review platform's API, never tracks whether the diver actually left a
  review, and never gates anything on it. This is intentionally the simplest version of the feature:
  a shop that wants deeper review-platform integration (auto-posted reviews, review widgets) is a
  distinct, larger feature this ADR doesn't attempt.
- **No solicitation timing logic beyond the existing recap delivery.** The recap email already fires
  once, post-trip, via `sendDueRecaps` (`docs ADR 20260721-scheduled-reminder-cadence`); the review
  prompt rides that same page rather than becoming its own timed nudge. A diver who never opens their
  recap never sees the review ask either — an accepted trade-off, since the recap link is already the
  distribution mechanism for every post-trip surface (photos, the shoutout, now tipping and reviews).
- **No suppression for a diver who leaves a bad trip.** Unlike some review-request tools, this doesn't
  attempt sentiment gating (e.g., asking a private "how did it go?" first and only surfacing the public
  review link to happy divers) — that pattern risks review-platform terms-of-service violations
  (Google's guidelines explicitly prohibit selectively soliciting only positive reviews) and adds a
  branching flow for a v1 feature. The link is unconditional whenever a shop has one configured.

## Alternatives considered

- **A dedicated review-request email, separate from the recap** — more visible, but duplicates the
  recap's existing post-trip delivery mechanism and adds a second scheduled job for marginal gain over
  a section on a page that's already being sent and already gets opened for photos/tipping.
- **Sentiment-gated review requests** — rejected per above (review-platform ToS risk, added complexity)
  for a first version; revisit if a shop specifically asks for it.
- **A review-platform API integration (embedded widget, auto-import)** — real value, but a materially
  larger feature (per-platform auth, API surface, review display) than this slice's scope. The plain
  link is the honest interim: it gets a diver to the shop's chosen platform in one tap.

## Consequences

- A shop can start collecting reviews from its best-primed audience — a diver who just had a great
  day, right on the page they're already looking at — in one Settings field, no new integration.
- The feature is inert until a shop sets a review URL; nothing changes for a shop that doesn't.
- No review-collection analytics exist yet (DiveDay can't tell whether a diver clicked through); a
  future slice could add click tracking if a shop wants to measure it.
