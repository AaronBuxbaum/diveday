# Florida call list — template and sourcing method

**This file contains no shops.** It is the frame for building the list: why Florida, what makes a
shop worth an hour, what makes one a bad first pilot, where to look them up, and the columns to
fill. The rows are the founder's to research — a list of invented names and numbers would get
dialed, and inventing one is worse than having none.

Target: **twenty to thirty qualified shops** for the four-touch rhythm in the [cold email template](cold-email-template.md#the-rhythm-four-touches-then-stop), enough to read the result and to absorb the shops that say no. Ten was too few to judge anything. Phase 1 needs two or three to say yes.

## Why Florida, and why one state

Florida is the launch jurisdiction — confirmed by the product owner 2026-07-30 (H-20260730-jurisdiction-waiver-text-medical), no longer a
planning assumption. Every waiver, medical-question, and retention answer the attorney gives is
scoped to it, so a shop outside Florida cannot be piloted on approved paperwork even if it says
yes. It is also year-round, which is the whole reason
[rollout.md](../rollout.md#phase-1--design-partners-septoct-2026) can target a Sept–Oct in-season
pilot at all.

Practical consequence: **a promising out-of-state shop is a Phase 2+ note, not a Phase 1 call.**
Write it down somewhere else and move on.

## Coverage: aim across regions and across profiles

The three deliberate profiles are specified in
[rollout.md](../rollout.md#who-to-recruit--three-deliberate-profiles) — don't re-derive them. A
sensible cut of ten:

| Profile | Slots | What it stresses in the product |
| --- | --- | --- |
| Boat-charter-heavy (daily two-tank trips) | 4 | Manifests, roll call, prep list, the Today queue — the safety spine |
| Course-heavy (steady Open Water pipeline) | 3 | Course catalog, sessions, instructor staffing, waiver/medical on students |
| EVE or DiveShop360 defector | 3 | The importer and the `/switching` guides against a real incumbent export |

Florida's diving is regional and the operations differ by region, so spread the ten rather than
taking ten shops from one town. Reef-and-wreck day-boat country (the Southeast coast and the Keys),
spring/cavern country on the Gulf side and the north-central springs, and the Panhandle each run a
different kind of day. One shop per region is enough to notice if the product only fits one of them.

**Know this before you dial a springs shop.** DiveDay cannot express the gate a guided cavern tour
actually runs, and that is a deliberate decision rather than a gap waiting to be filled (ADR
20260718-specialty-site-cert-requirements, amended 2026-08-22). A cavern operation's safety comes
from a cavern-rated professional in the water at a tight ratio, three lights per diver and a
continuous guideline — none of which is a card the customer holds, and the customer usually holds
none, because the whole product is a guided tour sold to Open Water divers. DiveDay has no way to
say "this departure needs an assigned person holding X" or to bind a hard per-departure ratio.

So a springs shop gets the board, the manifests, the waivers and the roll call, and puts its tour's
demands in the site's `difficulty_level` and its briefing prose while the pro in the water makes the
call — which is what happens at every springs operation in Florida regardless of what software they
run. Say that plainly if it comes up. Pitching them a cert-gating story is the one way to lose the
call on a true objection.

## Qualification criteria — what earns a call

Sharpened 2026-11-25 from the outreach review, which found the first five sends went to shops that did not need us. A shop is worth a place in the rhythm only when it passes the three fit rules:

1. **Its own boat of about 12 or more divers, or several boats.** The cleared-to-board list and the count after each dive only matter when the morning is crowded. A small charter's paper is fine.
2. **A named owner or manager.** Someone who can say yes without a regional office, with a published address or a page to message. A general inbox gets the forwarding variant and a lower score.
3. **Paperwork that is manual or split across tools.** Waivers on paper or in one tool, bookings in another, a boat list in a spreadsheet. If one tool already covers waiver and list, there is little to win.

Then, in rough order of value, these raise a shop's score:

- A published two-tank schedule with departure times, so a preview can open on them.
- A store, rentals, or courses feeding the boat, so rental sizes and certs arrive in a pile.
- Publicly visible pain with the current process. Reply to their named problem with specifics; never broadcast ([commercial-and-industry.md](../stakeholders/commercial-and-industry.md)).
- Reachable in person, because Phase 1 is high-touch.

## Disqualifiers — do not open a Phase 1 conversation with these

These are not judgments about the shop; they are places where DiveDay would fail them, and finding
that out in week two of a pilot is the expensive way.

- **A small six-passenger charter booked on FareHarbor or Peek** (found 2026-11-24). Those tools already give it waivers and a boat list for no monthly fee, so DiveDay has little to add to a boat that small. Four of the first five emails went to shops like this and none replied. A good place to run a boat test, a weak partner.

- **Retail POS is the center of the business.** DiveDay concedes retail POS, agency (PADI) sync, and
  gear inventory outright ([marketing.md](../marketing.md)). A shop whose day is the till will be
  disappointed, honestly and correctly.
- **Multi-location operation.** Out of scope and explicitly unclaimable under the claims policy.
- **The shop needs agency-roster sync.** No agency exposes a usable C-card verification API; DiveDay
  checks one card at a time through the browser extension, on the agency's own page
  (H-20261007-request-supported-c-card, dropped; H-20261008-cert-check-extension).
- **A Spanish-first shop, for now.** The diver bundle's Spanish translation has not had its native
  review (V-06), and the waiver, the medical questionnaire, and `/ready` are still English pending
  H-20260730-jurisdiction-waiver-text-medical/H-20260724-current-typed-name-explicit — the shop would meet a language seam at exactly the wrong page.
- **A shop that wants a signed contract this week.** There is no entity and no contract set yet
  (H-20260724-corporate-footing-diveday-operate); a pilot agreement cannot be signed until that closes. A shop willing to talk now and sign
  when the paperwork exists is fine — one that needs paper first is a Phase 2 call.
- **A shop whose fill station would go into DiveDay on day one.** The nitrox parameters are approved
  policy but unreviewed in the field (V-05).

Record the disqualifier when you park a shop. A parked list with reasons is a real asset once H-20260724-corporate-footing-diveday-operate
and V-05/V-06 close; a parked list without reasons is a deleted afternoon.

## Where to source candidates (public, verifiable)

Work top to bottom; the first two give near-complete coverage and the rest add context.

1. **The PADI dive-shop locator and the SSI dive-center locator**, filtered to Florida. Between them
   this is close to a complete public list of affiliated shops, with the shop's own published
   contact details. NAUI and SDI/TDI locators catch shops the first two miss.
2. **The shop's own website.** This is where the profile is decided: a published daily two-tank
   schedule with departure times says boat-charter-heavy; a course calendar with Open Water dates
   says course-heavy; an online booking widget names the channel or system they're on.
3. **Their booking flow, clicked through as a diver** (stop before paying). It shows you what their
   diver actually experiences, whether waivers are digital, and often which vendor is behind it.
4. **ScubaBoard's dive-shop-software threads.** The same threads the
   [competitive research](../archive/assessments/competitive-strategy.md) mined for incumbent complaints —
   shop owners describing their own pain in public, by name.
5. **Facebook dive-industry groups** (shop-owner and dive-professional groups) for the same signal.
6. **Charter and dive-site directories, and the dive-boat listings around a given port** — useful for
   finding operators whose web presence is thin but whose boat runs daily.
7. **Scubanomics / Business of Diving Institute** for the business-of-diving context, and **DEMA's
   member directory** once membership happens (item 7 on the 30-day list).

**Warm beats all seven.** Shops the founder already dives with, and introductions from them, outrank
any directory row: a pilot needs trust more than reach.

## The columns to fill

Keep the filled list **outside this repository**. It will accumulate owner names, mobile numbers,
and notes on people's businesses; none of that belongs in a git history, and the repo's standing
rule is that personal data does not enter it. A spreadsheet or a CRM is the right home. Use only
contact details the shop has published for business use.

| Column | What goes in it |
| --- | --- |
| Shop | Legal/trading name as they write it |
| Region | Which of the Florida regions above — for coverage, not geography trivia |
| Profile | `boat` / `course` / `defector` — the pitch changes, so decide before dialing |
| Why this shop | One line. If you can't write it, it isn't qualified yet |
| Current system | Named incumbent, booking channel, paper, or unknown — and how you know |
| Boat? | Own boat / partner boat / none, and typical divers per departure if published |
| Decision-maker | Name and role, if publicly listed. Blank is fine; guessing is not |
| Contact route | Published business phone / email / dock visit / warm intro via whom |
| Source | The URL or the person the row came from — so the next pass can re-verify |
| Researched | Date you did the lookup; anything older than a season needs a re-check |
| Status | `to research` / `to call` / `called` / `meeting` / `pilot` / `parked` |
| Disqualifier | Which one from the list above, if parked |
| Last contact | Date and channel |
| Next action + date | One action, one date, naming the step of the four-touch rhythm (day 4 note, day 10 message, day 17 last email). An empty next action means the row is dead |
| Fit | Which of the three fit rules the shop passes, with the evidence for each |

## Before you dial

- Read the shop's own site and their booking flow first — the
  [first-call script](first-call-script.md) opens with something specific about *their* operation,
  and that only works if you did the reading.
- Have the [one-pager](../stakeholders/design-partner-one-pager.md) and the insurer answers
  ([insurance.md](../stakeholders/insurance.md)) to hand; "does this affect my coverage?" arrives
  early.
- Have the demo shop open on your phone, but don't lead with it — call one is
  [discovery](first-call-script.md), and a demo answers a question nobody asked yet.
- Know what you can and cannot promise: the offer as written in
  [rollout.md](../rollout.md#the-offer-write-it-down-say-it-the-same-way-every-time), the price
  spoken from the live pricing page, and nothing improvised.
