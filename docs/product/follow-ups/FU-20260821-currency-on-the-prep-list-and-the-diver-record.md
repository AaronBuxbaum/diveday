# FU-20260821-currency-on-the-prep-list-and-the-diver-record — Finish surfacing "when did you last dive?" on the two staff pages that were being rebuilt that day

- **Status:** Open
- **Raised:** 2026-08-21 — building ADR 20260821-currency-is-what-catches-people
- **Kind:** half-done
- **Effort:** S
- **Touches:** `src/app/shop/[shopSlug]/trips/[id]/prep/page.tsx`, `src/app/shop/[shopSlug]/divers/[personId]/page.tsx`

## What I noticed

`bookings.last_dived_band` now exists, `/ready` collects it, and the trip roster renders the two
notable bands in warning tone. The `dive-domain-expert` finding that started it named **three**
places staff should see it: the roster, the **prep list**, and the **diver's record**. Only the
roster shipped.

The reader who is worst served by that is the one the feature is for. A divemaster packing gear off
the prep list, or a staffer opening a returning diver's record to decide what to say to them, is
exactly who wants "last dived over five years ago" in front of them — arguably more than the person
reading a roster on the way to the boat.

## Why it isn't already done

Not judgment — traffic. Both files were being restructured on concurrent branches the same afternoon:
the prep page was growing a group-by-item view, and the diver record was losing its row actions,
moving "Erase personal data" behind a deleted record, and gaining an Activity panel. Editing either
from a third branch would have produced a conflict in the middle of somebody else's rework, for two
lines of render each.

The repo's parallel-work rule is to split by non-overlapping paths and coordinate rather than race,
so the roster — which nothing else was touching — shipped and this was written down.

## Proposed change

Two small renders, both reading `booking.lastDivedBand`, both using the helpers that already exist:

1. **Prep list** (`src/app/shop/[shopSlug]/trips/[id]/prep/page.tsx`) — beside the diver's name, same
   rule as the roster: only `diveRecencyIsNotable` bands, warning tone, `diveRecencyText` for the
   words. Whichever grouping view landed, this belongs on the per-diver face of it.
2. **Diver record** (`src/app/shop/[shopSlug]/divers/[personId]/page.tsx`) — here render **every**
   band, not just the notable two, and against the booking it was given for. This is the one surface
   where the whole answer is the point rather than a flag, and where "this season" is genuinely worth
   reading. A diver with several bookings has several answers; show them with their trips rather than
   collapsing to a most-recent value, which is the reason the column is on the booking at all.

Do **not** add a new label map or a second tone rule. `STAFF_DIVE_RECENCY_KEYS`, `diveRecencyText`
and `diveRecencyIsNotable` are the whole vocabulary and both surfaces should read identically to the
roster.

## Prompt

```text
Read docs/architecture/decisions/20260821-currency-is-what-catches-people.md first, then
src/lib/dive-recency.ts and the roster's render of it in
src/app/shop/[shopSlug]/trips/[id]/_components/RosterSection.tsx (search for diveRecencyIsNotable) —
that block is the pattern to copy.

`bookings.last_dived_band` is collected on /ready and rendered on the trip roster. Two staff surfaces
the original finding named were skipped because they were being rebuilt on other branches the same
day, and both have since merged:

1. src/app/shop/[shopSlug]/trips/[id]/prep/page.tsx — beside the diver's name, only the notable bands
   (diveRecencyIsNotable), warning tone, words from diveRecencyText.
2. src/app/shop/[shopSlug]/divers/[personId]/page.tsx — every band, not just the notable two, shown
   against the booking it was given for rather than collapsed into one "most recent" value. The
   column is on the booking precisely because an answer given in March is not evidence about a
   November trip.

Reuse STAFF_DIVE_RECENCY_KEYS / diveRecencyText / diveRecencyIsNotable from
src/i18n/readiness-labels.ts and src/lib/dive-recency.ts — no new label map, no second tone rule, no
new copy keys unless the diver record genuinely needs a heading, in which case it goes in both
locales.

Nothing gates on this and nothing may start to. Done when: pnpm check is green, an e2e assertion
covers at least the diver record's render, and you have looked at both pages in light and dark
(node scripts/screenshot.mjs — the seed gives Tom Okafor "over five years" and Priya Sharma "this
season", src/db/seed-dive-recency.ts). Delete
docs/product/follow-ups/FU-20260821-currency-on-the-prep-list-and-the-diver-record.md as part of the
change.
```
