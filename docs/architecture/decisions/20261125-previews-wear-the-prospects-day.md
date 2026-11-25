# 20261125-previews-wear-the-prospects-day — Sail a preview's day boats at the prospect's times, on hulls with the prospect's names

- **Status:** Accepted
- **Date:** 2026-11-25
- **Extends:** [20261116-demo-previews](20261116-demo-previews.md). The link, the three counts and the founder's alert stand.

## Context

A preview wore the prospect's name, colour and town over the sample schedule: Mantis I and Mantis II at the sample's 7:00 and 11:00. Aaron approved (2026-11-24, outreach review, build 2) previews that open on the prospect's own departure times and boat names, read from their public site with flags to correct the reader, and building several previews in one run. How to use it: [preview-links.md](../../product/pilot-kit/preview-links.md).

## Decision

`pnpm preview build` reads the home page and up to four same-site schedule, charter or boat pages. A departure time is a clock time whose nearest cue is "depart", "leaves" or a boat's own name, never a check-in, a return or the store's hours. A boat name is one introduced as one ("aboard the …", "… departs from", "the boats … and …"). `--times` and `--boats` override; `none` keeps the sample's.

`demo_previews` keeps `departure_times` and `boat_names`. The seed dresses a preview shop after it writes the day, at mint and after every reset (`src/db/seed/preview-day.ts`): the two hulls take the first two names, and each upcoming day boat moves to the nearest of the times on its own day. A day boat leaves between 6 AM and 3:30 PM, is not a course, has nothing recorded against it and holds one schedule day. It moves at most three hours, only to a time still ahead, and only when its hull is free then. Before a reset the hulls take the sample names back, because the sample scenarios find their boats by name.

The move is a seed write, not `moveTrip`: nobody was told the sample time, so no crew notice, reminder or gear window follows. The trip's revision is bumped and its links' expiry realigned.

`pnpm preview batch <file>` builds one preview per line, each written as after `build`. Every line is checked before anything is built.

## Alternatives considered

- Storing the day on the shop row: it belongs to the preview, which already outlives the shop.
- Seeding the whole schedule from the prospect's times: every scenario's story is written against its own hour; moving the day boats afterwards keeps the stories whole.
- Finding boats by call sign instead of name: a wider change across the seed for no gain here.

## Consequences

The dawn boat, sunset and night dives, courses and any departure already checking people in keep the sample hours. A site that writes its times only in a booking widget gives none; the founder passes `--times`. Seeded notes that mention a sample time are not rewritten.
