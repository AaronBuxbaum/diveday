# Nothing to explain — three ways to make DiveDay look designed

- **Status:** Superseded on 2026-09-19 by [One idea](../20260919-one-idea/README.md), on the owner's read of round 2 ("still not thinking big enough; the whole thing, top-down, needs complete rethinking"). The floor's type, colour, decoration and icon rows (22a, 22b, 22c, 22i) and round 2's surface stand and land first under any pick there; the three directions were three skins on one skeleton, and H-87 is withdrawn. Nothing shipped from it
- **Date:** 2026-09-18
- **ADR:** [20260918-nothing-to-explain](../../../architecture/decisions/20260918-nothing-to-explain.md)
- **Published:** https://claude.ai/artifact/NDrtPgYPW4zDyeT7w8BCe2

The fifteenth design canvas. The owner's brief on 2026-09-18: increasingly unhappy with the design;
re-evaluate the entire app top-down the way an Apple designer would; very clean, elegant and
delightful; a few options, one of which the owner will pick to implement. It follows
[Clear the deck](../20260911-clear-the-deck/README.md), whose five rounds in one day left eighteen
lettered calls open and nothing picked, and [One hand](../20260908-one-hand/README.md) before it,
whose four rounds added and whose floor of deletions never landed. This canvas answers with a
**diagnosis** — why nine rounds produced no pick: each answered a sentence with more; the instrument
was drawn as a console for engineers; the app has nine voices on one screen — a **floor** decided
from the owner's own reads rather than asked (one ramp, two inks and one tint, nothing drawn, one
shell, one row, two radii, dark by the device and glare by a word, creation as a sheet), and **three
directions** drawn as finished products on the same six screens for the same shop on the same
morning: **A · Inset**, the group carries the page; **B · Glass**, the material carries the page;
**C · Figures**, the number carries the page. There is one call, H-87: which of the three.
**Nothing here is normative**; the ADR carries the floor, the three directions and the call, and
code obeys the ADR.

## Artboards

Two pages. On the first, round 1: the cover on the left, the three directions in a row beside it, so
the same screen can be compared across the three by scrolling sideways. On the second, round 2: its
cover, then the same three directions redrawn frame for frame on the corrected surface.

| File | What it shows |
| --- | --- |
| `Main.dc.html` | The cover: the read in three seconds, why nine rounds produced no pick, today's captures (the home on a desk, the roll call in a pocket), the floor as a table of what is today and what is under every direction, the three directions as cards, the same boat in three hands, the side-by-side, the recommendation and the one call, what no direction changes, how it lands |
| `Inset.dc.html` | **A · Inset** — rounded white groups on a soft ground, a large title, a sidebar on the desk and a tab bar in a pocket; a boat is a group whose first row is the boat. The home and a boat on a desk; the home, the roll call, the night roll call and the storefront in a pocket; what it deletes, keeps and costs in code |
| `Glass.dc.html` | **B · Glass** — content edge to edge with nothing around it; every control in one floating layer of frosted glass that shrinks on scroll; one capsule for the page's act; a solid twin under glare. The same six screens, with the phone's rows running under the bar |
| `Figures.dc.html` | **C · Figures** — every surface opens with the one figure it exists to show, large and in the page's own type, with a ring where a count fills; Inset's groups and shell beneath; tiles on the home only. The same six screens, with the ring closing on the roll call |

### Round 2 — the visuals themselves

The owner's read of round 1, 2026-09-18: "I think my problem is that the core of this design is
kind of ugly. Can we evaluate the visuals themselves? I think there's nicer solutions that feel more
Apple-like." So the second page keeps the three directions and the one call where they are and
redraws the surface: an evaluation of round 1's own pixels — the muddy triad of deep-sea ink, the
shop's green and warm grey; a webfont's voice; hand-cut icons; outlined cards; cramped rows;
Bootstrap pills; no device; navy at night — each with what replaces it; a system sheet (cool
neutrals and pure white, near-black ink, one vivid lagoon-blue in two strengths, the device's own
face with the rounded face for figures, two concentric radii, capsules, re-cut icons, an iPhone
around every pocket frame, black at night), the same boat before and after in the three hands, and
the three directions redrawn on it.

| File | What it shows |
| --- | --- |
| `Round2.dc.html` | The page's cover: the owner's read, the eight-row evaluation with the fix for each, the sheet (colour by day and at night with measured contrast, type, shape and icons and controls), the same boat before and after in three hands, what changes in code, where the recommendation stands, the one call |
| `Inset2.dc.html` | **A · Inset, redrawn** — the same six screens on the corrected surface |
| `Glass2.dc.html` | **B · Glass, redrawn** — the same six screens; the glass floats over a white page |
| `Figures2.dc.html` | **C · Figures, redrawn** — the same six screens; the ring in the tint on white |

Round 2 reverses two rows of round 1's floor and says so: the face becomes the device's own with
Geist as the fallback (H-64 had settled Geist as the only face), and the staff tint becomes one
DiveDay blue rather than the shop's colour, which stays on the storefront. Both are decided on the
page, not asked; refusing either is one sentence in a session.

`today-home.jpg`, `today-manifest.jpg`, `today-phone.jpg` and `today-counter.jpg` are captures from
`pnpm dev` at `a8c16fb` on 2026-09-18 (`scripts/screenshot.mjs`, the demo shop, light, 1280 and
390), downsampled. The cover reads the first two. They are evidence, dated like the rest of the
canvas, and are never refreshed. `canvas.json` lays the eight boards on two pages, pins three notes, and opens on round 2.

## The fiction every board holds to

The same one as every canvas since Clearwater, so these boards compare with last week's. **Blue
Mantis Divers**, Key Largo (EDT), green `#1d7a5f`, Bricolage Grotesque on its storefront, boats
*Mantis II* (12 seats) and *Skiff* (8), Dana Reyes at the desk, Keiko Tanaka and Sal Moretti as
crew. The day is **Thursday, August 27, 2026, at 6:40 AM**: the 7:00 Two-Tank Reef — Molasses &
French on Mantis II, 10 of 12 booked, 6 here (Ravi Nair, Hannah Liu, Ben Carter, Emma Fischer, Ines
Costa, Nadia Petrov), Grace Mensah's Advanced card awaiting a look and Priya Sharma's waiver not
sent so neither can board yet, Nadia without an emergency contact, Hannah, Ben Carter and Emma
without rental sizes, Hugo Marsh and Ben Okafor not here yet; the 1:00 Wreck Trip — Spiegel Grove,
full, no crew assigned, Tomás Ferreira without a card for a deep wreck; the 7:30 Night Dive — City
of Washington on Skiff, 3 of 8, no last-minute deal sent, Jonas Berg's first dive since 2019. At
the desk: three messages waiting, one review waiting (Lars P.), Priya's $95 at 6:02 not yet
confirmed by Stripe, Dana's unfinished booking of Emmet O'Brien on Friday's 7:00. The week: Friday's
7:00 Morning Two-Tank at 9 of 12 and 8:00 Deep Wreck — the Duane at 1 of 8, Saturday's 11:00 sold
out with two waiting and its 7:30 at 5 of 8, Sunday's 11:30 — Benwood at 3 of 12; 62 of 84 seats
sold. The roll call on Mantis II at 6:58: 9 of 10 aboard, Hugo Marsh not aboard. The night roll
call on Skiff at 7:26 PM: 2 of 3 aboard (Amira Khan, Lars Petersen), Jonas Berg not aboard, Keiko
Tanaka as crew. Every name, number and time is demo-seed fiction. Nothing here is real customer
data.

## What every board keeps

The name and the mark; Harbor on every diver-facing page (the shop's face on the headings, its
colour on the current word and the one filled control); Geist as the only face; the dock test (44px
targets, 16px critical text, AA, never colour alone — every blocked name on every board is a word in
red ink beside a dot, never a hue alone); the coral bans on manifests, roll call, certs, waivers and
payments, moot because no board has coral; the roll call committing before it renders; the claims
policy; H-02; every row of [settled-questions.md](../../settled-questions.md).

## Known deviations, on purpose left in

- **The boards are drawn on the floor** — no water band, no drawn tile, no dial, no greeting, no
  eyebrow, no chip, no coral on a staff surface. The floor is decided in the ADR from the owner's
  own reads (H-77 rounds 1–4), not offered as a call; if the owner reverses it, the boards are not
  redrawn and the directions stand with the decoration back on.
- **Glare is described, not drawn.** Each board says what the word does — the app's own `.boat-mode`
  skin comes on for that phone until the same word turns it off — and B says its glass goes solid
  under it. The skin exists and is unchanged; a frame of it would be a frame of today.
- **The shop's colour is Blue Mantis's green on every staff frame.** A shop that has set none gets
  lagoon; the frames do not show that case.
- **The captures show the demo shop's own date (Friday, September 18)** rather than the fiction's
  August 27, because they are evidence of the running app and not part of the fiction.
- **The desktop frames are 1084 wide and cut at the fold**; a page's lower sections (the week,
  prep, the roster's tail) continue in the same grammar and are not drawn twice.

## Slices

Nothing has shipped from this canvas. The floor's first three rows may start on the ADR alone,
because each is one of the owner's own sentences taken at its word; every row from the shell onward
waits on H-87. When a slice lands, the component that must not drift names the ADR in its doc
comment, a test pins the rule, and this table moves.

| Slice | Status | Lands in | Pinned by |
| --- | --- | --- | --- |
| 22a — the floor: one ramp on the device's face (round 2) — `-apple-system` with Inter then Geist as the fallback, six sizes, figures in the rounded face with tabular digits, no capitals, no eyebrow, no greeting; the page's name is its title | open | — | — |
| 22b — the floor: the surface (round 2) — cool neutrals and pure white, near-black ink, one vivid lagoon-blue in two strengths with its bed, red and amber always beside a word, green only as the aboard fill, no pill on a staff surface, two concentric radii, capsules, no outline and no bed, black at night; the shop's colour stays on the storefront | open | — | — |
| 22c — the floor: nothing drawn on `/shop/**` — the water band, the site tile, the dial, the hand and the coral leave; `WaterBandStyle` and the illustration set render nothing under `/shop` | open | — | — |
| 22d — the floor: one shell — Today · Boats · Divers · Shop and Search, a sidebar at `lg` and a five-slot tab bar below, the twenty-one destinations regrouped under Shop and Search, the departure's four tabs one page (H-87) | dropped | — (superseded 2026-09-19 by One idea's 23a–23h) | — |
| 22e — the floor: one row and one group — `SectionCard` and `LedgerRow` become the picked direction's group and row, two radii, no bed; creation as a sheet (H-87) | dropped | — (superseded 2026-09-19 by One idea's 23a–23h) | — |
| 22f — the picked direction's own parts (H-87): A adds nothing beyond 22a–22e; B adds the glass layer, its solid twin under `.boat-mode` and the capsule; C adds `Figure`, `Ring`, the home's tiles and the one-figure guard | dropped | — (superseded 2026-09-19 by One idea's 23a–23h) | — |
| 22i — the icons (round 2): `DiveDayIcon` re-cut on the 26px, 1.6-stroke grid, filled when current in a tab bar | open | — | — |
| 22g — every surface on the picked direction, one family per session: the home, a boat and its roll call, the counter, the people, the shop, the storefront (H-87) | dropped | — (superseded 2026-09-19 by One idea's 23a–23h) | — |
| 22h — the night and glare on the picked direction: the night palette held by its test, glare as a word in the roll call's and the counter's bar (H-87) | dropped | — (superseded 2026-09-19 by One idea's 23a–23h) | — |

## Working on it

The sources here are the working files. To change a board, edit its `.dc.html`, re-seed a fresh
copy with the design skill's helper (the four artboards, `canvas.json`, the four `.jpg` files, the
title "Nothing to explain"), check it, and republish to the URL above. The seeded output is build
output and is never committed ([design-artifacts.md](../../design-artifacts.md)). The four boards
share one prose stylesheet, pasted verbatim into each between `/* kit:start */` and `/* kit:end */`,
and one app stylesheet between `/* app:start */` and `/* app:end */`; each direction's own sheet sits
between `/* inset:start */`, `/* glass:start */` or `/* figures:start */` and its `:end`, and the
cover carries all three because it draws the same boat in three hands. Round 2's boards carry the
corrected surface between `/* app2:start */` and `/* app2:end */` and their direction's sheet between
`/* inset2:start */`, `/* glass2:start */` or `/* figures2:start */` and its `:end`; the round-2 cover
carries both rounds' sheets because it draws the same boat before and after. Change a block in one board
and copy it into the others with a scripted replace, never by hand and never as a divergent copy.
