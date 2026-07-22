# Brainstorm 6 — First principles: the business of a dive shop

**Lens:** forget the feature list and rebuild from what a dive shop *is*. A dive shop sells a
perishable promise: "be at the dock at 7 and we'll take you underwater, safely." Everything the
software does is either protecting that promise or monetizing it. The other five brainstorm lenses
look at surfaces and users; this one looks at the physics of the business and asks what software
those physics demand.

The five first principles, and what each implies:

1. **A boat seat is perishable inventory.** An empty seat at departure is worth $0 forever — worse
   than a hotel room, because the boat sails on schedule regardless. Filling seats late is pure
   margin.
2. **Weather is the uncontrollable variable.** Blow-out days are certain; only their dates are
   unknown. The shop that recovers a cancelled day's revenue fastest wins the season.
3. **The diver is excited *and* scared.** Diving is a peak-experience purchase with real perceived
   risk. Every touchpoint either converts anxiety into confidence or lets it curdle into a
   cancellation.
4. **Word of mouth is the growth engine.** Shops live and die on reviews and buddy referrals, not
   ads. The 24 hours after a great dive are the highest-leverage marketing window the shop has, and
   today it's completely unused.
5. **Staff time is the scarcest input.** The front desk's day is consumed answering the same
   questions and chasing the same paperwork. Every deflected phone call is capacity for another
   booking.

## Quality metrics

Every idea below is graded on the north star axes from [next-steps](../next-steps.md) — **staff
work ↓**, **diver confidence ↑**, **safer departure** — plus two business axes this lens adds:

- **revenue ↑** — does it fill seats, protect a cancelled day, raise order size, or win a deal?
- **moat** — is this hard for DiveAdmin/DiveShop360 to copy without rearchitecting? (Anything that
  composes with the readiness model is a moat; anything that's a standalone widget is not.)

Tags stay in house format: *(Effort, pillar, bet size — grades)*.

---

## A. Perishable-seat economics — the empty seat is money burned

- **Fill-the-boat blast.** One button on an under-full departure texts/emails past divers who are
  *already qualified for it* — cert level, waiver freshness, and site requirements filtered through
  the existing readiness logic, so every recipient can book in one tap without a single staff
  check. No competitor can do this because none of them know who's qualified. *(M, bookings, big
  bet — staff-work↓, revenue↑↑, moat: readiness-composed.)*
- **Standby auto-promotion with a countdown.** When a seat opens, the waitlist head gets an offer
  that expires in N hours and cascades to the next diver — no front-desk phone tag. Builds on the
  existing waitlist tables. *(S–M, bookings, quick win — staff-work↓, revenue↑.)*
- **Buddy seat at confirmation.** The confirmation page's one upsell: "The boat has room — bring a
  buddy." A share link pre-fills the trip so the buddy books in under a minute. Diving is a buddy
  sport; the product should act like it. *(S, bookings, quick win — revenue↑, diver-confidence↑.)*
- **Occupancy pulse for the owner.** Which departures chronically sail light, which sell out and
  turn divers away — one calm weekly view that suggests schedule moves, not a BI console. *(M,
  cross-cutting — revenue↑; park until reporting spine exists.)*

## B. Weather recovery — the blow-out day playbook

- **One-tap cancellation cascade.** Captain calls the blow-out; staff taps once; every booked diver
  instantly gets a message with (a) rebooking links filtered to trips their cert already qualifies
  them for and (b) a trip-credit option ahead of the refund option. Refunds leak revenue; credits
  and instant rebooking keep the season's cash in the shop. Today this day costs the front desk
  hours of calls. *(M, bookings, big bet — staff-work↓↓, revenue↑↑, diver-confidence↑.)*
- **Alternative-day salvage.** The cancellation message can offer what the shop *can* still run —
  pool session, shore dive, course classroom day — turning a $0 day into a partial day. *(M,
  bookings — revenue↑; needs the cascade first.)*
- **Credit ledger.** Trip credit as a first-class balance on the diver, visible at booking, spent
  automatically. Prerequisite for the two above; keep it boring and auditable. *(M, bookings —
  revenue↑; schema change + ADR.)*

## C. The anxiety-to-confidence arc — sell certainty, not trips

- **The night-before brief.** One message, evening before departure: forecast in plain language
  (marine-forecast exists), what to bring, where to park, when to arrive, who to text. This is the
  single cheapest cancellation-prevention tool that exists — most day-of no-shows are anxiety plus
  logistics confusion. *(S–M, bookings, quick win — diver-confidence↑↑, staff-work↓.)*
- **First-timer track.** Segment the prepare arc by experience: a diver whose last logged cert is
  fresh gets extra "what happens on the boat" reassurance, a gear-fit explainer, and softer copy.
  Same data, different voice. *(S–M, bookings/certs — diver-confidence↑.)*
- **Post-trip recap page.** Within hours of return: sites dived, conditions, the crew's one-line
  shout-out, a photo slot — one beautiful shareable page per diver per trip. Not a dive-log social
  network (non-goal holds): a single artifact, generated once, owned by the shop's brand. This is
  the word-of-mouth window, weaponized. *(M, manifests/cross-cutting, big bet — revenue↑,
  diver-confidence↑, moat: manifest data makes it automatic.)*

## D. Whales — groups, clubs, and courses buy 12 seats at a time

- **Group organizer surface.** One organizer holds N seats; invitees claim their own seat, sign
  their own waiver, upload their own cert, pay their own share; the organizer watches a readiness
  board instead of herding a WhatsApp thread. Dive clubs run on spreadsheets today and they are the
  highest-ARPU booking that exists. The readiness model already understands per-diver state — this
  is a surface, not a new spine. *(L, bookings/waivers/certs, big bet — revenue↑↑, staff-work↓↓,
  moat: readiness-composed.)*
- **Course cohorts as groups.** The same claim-your-seat mechanics cover a class of students —
  course pages exist; the cohort roster with per-student readiness is the missing limb. *(M,
  bookings/certs — staff-work↓, safer-departure.)*
- **Private charter inquiry → quote → booking.** A lightweight structured flow beats the email
  ping-pong these deals live in now. *(M, bookings — revenue↑; park until groups exist.)*

## E. Trust as a sellable asset — make safety visible, then market it

- **The safety record page.** "2,314 divers boarded · 100% pre-departure roll call · every diver
  cert-verified" — computed from real manifest/roll-call data, embeddable on the shop's site.
  Shops compete for nervous first-timers; let ours prove diligence instead of asserting it. Fail
  honest: the numbers are whatever the data says. *(S–M, manifests, quick win — revenue↑,
  diver-confidence↑, moat: only real ops data can generate it.)*
- **Incident-ready export.** One tap produces the manifest + roll-call timeline + cert evidence
  for a given departure as a signed PDF for authorities and insurers. The nightmare-day feature
  nobody markets and every owner quietly shops for. *(S, manifests — safer-departure,
  diver-confidence↑; dive-domain-expert review required.)*
- **Insurance leverage.** Longer term: documented 100% roll-call compliance is an argument in a
  shop's liability-premium negotiation. Product's job is only to make the record exportable —
  see incident-ready export. *(No build; a marketing claim once exports exist.)*

## F. The review flywheel — route the emotion while it's hot

- **Review router.** Post-trip message asks one question: how was it? Delighted → deep link
  straight into the shop's Google review flow; anything less → a private note to the owner first.
  Local search ranking is the #1 discovery channel for dive shops; this is the cheapest revenue
  lever in the entire document. *(S, cross-cutting, quick win — revenue↑↑.)*
- **Buddy referral credit.** "Your buddy dived because of you — here's $20 off your next trip."
  Needs the credit ledger; keep the mechanics dead simple, no points program. *(M, bookings —
  revenue↑; after B's ledger.)*

## G. Deflect the phone — the AI front desk

- **Anomaly nudges for staff.** The app watches what staff can't: "Saturday is 40% booked and the
  forecast is perfect — send the fill-the-boat blast?" / "Two divers on tomorrow's manifest still
  have unsigned waivers." Suggestions, never actions; staff stay the authority. *(M, cross-cutting
  — staff-work↓, revenue↑.)*
- **Diver-facing Q&A grounded in real state.** "Can I dive the wreck Saturday with an Open Water
  cert?" answered from the same schedule + readiness logic the staff app uses — not a chatbot with
  a FAQ, an interface to the actual domain model. Phone-call deflection is the point; wrong answers
  are worse than none, so it only speaks where the domain model is authoritative and hands off to
  a human everywhere else. *(L, cross-cutting, big bet — staff-work↓↓, moat: agent-native codebase
  makes this cheap for us and a rewrite for them.)*

---

## What NOT to do

- **Surge pricing.** Dive shops are small-community trust businesses; algorithmic price hikes on a
  good-weather Saturday poison word of mouth for a season. Fill seats with outreach, not price.
- **Overbooking against forecast no-shows.** Airlines can bump; a boat that bumps a certified,
  paid-up diver at the dock destroys the trust thesis. Never.
- **A points/loyalty program.** Gimmick gravity. Trip credit and buddy referrals cover the honest
  80% with none of the liability accounting.
- **Discounting as the default fill lever.** The fill-the-boat blast offers *access* (a seat that
  wasn't available), not a markdown. Train divers to wait for discounts and margins never recover.
- **A dive-log social network.** Non-goal holds. The post-trip recap is one artifact, not a feed.

## Highest business-value-per-effort (if picking today)

1. **Review router** — S, quick win, the cheapest revenue lever here.
2. **Night-before brief** — S–M, quick win, cancellation prevention + the confidence arc.
3. **Standby auto-promotion** — S–M, quick win on existing waitlist plumbing.
4. **Fill-the-boat blast** — M, big bet, the first feature only a readiness-model product can ship.
5. **One-tap weather cancellation cascade** — M, big bet, wins every shop that's lived a blow-out
   Saturday (all of them).
6. **Group organizer surface** — L, big bet, the highest-ARPU booking in the industry has no good
   software anywhere.
