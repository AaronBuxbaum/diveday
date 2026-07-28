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

- [x] **Fill-the-boat blast.** (Shipped) Last-minute fill promos: standby list, matching qualifying divers, emailed discount code (Stripe Coupon / PromotionCode) for booking checkout.
- [x] **Standby auto-promotion with a countdown.** (Shipped) Waitlist seat recovery with one-tap invite from the Today work queue.
- [x] **Buddy seat at confirmation.** (Shipped) Post-trip recap page contains a "bring a buddy" nudge.
- [x] **Occupancy pulse for the owner.** (Shipped) Owner month reports at `/shop/[shopSlug]/reports` detailing revenue, bookings, seat fill, and waiver completion.

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

- [x] **The night-before brief.** (Shipped) Email/SMS sent evening before departure with plain-language weather and logistics.
- **First-timer track.** Segment the prepare arc by experience: a diver whose last logged cert is fresh gets extra "what happens on the boat" reassurance, a gear-fit explainer, and softer copy. Same data, different voice. *(S–M, bookings/certs — diver-confidence↑.)*
- [x] **Post-trip recap page.** (Shipped) Automated `/recap/[token]` page with sites dived, conditions, crew shout-out, customer-moderated photos, and buddy/review/tipping links.

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

- [x] **Review router.** (Shipped) Recap page renders a link to the shop's review URL (configured in settings).
- **Buddy referral credit.** "Your buddy dived because of you — here's $20 off your next trip." Needs the credit ledger; keep the mechanics dead simple, no points program. *(M, bookings — revenue↑; after B's ledger.)*

## G. Deflect the phone — the AI front desk

- [x] **Anomaly nudges for staff.** (Shipped) Today work queue surfaces ranked week of jobs (missing waivers, unverified certs, unstaffed sessions, undercapacity filled promos, failed emails).
- **Diver-facing Q&A grounded in real state.** "Can I dive the wreck Saturday with an Open Water cert?" answered from the same schedule + readiness logic the staff app uses. *(L, cross-cutting, big bet.)*

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
