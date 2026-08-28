# 20260813-dive-site-briefings-are-the-shops-own-words — Every sentence on a dive-site briefing comes off the site row

- **Status:** Accepted, **amended 2026-08-28** (the reading surface changed shape — see
  [Amendment](#amendment-20260828--the-prose-is-a-ledger-beat-on-the-departure-page))
- **Date:** 2026-08-13
- **Supersedes:** nothing. Extends 20260809-shop-drawn-dive-routes, which made the *route* a shop's
  own and left four other DiveDay-authored things on the same page.

## Context

The diver-facing dive-site briefing reads as one document written by the shop. Five of the things on
it were not.

| What a diver read | Where it actually came from |
| --- | --- |
| "Welcoming dive" | `siteFit()` — a regex over `difficulty`/`depth_range`/`current_note` |
| the sentence under it | one of three canned lines in `diver.json`, keyed by that regex's answer |
| the paragraph under each landmark | `landmarkDetails` in `src/lib/dive-site-landmarks.ts`, a table keyed by **site name** and **landmark name** |
| "Stoplight parrotfish", its photo, its description, its tip | `dive_site_creatures` rows written only by the demo seed |
| "See more by slowing down" | `diver.json` |

None had a field. The landmark table was the worst of them: seven landmarks at three DiveDay demo
sites had a paragraph, every landmark any real shop typed fell through to one generic sentence, and
renaming the site silently deleted the copy — a lookup keyed by a name the shop is free to change.
The field guide was the largest: `dive_site_creatures` shipped in the first release and no surface in
the app could add, edit, reorder, or remove a row, so a shop that built its own site had no field
guide at all and a shop that imported a DiveDay one inherited DiveDay's species list permanently.

The fit line was subtler and worse for being plausible. The regex reads free text the shop wrote for
a different purpose: a gentle reef whose current note happens to mention a "deep channel" told divers
to bring recent experience, and nothing on the site could take that back.

The published site catalog had the same shape at one level up. Its `briefing` blob carried eight
fields, so importing "Molasses Reef" produced a site with no certification gate, no landmark notes,
and an empty field guide — and the catalog page offered only "Import to my library", which made
adopting a template the only way to find out what was in it.

## Decision

**Every sentence a diver reads on a briefing comes off the shop's own row, and the staff form can
write all of them.**

- `dive_sites.fit_tone` (nullable enum) and `dive_sites.fit_note` (text). Null tone keeps the derived
  reading, which is what every existing site means; a set one wins outright. The **label** stays a
  translated status word — the shop chooses which of three, the same shape a readiness status has —
  and the sentence under it is the shop's own prose.
- `dive_sites.landmarks` widens from `string[]` to `{ name, kind, note }[]`, normalised by
  `parseDiveSiteLandmarks`. A bare string still reads as a landmark with nothing said about it, which
  is exactly what those rows meant, so no data migration is owed. `kind` stays a code with a
  translated label; `note` is the shop's prose. The hard-coded table is deleted.
- `dive_sites.field_guide_tips_heading` (text) for the aside over the tips.
- `dive_site_creatures` gains `position` (the list had no order at all, so a briefing could reshuffle
  its own field guide between renders) and `catalog_slug` (provenance only). The dive-site form owns
  the list: add, edit, reorder, remove.
- `global_dive_site_versions.briefing` carries the whole briefing, cert gate and field guide
  included, and the catalog gains a **preview** — `?view=catalog&template=<slug>` — that shows all of
  it before the import button.

**DiveDay's catalogs are starting words, never app copy.** `src/db/marine-life-catalog.ts` (93
western-Atlantic species with a description, a "how to actually see one" tip and a bundled photo) and
`src/db/dive-site-templates.ts` (34 real Florida sites) are `i18n-exempt-file` for the same reason
`src/db/course-templates.ts` is: picking one **copies** its words onto the shop's row, and nothing is
read back at render time. A later correction to a catalog entry never rewrites what a shop published.

## Alternatives considered

**Keep the landmark table and key it by id instead of name.** Fixes the rename bug and nothing else:
a real shop's landmarks would still have no words, which was the actual complaint.

**Put the species catalog in a table and render the site's guide by joining to it.** One source
instead of two, and a smaller write path. Rejected because the join makes DiveDay's words *live* on
a shop's public page: correcting an entry would silently rewrite a briefing a shop had published, and
a shop that wanted its own sentence about a fish would have to override a row it did not own.
Copy-on-pick costs a few hundred bytes per site and makes the words unambiguously the shop's.

**Make the species catalog a message-bundle registry** (the `src/lib/marketing.ts` pattern, keys not
words). Correct for anything the *app* says; wrong here. These strings land in a shop's row as free
text a human then edits, in the shop's own language — the same reason `course-templates.ts` is
exempt. Holding them as keys would mean 93 species × three fields × every locale for content no
locale ever renders directly.

**Leave the fit line derived and just improve the regex.** A better guess is still a guess about text
written for another purpose, and there was no way for the shop to be right when it was wrong.

## Consequences

- One additive migration: three columns on `dive_sites`, two on `dive_site_creatures`, one enum. No
  DDL on `landmarks` — widening a `jsonb` `$type` is a TypeScript change, and the parser reads both
  shapes.
- `src/lib/dive-site-landmarks.ts` no longer holds any English; `diver.json` loses
  `site.landmarkDescriptions.*` in both locales.
- The dive-site form grows two client editors (`LandmarkEditor`, `FieldGuideEditor`), both following
  `RouteEditor`'s shape: client state, one hidden JSON input, server-side normalisation. Their copy
  is resolved server-side, and the three per-row aria labels travel as `{name}` templates rather than
  functions — a Server Component may not hand a function to a Client one.
- `public/marine-life/` adds 93 photos (~6 MB, bounded to 800px on the long edge). Credits and
  licences are in that folder's README.
- A shop's briefing can now say nothing where DiveDay used to say something generic. That is the
  point: a landmark with no note renders as a name and a category, which is the whole of what the
  shop knows about it.

## Amendment 2026-08-28 — the prose is a ledger beat on the departure page

Nothing about provenance changes. Every sentence still comes off the shop's own row and the staff
form still writes all of them. What changed is **where a diver reads them**, and for a while the
answer was nowhere.

Clearwater slice 7c (ADR 20260827-the-divers-thread) deleted the swipeable briefing deck —
`DiveBriefingsSection`, `DiveBriefingCard`, `DiveSiteFieldGuide`, `DiveSiteMap`,
`DiveSiteLandmarks` — as roughly a thousand pixels of reading sitting *below* the booking form,
where only a diver who had already paid would reach it. That judgement stands. But the deck was
also the only reader of eight authored columns, so deleting it left `fit_tone`, `fit_note`,
`dive_plan`, `current_note`, `marine_life`, `marine_life_description`, `landmarks` and
`conservation_note` reaching no diver at all — on a form that still asks for every one of them,
with 34 site templates that still ship them, and a route map in `AGENTS.md` that still described a
page nobody could open. The drawn route (ADR 20260809) went the same way and came back first, as
`TripRoutes`.

The prose comes back as **`TripSiteNotes`**, above the form with the rest of the pitch: a run of
short labelled paragraphs, once per *site* rather than once per tank, with no photo grid, no
comparison table and no heading competing with the page's own `h1`. The free-text "what might
divers see" pair speaks only for a site that named no catalog species, since `TripLookFor`
already answers that question for the ones that did. A site the shop has written nothing about
renders nothing — a canned fit sentence over a bare name is the page talking to fill space.

The lesson generalises past this ADR and is written into the `AGENTS.md` route-map row: a surface
is two halves, the form that writes a column and the beat that reads it, and deleting one of them
silently orphans the other.
