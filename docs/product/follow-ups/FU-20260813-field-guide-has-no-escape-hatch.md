# FU-20260813-field-guide-has-no-escape-hatch — Decide what a shop does about a species DiveDay's catalog does not carry

- **Status:** Open
- **Raised:** 2026-08-13 — branch `claude/marine-catalog-spanish-copy-0431m5`, the change that made
  the field guide DiveDay's copy (ADR 20260813-marine-life-is-diveday-copy)
- **Kind:** question
- **Effort:** M
- **Touches:** `src/db/marine-life-catalog.ts`,
  `src/app/shop/[shopSlug]/dive-sites/_components/FieldGuideEditor.tsx`,
  `src/i18n/locales/en-US/staff/diveSites.json`, `src/i18n/locales/es-ES/staff/diveSites.json`

## What I noticed

Until 2026-08-13 the field-guide editor had an "Add a blank one" button and four text fields per
row, so a shop diving somewhere DiveDay had never described could still put the animal on its
briefing in its own words. Making the cards DiveDay's copy removed that: the picker now refuses
anything not in the 93-species catalog, and says "Not in DiveDay's catalog. Try the Latin name, or
tell us what we are missing."

That sentence currently points nowhere. There is no "tell us" — no form, no address, no queue. It is
the only place in the product that asks a shop to contact DiveDay without saying how.

The catalog's own scope makes this concrete rather than theoretical: it is the tropical western
Atlantic, and DiveDay's site templates are all Florida. The first shop outside that water — Cozumel
is the obvious one, and the Spanish translation this change shipped is aimed squarely at it — meets
a picker that has most of its reef and none of its specialities.

## Why it isn't already done

Because the version that preserves the escape hatch is the version the ADR rejected, and it should
not be re-litigated by whoever implements it next. A per-row override — DiveDay's words by default,
the shop's if it typed any — means the surface has to explain two models, and a card that is
sometimes translated and sometimes not is the half-translated guide arriving one row at a time.
That argument holds. What it does not settle is what a shop with a missing species should actually
*do*, and I could not pick between three answers that differ by more than effort:

1. **A request path.** The refusal becomes a real action: name the species, and it lands somewhere a
   human at DiveDay sees. Cheapest to build, slowest for the shop — the fix arrives in a release.
   Keeps every card translated, which is the property worth protecting.
2. **Grow the catalog by region.** Add an Indo-Pacific and an eastern-Pacific set (Cozumel is
   Caribbean and largely covered; Bonaire, Roatán and the Red Sea are not). Real work — each species
   needs a photo with a licence, and two languages — and it moves the ceiling without removing it.
3. **A shop-authored species, marked as such.** The rejected option, made honest: the shop's own
   card, in one language, visibly the shop's rather than DiveDay's. Restores the capability at the
   cost of the guarantee.

My recommendation is (1) now and (2) driven by what (1) collects — the requests *are* the roadmap
for which region to add, and guessing at it before any shop has asked is how the 93 species became
Florida-shaped in the first place. But which markets DiveDay is actually selling into is not my
call, and (3) is the right answer if the honest position is "a shop knows its own reef and we will
not be the bottleneck".

## Proposed change

Under (1): make the refusal a `<details>` in the picker with a one-field form posting to a server
action that writes an `activity_events`-style row, or emails `alerts@dive.day` through
`src/lib/notifications/`. Nothing renders on the briefing — it is a request, not content. Reword
`diveSites.form.fieldGuide.notFound` in both locales so "tell us" points at the control.

Under (2): species go in `src/db/marine-life-catalog.ts` plus `marineLife.species.<slug>` in both
bundles plus a photo in `public/marine-life/` with a line in that folder's README.
`src/db/marine-life-catalog.test.ts` already fails on any of the three being missing, and the slug
union makes a species with no copy a compile error, so the work is bounded and self-checking.

Under (3): a `dive_site_creatures` row with a null `catalog_slug` becomes meaningful again rather
than skipped, `fieldGuideCards` grows a second branch, and the card needs a visible marker. Read the
ADR's "Alternatives considered" before starting — the objection there is about the *surface*, not
the storage, and the surface is where the work is.

**Not proposed under any of them:** letting a shop override a species DiveDay *does* carry. That is
the specific thing the ADR decided against, and none of the three above requires it.

## Prompt

```text
In the DiveDay repo, a shop cannot put a species on a dive-site field guide unless it is one of the
93 in src/db/marine-life-catalog.ts. The picker refuses everything else with "Not in DiveDay's
catalog. Try the Latin name, or tell us what we are missing." -- and there is no way to tell us.

Read first: docs/architecture/decisions/20260813-marine-life-is-diveday-copy.md, especially
"Alternatives considered" (the per-row override was rejected, and re-proposing it needs a new
argument, not a re-reading of the old one), then
src/app/shop/[shopSlug]/dive-sites/_components/FieldGuideEditor.tsx and
src/i18n/marine-life-labels.ts.

Ask the human which of the three options in
docs/product/follow-ups/FU-20260813-field-guide-has-no-escape-hatch.md to take, then implement it.
Do not pick for them: option 3 gives up a guarantee the ADR was written to buy, and that is a
product call.

Whichever is chosen, the constraint is the same: no surface may show a card that is translated
beside a card that is not, without saying which is which. Every new string lands in en-US and es-ES
in the same change (pnpm check:locale), and Spanish goes through
src/i18n/locales/es-ES/README.md's terminology rules.

Done when pnpm check is green and e2e/dive-sites.spec.ts passes. Delete
docs/product/follow-ups/FU-20260813-field-guide-has-no-escape-hatch.md as part of the change.
```
