# 20260813-search-listing-is-a-choice — A shop is indexed by default, told so, and able to say no

- **Status:** Accepted
- **Date:** 2026-08-13

## Context

Creating a shop published it to search engines. There was no step in between and no switch anywhere.

`listShopsForSitemap` selected every shop whose `is_demo` was false — that was the entire filter.
Each one's public schedule went into `sitemap.xml`, `/s/**` was deliberately absent from `robots.ts`'s
disallow list, and the pages carry canonicals and JSON-LD by design (ADR
20260729-booking-page-structured-data). So the first moment a real shop row existed, DiveDay was
actively telling Google to index that shop's schedule, prices, courses and reviews under
`dive.day/s/<slug>`.

Nobody asked the shop. There was no onboarding step where it was mentioned, no setting to turn it
off, and no threshold it had to cross first. Two consequences followed, and the second is the one
that would be hard to explain to a shop owner:

**A shop was indexed before it was ready.** A trial shop on day one has whatever it has typed so far
— possibly one test departure, a half-filled course, a placeholder price. That is the version Google
crawls, caches, and may show for a while. First impressions of a real business were being formed
from its rehearsal.

**A shop was indexed before it had decided to stay.** The trial is a fixed three weeks
(`TRIAL_DURATION_DAYS`, H-12). A shop that evaluated DiveDay and walked away had, in the meantime,
had a page published under someone else's domain, indexed against its business name, and quite
possibly outranking pages it controls. For a business whose search presence is a real asset, that
was a consequence of *trying* the software.

The counter-case is genuinely strong, which is why this is a decision rather than a bug report: a
shop's public schedule being findable is a feature, arguably one of the better reasons to be on
DiveDay at all, and a shop that had to discover and flip a switch to get it would mostly just not
get it. Indexing every shop is also good for DiveDay's own domain authority. Nothing here was
broken. It was a default that was never chosen.

## Decision

**Indexed by default — and disclosed, reversible, and withheld until the shop has published
something.** Three changes, none of which takes the benefit away:

- **`shops.search_listing_opt_out_at`**, nullable. Null (the default, and where every existing shop
  is) means listed. A timestamp rather than a boolean, matching every other reversible act on this
  schema: the question anyone asks later is when the shop turned it off. `setShopSearchListing`
  clears the stamp rather than writing a second one — this is a switch, not a trail.
- **Both halves honour it.** `listShopsForSitemap` and `listActiveCoursesForSitemap` gain the
  condition, and the four public pages (`/s/<slug>`, its trip pages, the course catalog and each
  course) emit `robots: { index: false, follow: false }` through one helper,
  `shopSearchListingRobots`. Leaving the sitemap alone would not un-index anything a crawler had
  already found or that anyone had linked to.
- **A readiness condition, which needs no setting at all.** A shop reaches the sitemap only once it
  has at least one `scheduled` departure. That alone removes most of the "indexed before it is
  ready" case without asking the shop anything. Deliberately *not* "has a departure in the future":
  a shop between seasons should stay indexed, because falling out of search is worse than never
  entering it. An active course is its own readiness signal, so the course query needs only the
  opt-out.
- **Said out loud at sign-up.** The hint under the shop-link box — the box where the owner chooses
  the public address — now names the consequence and where to change it. Copy in both bundles, plus
  a Settings row beside the review link, which is the other row about the shop's public face.

## Alternatives considered

**Opt-in.** Same column, inverted default. Removes the surprise entirely and, realistically, removes
the feature for most shops — a benefit behind an unexplained switch is a benefit nobody takes — and
costs DiveDay the public surface that demonstrates the product. Rejected as trading away the thing
the feature is for in order to fix how it was introduced.

**Leave it on and only disclose it.** No schema change: one honest line at onboarding and in
Settings saying the shop's schedule is published. Cheapest, keeps the whole benefit, and leaves a
shop that objects with nothing to do about it. Half of this shipped anyway — the disclosure is here
— but a disclosure with no switch behind it is a notice, not a choice.

**Un-index on trial expiry.** Considered and not built: it makes the sitemap depend on billing
state, and a shop that lapses for a week would drop out of search and come back, which is worse for
its ranking than either steady state. A shop that leaves can opt out on the way out; what happens to
a lapsed shop's pages is H-12's question, not this one's.

## Consequences

- A shop with no scheduled departure disappears from `sitemap.xml` on the next deploy. That is
  intended, and it is a change to who was already listed — the shops it affects are the ones with
  nothing on their schedule page to read.
- `robots.ts` is untouched: the disallow list is about route *shapes* (bearer tokens), and this is a
  per-shop decision that belongs on the page.
- One additive migration; no backfill, because null already means the current behaviour.
- The switch is in Settings behind the ordinary settings gate rather than an owner-only one, which
  matches the review-link row beside it. A manager can change how the shop appears in search; if
  that turns out to be the wrong bar, it is a one-line change to `settingsBlock`.
