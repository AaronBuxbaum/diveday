# Marketing review — 2026-08-27

- **Status:** Open — argued, sliced, nothing delivered yet. Move this file to
  [archive/](archive/) when roadmap section 12's slices have landed, the way
  [archive/marketing-review-20260723.md](archive/marketing-review-20260723.md) did.
- **Why now:** shop owners are not converting to trials (the owner's own read, 2026-08-27), and
  the funnel pair (`demo_entered` / `trial_started`) is too thin to argue from — so this review
  argues from the pages themselves: three independent conversion passes (home+product,
  pricing+onboard, switching+about) against [marketing.md](marketing.md)'s claims policy, plus
  full-page screenshots of every route.
- **What this is not:** a rebuild. Every pass found real composition — the price hero that
  answers everything in one screen, the mirrored diptych, the `GUIDE_FACTS` strip, the numbered
  breadth band. The pages are correct. The findings are about where the *persuasion* sits.

## Three diagnoses

**1. The persuasion gradient is inverted.** The most human, unpasteable sentences on the site —
"Roll-call buttons big enough for wet thumbs," "a question, a doubt, a bad morning at the
counter," "Better you hear ours from us than find it in your second week" — live in captions,
footers, and FAQ rows. The heroes and section heads carry the flattest scope claims ("Run the
whole dive day, from booking to head count" — a sentence any rival could paste). A visitor who
bounces in two screens never meets the copy that would have converted them.

**2. The terms never stand at the doors.** The flat price is invisible until the last band of
`/`; `/product`'s money band raises the cost question and parks the number behind a click; the
"Start a trial" button carries no terms (free, 3 weeks, no card, soft expiry) at either of
`/pricing`'s decision points; `/onboard`'s footnote says "free for 3 weeks" and never answers
day 22. A burned buyer reads every unlabeled door as a card wall.

**3. Help arrives after the homework.** The concierge — the strongest de-risking claim we own,
authorized, human, free — first appears about 80% down every switching guide, *after* the
four-phase move rail that makes switching look like a project. `/about` tells the reader four
times to go check the product and puts the demo door at the bottom of the page, under a
primary-weight mailto.

**And the thesis is missing its proof.** The product's argument is delight-first — "the shop
gets remembered" — and the homepage's day ends at 8 a.m.: booking, readiness, stop. Nothing on
`/` shows DiveDay producing a good *evening*. The recap — the one artifact a diver voluntarily
shares, with the shop's name on it — exists on the site only as chapter 05 of `/product`.

## The changes, by page

Every proposed sentence below is shipped-fact-only, restates no price outside interpolation from
`earlyAccessPrice`, invents no billing terms, and lands in both locales in the same change. Each
slice updates the `e2e/marketing.spec.ts` assertions it moves — deliberately.

### `/` — the homepage says the morning, and the day gets its evening

- **Hero rewrite.** `heroTitle`: **"Who's booked, who's cleared, who's on the boat — one
  answer, all day."** `heroDescription`: **"Bookings, waivers, cert checks, trip prep, and the
  roll call in one calm place. When a diver isn't ready, DiveDay says so at the desk — not at
  the dock."** The triad names questions only a dive shop asks; the description drops the
  internal word "readiness" and lands the no-silent-passes differentiator.
- **The price reaches the first screen.** One muted text line under the demo note (text, not a
  control — the hero's pinned control budget is untouched): **"One flat price — {price}
  {cadence}. No cut of your bookings."** The closing band keeps the two-year-lock detail.
- **A third moment: the evening.** The moments band gains its missing row, using the existing
  `RecapPageFallback` mockup — **when:** "That evening" · **title:** "Divers go home with a page
  worth sharing" · **description:** "Their dives, a note from the crew, room for their own
  photos — with your shop's name on the thing they send their buddy." This is the one change
  that argues revenue rather than administration, and the delight thesis's only home on `/`.
  When thread slice 7d ships, `RecapPageFallback` re-draws as the keepsake card (dive record,
  crew line, review ask); whichever of 12b/7d lands second carries the reconciliation in its PR.
- **Mid-season answered where it disqualifies.** One sentence in the records band's arriving
  column, promoted to a shared key so the guides and the band cannot drift: **"Mid-season isn't
  a problem: run DiveDay alongside what you have for a trip cycle, and a second import updates
  your divers instead of duplicating them — an afternoon, not a project plan."** (Every clause
  already published in `guides.shared.cutover.*`.)
- **Redundancy cuts.** The moments band keeps one sentence, promoted: h2 becomes **"The desk
  clears it in the morning. The captain sees it at the dock."** and `momentsDescription`
  deletes. The diver-moment description leads with "one obvious next step instead of a
  back-and-forth with the shop." The four-card summaries rewrite as sentences about the owner's
  day (worked example, welcome: **"Divers book and pay themselves, from your website or ours,
  and you can see the confirmation actually arrived — no phone tag, no 'did you get my
  email?'"**); `diveDay`'s "one source of truth" gives way to its own closing clause (the
  counter and the boat reading the same thing).

### `/product` — the dare gets a door

- The money band renders the figure in place (interpolated): **"One flat {price} {cadence} —
  see everything it covers →"**.
- A demo door lands directly under the 49-line capability index — the band whose lede
  ("Every one of these lines is something you can go and do in the live demo right now") creates
  intent the page currently has no way to spend. New registered funnel tag: `product-index`.
- Hero description rewrite: **"Every booking, waiver, certification, payment, and head count
  stays attached to the trip it belongs to — so nothing gets asked twice and nothing gets
  missed once."**

### `/pricing` — the terms stand at the door

- **Trial terms at the CTA pair** (both positions), sibling to the demo note: **"The trial is a
  shop of your own — free for 3 weeks, no card, and nothing switches off when the window
  ends."** (Soft expiry per `src/lib/trial.ts`; the FAQ row keeps the depth and the
  `onboarding@dive.day` address.)
- **The two-year lock moves under the figure** — directly beneath "per location / month":
  **"Locked for two years for founding shops."** `item5` trims so the claim isn't inventoried
  twice.
- **The fee anchor stops lecturing.** Body: **"If your bookings run through a channel today,
  you've already done this math: the busier the season, the bigger the cut. Here is how two of
  those channels describe their own pricing, next to DiveDay's flat shop price."** The
  FareHarbor row breaks its semicolon run into breath units (rate stays reported-only,
  attributed).
- **FAQ:** add **"Do I pay more as my crew grows?"** (no — every role gets a login, divers never
  need accounts) and **"How long does setup take?"** (six fields; the shop exists on submit; the
  spreadsheet comes in with a preview). Fold the November case into `trialMeaning` ("what you
  set up keeps working — so if your season is months out, nothing is lost by building the board
  now"). Cut `faq.offline` — a product question wearing pricing clothes, answered at depth on
  `/product`.
- **Credentials wording, both places** (the securityNote and the export mockup — the mockup
  mirrors the real Settings screen, so change both surfaces and the screen's own words together
  or not at all): **"The only things held back are credentials — passwords and device push
  keys, which no other system could use anyway."**

### `/onboard` — day 22 answered at the password box

The reassurance footnote's first clause becomes **"Free for 3 weeks, no card — and nothing
switches off when the window ends."** This rides the first-light canvas's slice 10b (which
already collapses the four reassurance sentences to one); the 10b SPEC and artboard carry the
reconciled sentence.

### `/switching/*` and `/about` — help arrives before the homework

- **The concierge moves to the top of the move rail**, one shared key
  (`switching.common.moveIntro`): **"Every step is one you run yourself, in your own time.
  Rather hand it off? Send us the file and a person brings your divers in with you, free."**
- **The leave-it ledes lead with the documented wedge.** DiveShop360: **"Your customers and
  their certification records live in DiveShop360's cloud, and the way out is the four CSVs its
  own FAQ names — downloaded one at a time, no bulk export, no API. You need two of them.
  Here's the whole path, with a plain account of what makes the trip and what stays behind."**
  EVE: **"Years of divers and their certification records are sitting in a database on one
  back-office PC — and shops report the history is the hard part to pull out cleanly. Here's
  how to get your file out of EVE yourself, and a plain account of what makes the trip and what
  stays behind."** (FareHarbor/Rezdy heroes stay.)
- **A fifth shared cutover step** answers "what does my crew have to learn": **"Let the crew
  walk their screens first — the live demo runs the same roles your dock does. Have the captain
  run a roll call and the desk see who's not ready before you move a single record."**
- **The spreadsheet guide gets the parallel-run note** on its import phase: **"Keep the sheet
  going as long as you like. A re-import matches divers by email and updates them instead of
  duplicating, so the day you stop keeping it is yours to pick."** And `wedgeIntro1` drops the
  character judgment: **"A spreadsheet remembers everything and checks nothing. It holds the
  names and the numbers; the checking — cards, waivers, who's still not ready — is what you're
  doing by hand right now."**
- **The scope table's nitrox row** reads as one state instead of three: **"Comes across with
  the diver's record, marked imported. Until staff give it a one-tap confirm, that diver gets
  plain air — boarding never waits on it."** Safety-adjacent: verify against
  `src/lib/import.ts` semantics and take `dive-domain-expert` review before shipping.
- **`/about`:** the `FunnelCtas` pair lands directly under the four-rules grid (the page
  manufactures the "go check" impulse there and currently spends it on a primary-weight
  mailto); the support email demotes to secondary; `leaveTitle` becomes a heading that matches
  its section (e.g. **"What you're standing on from day one."**). Optionally, the hub's
  catch-all row adds the human: "And if yours is messier than that, send it over — a person
  maps it with you, free."

## One owner call

**A pricing link on the leave-it guides.** [marketing.md](marketing.md) scopes the single
forward `/pricing` link to the coexist guides' leave-path box and says a second placement needs
its own decision. An EVE or DiveShop360 reader's "and yours costs what?" currently has only the
nav tab. Recommendation: allow the same destination-not-claim link
(`switching.common.seePricing`) under those guides' bothWays block. Decide before slice 12e.

## What stays

The price-hero composition (figure, negations, doors, included list — the whole answer in one
screen) is the bar the other pages are being held to. The `GUIDE_FACTS` strip, the mirrored
diptych, the numbered breadth band, the boxDescription dare, and `contactBody`'s "a bad morning
at the counter" all stay untouched. The four-card band remains four assertions per the
2026-08-20 decision; nothing here relitigates it.

## Implementation

Slices live in [features/roadmap.md](features/roadmap.md) section 12; every slice runs the
`marketing-page` skill end to end (claims checklist, `e2e/marketing.spec.ts` updates, screenshots
looked at, `conversion-reviewer` re-pass), and the safety-adjacent items name their extra
review. One tooling fix shipped with this review: `scripts/screenshot.mjs` now emulates reduced
motion, so full-page marketing captures no longer carry section-sized voids where
`MarketingReveal` was waiting for an intersection that never fires in a stitched capture.
