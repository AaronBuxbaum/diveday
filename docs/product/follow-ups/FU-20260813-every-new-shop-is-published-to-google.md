# FU-20260813-every-new-shop-is-published-to-google — Decide whether a shop's public pages are indexed from the moment it signs up

- **Status:** Open
- **Raised:** 2026-08-13 — branch `claude/follow-up-decisions-xgj9o3`, a sweep of the codebase for
  policy questions the product currently answers by accident rather than by decision.
- **Kind:** question
- **Effort:** M
- **Touches:** `src/app/sitemap.ts`, `src/db/shops.ts`, `src/app/robots.ts`, `src/db/schema.ts`,
  `src/app/s/[shopSlug]/page.tsx`

## What I noticed

Creating a shop publishes it to search engines. There is no step in between, and no switch anywhere.

`listShopsForSitemap` (`src/db/shops.ts`) selects every shop whose `isDemo` is false — that is the
entire filter. Each one's public schedule goes into `src/app/sitemap.ts`, `/s/**` is deliberately
absent from `robots.ts`'s disallow list, and the pages carry canonicals and JSON-LD by design
(ADR 20260729-booking-page-structured-data). `shops.isDemo` is the only visibility flag on the table.
So the first moment a real shop row exists, DiveDay is actively telling Google to index that shop's
schedule, prices, courses and reviews under `dive.day/s/<slug>`.

Nobody asked the shop. There is no onboarding step where this is mentioned, no setting to turn it
off, and no threshold it has to cross first.

Two consequences follow, and the second is the one I would not want to explain to a shop owner.

**A shop is indexed before it is ready.** A trial shop on day one has whatever it has typed so far —
possibly one test departure, a half-filled course, a placeholder price. That is the version Google
crawls, caches, and may show for a while. First impressions of a real business are being formed from
its rehearsal.

**A shop is indexed before it has decided to stay.** The trial is a fixed three weeks
(`TRIAL_DURATION_DAYS`, H-12). A shop that evaluates DiveDay and walks away has, in the meantime,
had a page published under someone else's domain, indexed against its business name, and quite
possibly outranking pages it controls. Nothing in the product removes it or asks what should happen
to it. For a business whose search presence is a real asset, this is a consequence of *trying* the
software.

Worth being fair about the counter-case, which is genuinely strong: a shop's public schedule being
findable is a feature, arguably one of the better reasons to be on DiveDay at all, and a shop that
had to discover and flip a switch to get it would mostly just not get it. Nothing here is a bug. It
is a default that was never chosen.

## Why it isn't already done

The sitemap module is careful and has clearly been thought about — demo shops are excluded at the
query layer, `lastModified` is deliberately omitted rather than fabricated, and its docblock warns
that a new *kind* of route is a publishing decision rather than a reflex. What it does not ask is
whether a *shop* is a publishing decision, and that question sits with the owner rather than with
whoever next edits the file.

It is also entangled with commercial positioning I should not decide unilaterally. Indexing every
shop from day one is good for DiveDay's own domain authority: more indexed pages, more inbound
search, and a public surface that demonstrates the product. Defaulting to unindexed trades that away
for the shop's comfort. That is a real trade with revenue on one side, and it is not mine.

There is a related gap I checked and am deliberately *not* filing separately: ADR
20260804-boat-resource-model records that every scheduled trip is publicly for sale with no
visibility concept, and defers that. This entry is about the *shop* being indexed, not about
per-trip visibility, and the two should not be merged — the second is already deferred with reasons.

**Recommendation: keep indexing on by default, and make it visible and reversible.** Say it plainly
during onboarding, put a switch in Settings, and hold a brand-new shop out of the sitemap until it
has genuinely published something. That keeps the benefit and removes the surprise.

## Proposed change

The owner chooses the default; these are the three shapes.

1. **Indexed by default, disclosed and reversible (recommended).** `shops` gains a nullable
   opt-out timestamp; `listShopsForSitemap` gains that condition beside the `isDemo` one; the public
   schedule and course pages emit `robots: { index: false, follow: false }` when it is set, following
   the pattern the bearer-token pages already use. Add a readiness condition to the same query so a
   shop with no scheduled departure is not listed — that alone removes most of the "indexed before it
   is ready" case with no setting involved. Onboarding says the shop will be findable; Settings
   carries the switch. Copy in both locale bundles.
2. **Opt-in.** Same column, inverted default. Removes the surprise entirely and, realistically,
   removes the feature for most shops, since a benefit behind an unexplained switch is a benefit
   nobody takes. Costs DiveDay's own search surface.
3. **Leave it, and disclose.** No schema change. One honest line at onboarding and in Settings saying
   the shop's schedule is published and indexed. Cheapest, and it fixes the surprise without fixing
   what happens to a shop that leaves.

Under every answer, decide separately what happens to the pages of a shop that stops using DiveDay,
because none of the three addresses it: today the row and its indexed pages simply remain.

Do **not** solve this by removing shops from the sitemap while leaving `/s/**` crawlable. A sitemap
is a hint, not a gate — the pages are linked and would be found anyway, so the result would be a
setting that looks like it works and does not.

## Prompt

```text
Decide whether a DiveDay shop's public pages are search-indexed from the moment the shop is created —
which is today's behaviour, with no setting and nothing said to the shop — and implement the answer.

Read first:
  - docs/product/follow-ups/FU-20260813-every-new-shop-is-published-to-google.md (the full write-up;
    its "Proposed change" section gives the three shapes)
  - src/db/shops.ts — listShopsForSitemap, whose entire filter is isDemo
  - src/app/sitemap.ts and src/app/robots.ts — note that /s/** is deliberately crawlable
  - src/app/s/[shopSlug]/page.tsx, and any bearer-token page (e.g. src/app/ready/[token]/page.tsx)
    for the robots: { index: false, follow: false } metadata pattern to copy
  - the H-12 row in docs/product/human-decisions.md for the three-week trial this interacts with

The constraint that makes this non-obvious: a sitemap is a HINT, not a gate. Removing a shop from
src/app/sitemap.ts while leaving /s/** crawlable produces a setting that appears to work and does
not — the pages are linked and get crawled anyway. Any opt-out has to set noindex on the pages
themselves as well as drop them from the sitemap.

If the recommendation is taken, done means: shops carries a nullable indexing opt-out; the sitemap
query honours it AND excludes a shop with no scheduled departure yet; the public schedule and course
pages emit robots noindex when it is set; onboarding says the shop will be findable; Settings carries
the switch; and every string lands in BOTH locales under src/i18n/locales/.

Also put the question to the owner of what happens to the indexed pages of a shop that leaves
DiveDay — none of the three options addresses it and today the pages simply remain.

Follow the schema-change and instant-navigation skills. Tests travel with it: unit tests for the
sitemap query covering an opted-out shop, a shop with no departures, and a demo shop; plus the
existing src/app/robots.test.ts pattern for the metadata. Run pnpm check.

Delete docs/product/follow-ups/FU-20260813-every-new-shop-is-published-to-google.md as part of the
change.
```
