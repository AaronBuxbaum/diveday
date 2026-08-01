# 20260729-booking-page-structured-data — schema.org JSON-LD on the public booking pages

- **Status:** Accepted
- **Date:** 2026-07-29

## Context

JSON-LD already exists on the marketing pages (`SoftwareApplication` on `/`, `FAQPage` on
`/pricing`), but not on the pages that are actually the product's public surface: a shop's schedule,
one departure, and a course. The FareHarbor gap audit
([fareharbor-feature-gaps-20260726.md](../../product/archive/fareharbor-feature-gaps-20260726.md))
called this "cheap, no-risk SEO win once the embed/standalone-page question above is settled
(structured data belongs on whichever URL is canonical)."

That question is now settled — [20260726-schedule-embed](20260726-schedule-embed.md) shipped `?embed=1`
as a compact surface a shop frames inside its own site — so the canonical-URL ambiguity that made this
premature is gone. Two other things also landed that this depends on: the schedule and trip pages had
static titles (`"Trip — DiveDay"` for every departure), and there was no shop rating to publish until
[20260729-verified-diver-reviews](20260729-verified-diver-reviews.md).

## Decision

**A builder module, not per-page literals.** `src/lib/structured-data.ts` is framework-free and
tested: `scheduleJsonLd` (an `ItemList` of `Event`s), `tripPageJsonLd` (one `Event`),
`coursePageJsonLd` (a `Course`), and `shopJsonLd` (a `SportsActivityLocation`, which is what a dive
operator is, and the type that carries an address — `shopAddressOf` builds a `PostalAddress` from
the shop's own address fields once a shop has filled any of them in). Pages pass rows in and
render the result; nothing about schema.org lives in a route file.

**One component writes the script tag.** `<JsonLd>` serializes with `JSON.stringify` and escapes `<`,
the same pattern the marketing pages already used, so the escaping rule lives in one reviewed place.
The graph is stringified rather than interpolated, so a value carrying quotes or markup is escaped as
JSON string content; the `<` escape closes the remaining `</script>` hole. This is the one sanctioned
use of `dangerouslySetInnerHTML` in the app.

**Never in embed mode, never on a capability page, never for staff.** The standalone page is
canonical and now says so via `alternates.canonical`; emitting the same `Event` from the embedded copy
is precisely the duplication a canonical exists to resolve. `/recap`, `/ready`, and `/waivers` are
`robots: { index: false }` bearer-token surfaces and get none of this. The staff board is not a public
document.

**Only what the page already shows an anonymous visitor.** No diver names, no emails, no booking or
person ids — the open-seat count and the price are figures the page renders anyway. A test asserts the
serialized graph contains none of those. (The one deliberate exception is the schedule page's own
`Review` objects, added later — see "Alternatives considered" below — whose `author.name` is the same
first-name-and-last-initial byline `<ShopReviews>` already renders, never a diver's full name.)

**Honest claims, or none.** An unpriced charter emits no `offers` rather than a price of `0`, which
every consumer would read as free. A full trip *or* one on a conditions hold is `SoldOut`, because
neither can be booked right now. `aggregateRating` is omitted entirely below one published review
rather than emitted with a count of zero. `pruneJsonLd` strips null branches, since `"location": null`
reads as a claim about the thing rather than as absence.

**`generateMetadata` alongside it.** The schedule, trip, and course pages now carry a per-shop title,
description, canonical, and Open Graph block. This is the same SEO surface and the same data, so it
would be strange to fix the machine-readable half and leave every departure titled "Trip — DiveDay".

## Alternatives considered

- **A `Product` + `Offer` graph instead of `Event`** — rejected. A dive departure is a
  scheduled, capacity-bounded thing that happens at a time and place; `Event` carries `startDate`,
  `remainingAttendeeCapacity`, and `eventAttendanceMode`, all of which are the actual facts.
- **`Review` objects in the graph alongside `aggregateRating`** — originally deferred: it would
  publish diver comments into search results, a bigger consent question than showing them on the
  shop's own page, and the aggregate alone was what earned the rich result. *(Update: revisited and
  reversed — `reviewsJsonLd` now emits `Review` objects on the standalone schedule page's own
  top-level graph, alongside `<ShopReviews>` which renders that exact reviewer name, star rating,
  comment, and dive date to any anonymous visitor of that same page. The consent question is
  satisfied because nothing new is exposed: schema.org is describing words already public on the
  page, not surfacing them for the first time. Scoped narrowly — the per-trip `Event`'s `organizer`,
  the course page's `provider`, and every other `shopJsonLd` call site still omit `review`, since
  those graphs describe one trip or course, not the shop's full review list.)*
- **Emitting structured data in embed mode too** — rejected above; two URLs describing one Event is
  the failure mode.
- **A sitemap** — out of scope here, and genuinely useful; it belongs with the read-API/webhooks work
  in the roadmap rather than bolted onto this. *(Update: `src/app/sitemap.ts` now publishes exactly
  the shop-schedule and course pages this ADR gives structured data to — see the SEO & growth work
  in docs/product/archive/specialist-optimization-audit-20260731.md.)*

## Consequences

A shop's departures become eligible for rich results (event cards with dates, prices, and
availability) on the URL the shop actually wants ranked, and its verified rating rides along.

What this makes harder: the graphs now depend on `publicAppUrl()` being set. Without it every `url`
prunes away, and what remains is a valid but far less useful graph — a silent degradation rather than
a failure, and the same dependency the capability links already have. Nothing warns about it.

The `Event` also describes the trip at render time. A departure whose price or capacity changes after
a crawl will disagree with the cached result until it is re-crawled — inherent to structured data, not
fixable here, and the reason `availability` is derived rather than stored.
