# One hand — why DiveDay feels like four products, and four ways to make it one

- **Status:** Live (its ADR is Proposed, pending H-71; rounds 2 and 3 drawn 2026-09-09 on the owner's two reads; no slice has started)
- **Date:** 2026-09-08
- **ADR:** [20260908-one-hand](../../../architecture/decisions/20260908-one-hand.md)
- **Published:** https://claude.ai/code/artifact/cfd0c597-1a70-4990-a171-4548ebae401f

The thirteenth design canvas. The owner's brief on 2026-09-08: the app is not consistent in voice,
spacing, elegance, delight, design system and components; take a very thorough look at everything
and propose solutions; at least three approaches; think creatively and top-down; the current visual
style is not sacred. This canvas answers in three parts. A **diagnosis**, read from the running app
with the whole tree counted: DiveDay has a good design system and still feels inconsistent, because
five design passes landed in twelve days (Clearwater, Reef, Reef all the way down, Before you ask,
Nothing from nowhere) and each added a vocabulary without deleting the one before, so the six things
no checker can see — a page's width, what its eyebrow says, how a group carries its count, what a row
is, how a thing is added, how a state is drawn — each have between three and nineteen spellings (and the disclosure beside them twenty-seven),
and the voice, with one rule and thirty-six bundle authors, has the same shape of problem. An
**audit sheet** that draws the evidence: one diver's row in eight anatomies, "add a thing" in six
spellings, one state in five drawings, the eyebrow saying four kinds of thing, the clipboard failing
in seven sentences. And **four directions** that each redraw the shop home and the Gear register for
the same shop on the same morning: A finishes Reef by subtraction; B, C and D replace the surface
and keep A's deletions underneath. **Nothing here is normative**; the ADR carries the decisions, the
pick is the owner's (H-71), and code obeys the ADR.

## Artboards

Three pages. The first is round 1 (2026-09-08): the argument on top, the four directions beneath.
The second is round 2 (2026-09-09): five levers on top of A, drawn after the owner's read of the
first page. The third is round 3 (the same day, after the owner's read of the second): the kit that
composes A with the three levers the owner liked, every surface of the app redrawn on it, and
eight more levers.

| File | What it shows |
| --- | --- |
| `Main.dc.html` | The cover: the diagnosis in one paragraph, the twelve deletions every direction shares (the floor), the four directions with each one's case and tradeoff, the same row drawn by the four hands, what no direction changes, the owner's four calls |
| `Audit.dc.html` | The evidence, drawn from screenshots of the tree at HEAD and counts over it: five widths, the eyebrows and titles, three ways a group carries a count, eight row anatomies for one diver, six "add" spellings, one state in five drawings and good news wearing the alarm's wash, four meters, seven things on the right of a row, where a list lives and what a notice looks like, delight spent along one seam, the voice in six specimens, the diagnosis |
| `DirectionA.dc.html` | **Finish the sentence** — Reef, by subtraction. The case, the system strip (the unchanged palette, the one row, the one add, the three pills), the home and Gear drawn with one page anatomy |
| `DirectionB.dc.html` | **The logbook** — every surface a page of the shop's one book: a margin column, ruled entries, a figure or a verb in the right column, a stamp when a thing is settled. Newsreader for names and titles, Geist for sentences, Geist Mono in the margin; no panels, shadows, pills or chevrons |
| `DirectionC.dc.html` | **The instrument** — the staff tool as a dive computer: dark by default, one cyan for every action, every number a figure, every state a word in a fixed slot; two components, a readout and a line, and nothing else |
| `DirectionD.dc.html` | **The briefing** — the voice as the system: every surface opens by telling you the state in five sentence shapes (State, Need, Fact, Offer, Done) and the controls are verbs inside the sentences; the kind word, the chevron and the right-hand action go |

### Round 2 — five levers on A

The owner's read of round 1, 2026-09-09: A is the best of the four but wants more "wow"; the
instrument (C) is hard to move around in and not warm enough; the logbook (B) is not efficient and
not what a dive shop wants to deal with; the briefing (D) feels like too many existing apps; and all
four felt too close to ideas already tried — which, read against the twelve earlier canvases, is
fair (the instrument was Deck on 09-01, the paper page was Tide). So round 2 keeps A as the base and
adds one lever per board, none of which any canvas has drawn. Letters continue from round 1 and skip
G and J, dropped before drawing (G was Deck's figure-first ramp again; J was gestures the dock test
already limits).

| File | What it shows |
| --- | --- |
| `Round2.dc.html` | The page's cover: what the owner said and what it rules out, the five levers with their case and risk, how they score against warm · efficient · not-another-list · lands-on-the-home, how they combine, the recommendation, the owner's round-2 calls |
| `LeverE.dc.html` | **Rooms** — the shop drawn as its own places: Today as the board behind the counter (a column per boat, name cards, crew magnets, the desk as a tray), Gear as the wall (tags on hooks by kind); one card at three sizes |
| `LeverF.dc.html` | **The tide line** — one 64px strip under the chrome on every staff page: the day as a line, departures as blocks that fill as divers board, a moving "now", the next boat lit; drawn on Today at 5:48 and on Gear at 6:31 |
| `LeverH.dc.html` | **Their sea** — Harbor comes inside: the staff app takes the shop's colour through Harbor's derivation, and each departure's header carries a site photograph (the shop's own, the catalogue's, or the hand's mark when there is none); where the sea stops |
| `LeverI.dc.html` | **The one page** — no tabs: Now, Later, the desk, the shop as one scroll with a rail; a register opens as a sheet over the page |
| `LeverK.dc.html` | **Together** — who is in the shop and where, a chip on the row a colleague is acting on, a one-tap hand-off on a Need, and the counter updating live on the desk's screen |
| `Composite.dc.html` · `CompositePhone.dc.html` | **The recommendation, composed** — A with F, H and K on one home at 6:31 AM, at desktop and phone width; on the phone the tide line folds to a 36px strip with the next boat only |

### Round 3 — every surface, one hand

The owner's read of round 2, 2026-09-09: "I like everything you've done here and I want to keep
pushing these concepts farther. Let's keep cleaning up, iterating, and forming innovative concepts
that will make customers go 'wow'. Make sure we're designing every surface of the app." So the third
page composes A with F, H and K into one kit, redraws all eighty-one page routes on it (each board
naming what today's page loses and what it gains), and adds eight levers, L to S, none drawn by any
earlier canvas. Every board is drawn from one stylesheet, pasted verbatim into each file between
`/* kit:start */` and `/* kit:end */`, and from three inventories of the tree and seventy-three
screenshots taken the same day.

| File | What it shows |
| --- | --- |
| `Round3.dc.html` | The page's cover: the owner's read, the eight levers with their case, risk and cost, every surface and the board it is drawn on, the order to build it, the owner's round-3 calls |
| `Kit.dc.html` | **The kit** — tokens (the shop's, DiveDay's, the signals, night, boat), the type ramp, the page anatomy, the tide line at four moments and folded, the one row in eight contents, state and notices, controls and meters, the panel and the photo band, the round-3 specimens (the line, the pass, the postcard, the log, the rooms), night and boat |
| `StaffToday.dc.html` | **Today, through the day** — 5:48, 7:04 (the boat away), 3:30 PM, 6:10 PM (the close-out writes the log), and a phone |
| `StaffCounter.dc.html` | **The counter** — check-in with the pass just scanned, the walk-in's two steps, the global Add-booking door, a phone |
| `StaffChrome.dc.html` | **The chrome and the doors** — the bar and More, the identity menu, ⌘K answering in the row grammar (Q), the one notice, loading, error and not-found, sign-in with a passkey, the invite, the phone dock and sheet, night |
| `StaffSchedule.dc.html` | **The board** — the week as seven vertical tide lines, the add panel filled from the pattern, the stream on a phone, the blow-out, Staffing |
| `StaffTrip.dc.html` | **The departure** — the trip page under its photo band with the trip's own line (L), the roster as one ledger, Prep and the rental ticket, the Log that prints the postcard, the print packet, a phone |
| `StaffManifest.dc.html` | **The head count** — the manifest builder, the roll call on the boat by day and by night, everyone up, the offline viewer, the lobby board with the line and the room |
| `StaffDivers.dc.html` | **The drawer** — Divers and its empty state, the diver record (status, story, file), add a diver, Waivers, Inbox, Requests, a phone |
| `StaffShelves.dc.html` | **The shelves** — Gear and the wall, a unit, Dive sites and the site editor with its diver preview, Courses and the course editor |
| `StaffMoney.dc.html` | **The till and the log** — Orders with the two back-office bands, an order, a new order, promo codes and the last-minute deal, Reports as the shop's log (O), a phone |
| `StaffSettings.dc.html` | **The shop's card** (R) — Settings opening on the card, brand and display with the live preview by day and at night, Team, money and integrations, data and devices, a phone |
| `DiverHarbor.dc.html` | **The shopfront, in the shop's face** — the storefront with Right now and the line (L), the trip page with the form as its last word, courses, reviews, register, the date request, the embed, the shop 404, a phone |
| `DiverBooking.dc.html` | **Booking, the pass, the waiver** — the flow on a phone ending in the pass (M), confirmed on a desktop, the waiver's three steps and its moment, claim, verify, the arrival card |
| `DiverDay.dc.html` | **The thread** — before (the step spine), the day (the line live, "You're aboard", the boat back), after (the postcard, N), the doors, the dead ends |
| `Messages.dc.html` | **Every message, one voice** — booking confirmed with the pass, the night-before texts, prep and waiver mails, the postcard mail, the last-minute deal, the staff invite, the blow-out, the push, the calendar entry, the link card, the voice sheet applied |
| `Public.dc.html` | **DiveDay's own pages** — the homepage with the tide line as its hero, product, pricing, about, switching, the regions, the doors, first light (S), status, privacy and terms, the 404, the link cards |
| `Moments.dc.html` | **The earned moments** — twelve finishes in the order of a day, each with when it fires and when it is silent; where coral, a photo and motion may go |
| `Phones.dc.html` | **Six phones** — Today, the counter, the trip, the roll call, the storefront and the thread at 390, the fold of everything |

`canvas.json` lays the thirty-three boards out on three pages and pins eight notes. The audit's counts come from three read-only
sweeps of the tree on 2026-09-08 (styling drift, component duplication, voice), and the screenshots
from `node scripts/screenshot.mjs` against the seeded shop at 1280 and 390.

## The fiction every board holds to

The same one as every canvas since Clearwater. **Blue Mantis Divers**, Key Largo (EDT), green
`#1d7a5f`, Bricolage Grotesque on its storefront, boats *Mantis II* (12 seats, slip 14 at Marina Del
Mar) and *Skiff* (8), Dana Reyes at the desk, Keiko Tanaka and Sal Moretti as crew, Marcus Webb
teaching the courses. The day is **Thursday,
August 27, 2026**: 7:00–10:30 AM Two-Tank Reef — Molasses & French, 10 of 12, Grace Mensah's
certification awaiting verification, Priya Sharma's waiver not sent, three divers without rental
sizes, Nadia Petrov without an emergency contact; 1:00–5:00 PM Wreck Trip — Spiegel Grove, full,
no crew assigned, Tomás Ferreira without a certification for a deep wreck; 7:30–11:00 PM Night Dive
— City of Washington, 3 of 8, no last-minute deal sent. Gear: 37 units, 36 on the wall and BCD #5 out
with Tom Okafor and due back today, BCD #2 reserved for Priya Sharma from Sep 13, Reg #4 needing
service, AL80-03 due a visual inspection. Round 3 adds the people the boards needed and holds
every board to them: on the 7:00, Ravi Nair (his 12th dive with the shop), Hannah Liu and Ben Carter
(a buddy pair), the Ortiz party of three (Luis, Marta and Sofía, 14, Junior Open Water), Emma
Fischer (nitrox), and Diego Alvarez walking in at 6:40; the trip's line runs check-in 6:15 · boards
6:45 · leaves 7:00 · Molasses 7:40 · surface 8:50 · French 9:20 · back 10:30; Jonas Berg is on the
night dive for his first dive since 2019; the 1,000th diver of the season boards tonight; yesterday
was 23 divers, 2 boats and 1 walk-in with nothing left open; the month is $41,180 with two open
orders and one unconfirmed Stripe call (Priya's $95 at 6:02).

## What the directions share, and where they differ

Every direction keeps the name and the mark, Harbor (the diver-facing pages wear the shop's brand;
B, C and D change what the storefront is made of, never whose it is), the dock test, the coral bans
on manifests, roll call, certs, waivers and payments, the claims policy, the i18n rule, and boat
mode as Geist and high-contrast. Every direction begins with the twelve deletions on the cover —
they are Direction A in full and the first slice of the other three.

| | A · Finish the sentence | B · The logbook | C · The instrument | D · The briefing |
| --- | --- | --- | --- | --- |
| The surface | Reef, unchanged | paper, rules, ink; slate at night | abyss, one cyan; the surface by day | Reef, quieter — no tints on staff pages |
| Faces | Geist | Newsreader + Geist + Geist Mono | Geist + Geist Mono | Geist, at 17 and 20 |
| The row | mark · kind · sentence · one door | margin · entry · right column | time · who · state · verb | a sentence ending in a verb |
| A departure | a 28px panel | an entry with a heavy top rule | a labelled block of lines | a lead sentence with its Needs beneath |
| A state | three pills + words | three stamps | a word in a fixed slot | the sentence says it; a glyph before it |
| Add | the last row | the next empty ruled line | the last line, in cyan | the last sentence |
| Cost | 2–3 sessions | 5–7 | 6–8 | 4–6, mostly copy |
| Honest tradeoff | looks like today, tidier | paper is a light-mode idea; a serif in glare | cold at a desk; light mode second-class | prose scans slower; every sentence twice |

## Slices

The ADR's slice table is the sequence; this table is the record of what has landed. Slices 20a–20e
are the floor and move on the ADR alone; 20f waits on H-71 c, 20g on H-71 a, and 20h–20m (round 3)
on the calls named beside each.

| Slice | Status | Lands in | Pinned by |
| --- | --- | --- | --- |
| 20a — one width, one header: the `<main>` width guard, the eyebrow from the destination registry, the title as the tab's word | open | — | — |
| 20b — one row: LedgerRow on the five densest hand-rolled lists, the group's count as meta, the add row | open | — | — |
| 20c — one state: Badge loses its neutral tone, the good-news line, coral never a wash behind text nor a meter, ProgressBar the one bar, the two bugs | open | — | — |
| 20d — one link, one skeleton, one disclosure: the link guard, `ui/skeleton.tsx`, the summary sweep | open | — | — |
| 20e — the voice sheet in brand.md, `check:voice` grown to it, the bundle sweep | open | — | — |
| 20f — the earned moment on the shared door (H-71 c) | open | — | — |
| 20g — the levers on A (H-71 a, round 2): F, H and K as composed on the Composite and on every round-3 board; E answered by 20l, I kept on the canvas | open | — | — |
| 20h — L, the trip's own line: the trip page, the thread, the lobby board, the reminder email (H-71 h) | open | — | — |
| 20i — M, the pass: confirmed, the email, the counter's scan, "You're aboard"; composes 18f (H-71 f) | open | — | — |
| 20j — O, the log: the close-out writes, Reports reads, the season strip (H-71 g) | open | — | — |
| 20k — N, the postcard from the crew's log; the recap email and the thread's after-state | open | — | — |
| 20l — P the six rooms in the empty states and on the lobby board, R the shop's card, S first light, Q's two new answers | open | — | — |
| 20m — the surface sweep: every board's "Deleted here" applied to its pages, one family per session | open | — | — |

## Working on it

The sources here are the working files. To change a board, edit its `.dc.html`, re-seed a fresh
copy with the design skill's helper (all thirty-three artboards, `canvas.json`, the title "One hand"),
check it, and republish to the URL above. The seeded output is build output and is never committed
([design-artifacts.md](../../design-artifacts.md)). Round 3's boards share one stylesheet, pasted
verbatim into each between `/* kit:start */` and `/* kit:end */`: change it in one board and copy
the block into the other eighteen with a scripted replace, never by hand and never as a divergent
copy — a board that needs a rule the kit lacks names it under "New here" first.
