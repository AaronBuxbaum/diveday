# Reef, all the way down — every surface, every open idea, and a wider budget

- **Status:** Live (its ADR was Accepted on 2026-09-04 with H-67 Chosen; slices open below)
- **Date:** 2026-09-04
- **ADR:** [20260904-reef-all-the-way-down](../../../architecture/decisions/20260904-reef-all-the-way-down.md)
- **Published:** https://claude.ai/code/artifact/7b7af489-4f19-47cc-b202-26383b362561

The ninth design canvas. The owner's brief on 2026-09-04: the feature ideas in GitHub Issues have
never been selected against; the frontend does not reach the quality the designs depict; consider
everything top-down, nothing sacred; and the product is too restrained — there are delight angles
it is missing. Every surface was captured from the running app on the day (the `Gap` board carries
the pixels), all thirty-six open feature issues were read (the `Verdicts` board gives each one
line), and the direction picked on 2026-09-01 — Reef in Geist, Harbor for the diver — is taken to
the bottom of the eight surfaces a shop and a diver live in. **Nothing here is normative**; the ADR
carries the decisions, three of them are the owner's, and code obeys the ADR.

## Artboards

Two pages. The first argues; the second shows.

| File | What it shows |
| --- | --- |
| `Main.dc.html` | The cover: the three findings, the five moves in the order they land, the owner's three calls, how to read the canvas, what it leaves alone, the hand's eighth drawing |
| `Verdicts.dc.html` | Every open feature issue — the thirty delight tickets under #1160 and six more — with a verdict (drawn, adopt, fold, hold, decline), where it lands, and why |
| `Budget.dc.html` | The delight budget widened along one axis, time: eight rules, each naming what renders when it is not true, and every ban restated |
| `Gap.dc.html` | The shipped home, booking page, storefront and manifest beside what Reef drew, with the numbers, and why the slices missed the pictures |
| `Home.dc.html` | The shop home at 1440, 6:40 AM: the band at dawn, the fact of scale, the station as a panel, the stage chip, the intent count, the no-show and welcome rows |
| `Evening.dc.html` | The same page at 6:10 PM: two settled boats counted in souls, the open-seats debrief, the plan-change line, the leftovers with the rental-fit question |
| `HomePhone.dc.html` | The morning at 390, with the dock |
| `Storefront.dc.html` | `/s/blue-mantis` at 1440 in the shop's brand: the live line, "next with space", the lens rail, a lens word on every row |
| `BookingPhone.dc.html` | The public booking page at 390, bounded: three tiles and a door, two alternates with reasons, the intent question, the rusty diver's three offers, the form |
| `ThreadPhone.dc.html` | `/ready` at 390: "Anything changed?" over the facts the shop kept, provenance on the arrival card, and the line the link shows when the boat is back |
| `AfterPhone.dc.html` | `/recap` at 390: the postcard with its number, the private line, save-as-image, the private pulse under the review, the next dive with its reason |
| `ManifestPhone.dc.html` | The manifest at 390: the catch-up strip, the stage strip, the welcome word under a name, the plan-change door — and no drawing, coral or motion |

`ShippedHome.jpg` and `ShippedBooking.jpg` are the two captures the `Gap` board reads, taken from
`pnpm dev` on 2026-09-04 with `scripts/screenshot.mjs` (the demo shop, light, 1280 and 390). They are
evidence, dated like the rest of the canvas, and are never refreshed. `canvas.json` lays the boards
out on two pages and pins four notes.

## The fiction every board holds to

The same one as every canvas since Clearwater. **Blue Mantis Divers**, Key Largo (100 Ocean Drive ·
+1 305 555 0142 · hello@demo.invalid), ★4.3 across 83 reviews, boats *Mantis II* and *Skiff*,
default crew Keiko Tanaka and Sal Moretti; Dana Reyes owns the desk. The day is **Thursday,
August 27, 2026**, and the three boats are the ones the Reef canvas drew: the 7:00 Two-Tank Reef,
the 1:00 Wreck Trip, the 7:30 Night Dive. The morning boards are at 6:40 AM while the first boat
boards; the evening board is at 6:10 PM with two boats home. Every diver's name is invented, and
four names the Reef canvas did not carry (Ben Okafor, Ada Lindqvist, Hugo Marsh, Lina Costa) exist
only to give the welcome cue, the no-show row and the rental-fit question someone to be about.

The diver's boards are the demo shop's brand as seeded: green `#158462` (derived to `#13795a` as a
fill), Bricolage Grotesque for headings, the three badges it carries.

## What every board keeps

Reef's tokens, radii, type ladder and bed (13a); the three shipped moments; Geist as the only face
on a staff surface; the safety floor (44px targets, 16px critical text, AA, never colour alone);
the coral count of three; and the whole illustration rule — the `ManifestPhone` board has no line of
the hand on it, which is the point of drawing it.

## Known deviations, on purpose left in

- The stage chip's fifth word, **Home**, takes the roll call's success tone; every other stage is
  lagoon. That is a deliberate exception to "a wash is not a status" and the Budget board says so.
- The fact of scale on the `Home` board sits above a danger-toned "First thing" panel. The ADR
  decides that a fact is not a compliment and may sit beside a blocker; if the owner disagrees the
  fact renders nothing on a morning with a blocking door, and the board is not redrawn.
- The `Storefront` board's hero is a gradient labelled as the shop's photograph; the canvas carries
  no photograph because the app's are the shop's own.

## Slices

By surface, because the Gap board's last finding is that sequencing by token and by moment is how
the pictures were missed. Each row ends with the standing obligation: the component that must not
drift names this ADR in its doc comment, and a test pins the rule.

| Slice | Status | Lands in | Pinned by |
| --- | --- | --- | --- |
| 16a — the station is a panel: `DayStation` on a `SectionCard`, the tile leading, one line per row, the log door a quiet link (the incident-export amendment keeps it on every departure), the dial at 76 | shipped | `src/app/shop/[shopSlug]/_components/today/DayStation.tsx` | `src/app/shop/[shopSlug]/_components/today/DaySpine.test.tsx` |
| 16b — the band follows the clock (Budget 1) and the fact of scale (Budget 3): season start setting, the count, the line (`factOfScaleFor` in `src/lib/today.ts`) | shipped | `src/lib/water-band.ts` | `src/lib/water-band-palette.test.ts`, `src/app/shop/[shopSlug]/_components/today/DaySpine.test.tsx` |
| 16c — the boat says where it is (D20, Budget 4): `trip_stage_events`, the manifest's stage strip, the home's chip, the storefront's live panel, the thread's line; the boat drawing (Budget 2) | open | — | — |
| 16d — the manifest's top: the catch-up strip (D42 with D27 folded in), the plan-change door (D24), the welcome word (D22) | open | — | — |
| 16e — the booking page bounded: three field-guide tiles and one door, the other departures worth a look (D01), the intent question (D12 with D23's count folded in), the rusty diver's offers (D18); the composition test that holds the length | shipped | `src/app/s/[shopSlug]/trips/[id]/_components/TripPitch.tsx` | `src/app/s/[shopSlug]/trips/[id]/_components/TripPitch.test.tsx`, `src/app/s/[shopSlug]/trips/[id]/page.composition.test.ts`, `src/lib/worth-a-look.test.ts`, `src/lib/dive-intent.test.ts`, `src/lib/re-entry.test.ts` |
| 16f — the storefront's lenses (D02) and "next with space" | open | — | — |
| 16g — the thread: "Anything changed?" (D15 with D19 folded in), provenance chips (D51, Budget 5), the rental-fit line (D14) | open | — | — |
| 16h — the evening: souls not seats (#1346), the open-seats debrief (D47), the rental-fit leftover (D14), the plan-change meta (D24) | open | — | — |
| 16i — the recap: the postcard's number, save-as-image (#1081), the private line (D33), the private pulse (D40), the next dive (D35) | open | — | — |
| 16j — the ten adopted-unseen issues, built from their own bodies (#1284, D05 on H-67 b, D17, D25, #1363, #1366, D36+D45, D44, D52, #1357) | open | — | — |

16a and 16b are the first two because the home is the surface the gap was measured on; 16c is
third because every later surface reads the stage. 16j is a bundle in name only — each issue keeps
its own pull request.

## Working on it

The sources here are the working files. To change a board, edit its `.dc.html`, re-seed a fresh
copy with the design skill's helper (every artboard on both pages, `canvas.json`, the two `.jpg`
files, the title "Reef, all the way down"), check it, and republish to the URL above. The seeded
output is build output and is never committed ([design-artifacts.md](../../design-artifacts.md)).
