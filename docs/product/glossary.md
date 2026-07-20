# Dive-domain glossary

Domain terms agents must use correctly — in code, UI copy, and data models. When you introduce a
new domain concept, define it here in the same PR.

## Certification

- **Agency** — organization that trains and certifies divers. Major ones: **PADI**, **SSI**,
  **NAUI**, **SDI/TDI**, **RAID**, **CMAS**, **GUE**. A diver's card is agency-specific but
  levels are broadly equivalent across agencies.
- **C-card** — the certification card (physical or digital) a diver presents as proof. Has an
  agency, a level, a cert/diver number, and an issue date. Cards **do not expire**, but shops
  may require a refresher after long inactivity.
- **Verified certification** — a card is evidence, not clearance. Scuba records it as pending
  until staff verify it; only a verified, unexpired card at or above a trip’s required level can
  satisfy readiness.
- **Readiness** — the fail-closed answer to “can this diver board?” It lists human-readable
  blockers from the trip’s requirements and the diver’s waiver/cert evidence. Unknown,
  unconfigured, pending, expired, or insufficient evidence is never “ready.”
- **Levels** (recreational ladder, roughly): **Open Water (OW)** → **Advanced Open Water
  (AOW)** → **Rescue** → **Divemaster (DM)** → **Instructor**. Names vary slightly by agency.
- **PADI Scuba Diver** — a real certification one rung *below* Open Water: limited to 12 m and
  required to dive under the direct supervision of a PADI Professional. Scuba's ladder has no rung
  for it, so any course whose agency floor is Scuba Diver (ReActivate, for one) is gated at Open
  Water instead. That gate is the **shop's**, not the agency's, and diver-facing copy must say so.
- **Adventure Diver** — the PADI sub-level between Open Water and AOW, earned with three Adventure
  Dives. It is the agency's real prerequisite for Deep, Wreck, and Rescue. Scuba's ladder cannot
  record it, so those courses are gated at AOW — again a **shop-set** gate, and a valid Adventure
  Diver deserves to be told the difference is ours and invited to ask.
- **Junior certification** — the age-linked form of a level for divers under 15: **Junior Open
  Water**, **Junior Advanced Open Water**, **Junior Night Diver**, and so on. Same card, extra
  restrictions — 10–11-year-olds are limited to 12 m and must dive with a PADI Professional or a
  certified parent/guardian; 12–14-year-olds reach 18 m (21 m on an AOW deep dive) with any
  certified adult. The restrictions lift at 15. They drive dock-side decisions, so course copy and
  staff surfaces state them rather than implying the adult limits.
- **Specialties** — standalone certs gating specific activities: **Deep** (beyond 18 m/60 ft for
  OW divers), **Night**, **Wreck**, **Drysuit** gate a **site/activity** and live in
  `specialty_certifications`. **Nitrox/EANx** (enriched air) is modeled separately (its evidence
  lives in `nitrox_certifications`) because it gates a **tank at fill time**; a site or trip may
  *also* require a nitrox card to **board** (a nitrox charter), enforced as its own requirement flag
  — the same card, two independent gates (see Operations, below).
- **DSD (Discover Scuba Diving)** — a supervised *experience* for uncertified people. Not a
  cert. DSD participants have stricter ratios and depth limits and always dive with an
  instructor.
- **Refresher / ReActivate** — short course for certified divers returning after inactivity.

## Operations

- **Trip / charter** — a scheduled boat outing to one or more **dive sites**; commonly a
  "two-tank" (two dives with a **surface interval** between). Has capacity, staff, gear needs,
  and minimum cert requirements per site (e.g. AOW for a deep wreck).
- **Trip series** — a repeating charter ("every Saturday two-tank") scheduled in one action. The
  series records only the cadence; each date is materialized as its own independent **trip** that
  starts identical to the rest and is booked, crewed, edited, or cancelled on its own. See
  [20260719-recurring-trip-series](../architecture/decisions/20260719-recurring-trip-series.md).
- **Wait list** — a first-come record of divers interested in a full trip. It is not a booking,
  does not consume capacity, and never appears on a manifest; staff follow up if space opens.
- **Dive-site briefing** — a reusable, shop-owned description of one dive location: its map or
  route imagery, point-of-interest landmarks, visual field guide, and local context. A trip can
  attach one briefing to each of up to four ordered dives; a blank dive is still a valid part of a
  two-tank plan when the crew has not chosen the final site. Dated conditions remain on the trip,
  not the reusable site.
- **Predicted conditions** — crew-entered expectations for one dated charter, such as water
  temperature, visibility, and surface state. It is a briefing rather than a live guarantee;
  the crew makes the final go/no-go call.
- **Automated marine outlook** — a provider-generated, date-specific planning fallback shown only
  in the ten days before a charter when no crew prediction exists. It states its source and valid
  time, never makes a go/no-go call, and yields completely to a crew prediction. The first slice
  supplies water temperature and surface state; underwater visibility remains a crew observation.
- **Course session** — a scheduled class (pool or open water) tied to a course, an instructor,
  and enrolled students. Instructor-to-student **ratios** are agency-mandated and vary by
  course and environment.
- **Course catalog copy** — a shop's configurable copy of the PADI/SSI course list. The agency owns
  course identity, the prerequisite card, and the fact that every course session needs an
  instructor and a signed waiver; the shop controls its description, its two prices, its course
  page, and whether the course appears when scheduling. Hiding never rewrites existing sessions.
- **Course page** — the diver-facing page for one course: subhead, overview, photos, spec chips
  (duration, group size, minimum age, prerequisite), a day-by-day plan, what the fee covers, an
  FAQ, and the upcoming sessions it can be booked through. Published separately from being
  **active**: active gates the session picker, **published** gates the public web page, and a shop
  routinely has one without the other.
- **Course page template** — a Scuba-published, versioned starting point for a course page. A shop
  imports a copy and edits it; a later template version never rewrites what the shop wrote, and
  never changes the prerequisite card under a course the shop already teaches.
- **Prerequisite note** — shop prose beside a course's certification gate ("comfortable swimming
  200 m", "bring your logbook"). It adds to the gate and never substitutes for it: the card the desk
  checks is `minimum_certification_level`, which the agency owns and no shop edit can reach. The
  course page labels the two apart for exactly this reason — a note reading "or a qualifying
  certification" next to an unlabelled gate is how a diver arrives believing they are eligible.
- **Instruction fee / e-learning fee** — a course invoices as two lines on one bill, and the diver
  makes a single payment for their sum. Enrollment assumes the e-learning is included; a student
  who already completed it elsewhere has that line cleared before the invoice goes out, or
  refunded after. Keeping them separate on the order is what makes either one adjustable without
  re-working the total by hand.
- **Manifest** — the authoritative list of every person on a boat (divers, students, staff,
  crew), with emergency contacts. A legal/safety document — in US waters, coast guard
  regulations apply. **Roll call** happens before departure and *after every dive*; a diver
  left behind is the industry's nightmare scenario. Manifests must work offline and print
  cleanly.
- **Roll-call event** — an append-only record that a staff member marked one booking boarded or
  not boarded, including the time and any note. Its newest event is the current state; older events
  remain evidence of what the crew recorded.
- **Roll-call checkpoint** — one independent head count: before departure or after a numbered dive.
  A two-tank charter has three checkpoints. A diver's state at one checkpoint never silently carries
  into the next.
- **Offline manifest snapshot** — an explicit, time-stamped, encrypted device copy of the complete
  derived manifest and every checkpoint. It is safety evidence as saved, never an editable roster
  or a claim that server-side readiness has not changed.
- **Reconciliation** — applying a device roll-call event to the live append-only history after
  reconnecting. The server rechecks staff, tenant, booking, checkpoint, and current readiness;
  duplicate events are idempotent and an older device event cannot replace newer live history.
- **Check-in** — the front-desk step where waiver, cert, and gear are confirmed before a diver
  boards. The app's job is making "ready to board" a single glance.
- **Waiver / release** — liability release signed per shop (sometimes per activity), typically
  with a **medical statement**. Scuba snapshots the exact template version into each issued record;
  a signed record is immutable and a replacement link creates a new record. Some answers on the
  medical form require a physician sign-off — that's a blocking state, not a checkbox.
- **Medical questionnaire** — the versioned diver-medical form a waiver presents, selected by the
  shop's **jurisdiction** (RSTC/WRSTC by default, or a UK variant). Defined as data in
  `src/lib/medical.ts`; a completed waiver stores the questionnaire id + version it was answered
  against, so a later edit never re-interprets signed evidence. Any **referral**-flagged "yes"
  triggers physician review, and unknown questionnaires/questions **fail closed** (review
  required), never waved through.
- **Waiver activity** — the staff-facing chronological explanation of stored waiver evidence:
  a link was issued, a diver started, signed, needs medical review, or had a pending link replaced.
  It is derived from timestamps on the evidence records and never exposes the raw completion token.
- **Transactional notification** — a single-recipient operational message such as a booking
  confirmation or a staff-issued waiver link. Delivery is helpful but never changes the booking or
  waiver evidence; a delivery failure must not undo the underlying operation.
- **Notification delivery status** — the latest known send result for one booking and notification
  purpose. It lets staff see an unresolved email issue; it is not proof of inbox delivery or a full
  provider event history.
- **DAN** — Divers Alert Network; dive accident insurance divers may carry. Worth a field, not
  a feature.
- **Connected Stripe account** — a shop's own Standard Stripe account, authorized once via OAuth.
  The shop keeps its own Stripe dashboard, payouts, and tax reporting; Scuba never holds the money
  and acts on the shop's behalf only through the `Stripe-Account` header the OAuth grant enables.
  See [20260719-stripe-connect-orders](../architecture/decisions/20260719-stripe-connect-orders.md).
- **Order** — a shop-issued bill for a customer: one or more line items (a trip fee, course fee,
  rental gear, deposit, or free-form charge) against a person, optionally tied to a booking. Local
  status (`open`/`paid`/`void`/`uncollectible`/`refunded`) mirrors the Stripe invoice backing it. A trip's
  optional per-diver price pre-fills the trip-fee line item when an order is started from a
  booking's roster row — staff can still edit the amount or add more line items before sending.
- **Invoice** — the payable Stripe document behind an order, created on the shop's connected
  account. Staff can share its hosted link directly, or let Stripe email the customer; a webhook
  (or manual refresh) brings the paid/void result back into the order and, when the order is linked
  to a booking, into that booking's payment gate the same way a staff mark does. A paid invoice can
  be fully refunded from the diver's payment workspace when Stripe exposes its payment intent.
- **Demo mode** — a shop flagged `isDemo` gets the Demo Playground banner, its role switcher, and a
  "Reset demo data" affordance scoped to that one tenant. `isDemo` is reserved for the canonical
  seeded example shop (Blue Mantis), bootstrapped in every environment and reached via "Try the live
  demo". Onboarding a **trial** at `/onboard` creates a real shop that is *not* demo mode; the "Seed
  with demo data" checkbox only preloads sample trips, and a trial never shows the playground banner
  or a destructive reset (ADR 20260718-dynamic-demo-onboarding, revised by
  20260720-trial-shops-are-not-demo).

## Gear

- **Rental set** — typically: **BCD** (jacket, sized), **regulator** ("reg", with octopus and
  SPG), **wetsuit** (sized, thickness in mm), mask/fins/boots, **weights**, **tank/cylinder**
  (e.g. AL80 aluminum 80 cu ft), optionally a **dive computer**.
- **Sizing** — BCDs and wetsuits are sized (XS–XXL and height/weight dependent); assignment
  must respect size, not just availability.
- **Service history** — regulators and BCDs require periodic service (annual or by dive
  count); tanks require periodic **visual inspection (VIP)** and **hydrostatic testing**.
  Out-of-service gear must be un-assignable.
- **Service event** — a completed, shop-scoped record of work on one item: when it was done,
  who logged it, what changed, and optionally when it is due next. A service hold blocks checkout;
  a service event is the auditable evidence that may return an item to the packing pool.
- **Gear assignment** — one currently checked-out item reserved for one booking. Assignment is
  not a note: it is the conflict-safe operational record that prevents the same regulator or BCD
  being packed for two divers at once.
- **Rental size profile** — a shop-scoped diver’s reusable BCD, wetsuit, boot, fin, and usual
  weighting details. It pre-fills a new booking’s request and can guide packing, but never
  reserves inventory or replaces a dock-side fit check.
- **Diver profile** — the shop's person-first operational record. A diver profile gathers contact
  details, certification evidence, rental fit, bookings, and issued gear; cards are not managed as
  an unrelated certification inbox.
- **Retired gear** — equipment permanently removed from the rental pool. It is distinct from a
  service hold and cannot be assigned or retired while checked out to a diver.
- **Nitrox / EANx** — enriched-air breathing gas with a higher oxygen fraction than air
  (recreationally 22–40% O₂). Scuba models the **nitrox specialty card** separately from the
  recreational ladder (it is a yes/no gate, not a rung): captured pending, then verified.
- **Nitrox fill** — a logged enriched-air fill for a diver's tank. The diver **O₂-analyzes** the
  tank and signs for it; the fill records the mix %, the ppO₂ ceiling, and the derived MOD. Only a
  diver with a **verified** nitrox card may be given an EANx fill — the gate is enforced at write
  time, not just in the UI.
- **MOD (maximum operating depth)** — the deepest a mix may be breathed before oxygen toxicity
  risk, `MOD = 10·(ppO₂/FO₂ − 1)` metres. Derived from the analyzed mix and a ppO₂ ceiling
  (1.4 bar working, 1.6 bar contingency), never entered by hand.

## Modeling notes

- A **person** may be simultaneously a customer, a student, and staff — model roles, not
  separate person types.
- Cert requirements attach to **sites/activities** ("this wreck requires AOW + Deep"), and are
  checked against a diver's **verified** cards at booking *and* at check-in. A dive site carries an
  inherent gate (minimum level + required specialties); a trip carries its own; the readiness
  service composes them — the **stricter** minimum level and the **union** of specialties
  ([20260718-specialty-site-cert-requirements](../architecture/decisions/20260718-specialty-site-cert-requirements.md)).
- **Level vs. specialty** — a **level** (OW→Instructor) is a rank; a **specialty** (Deep, Wreck,
  Night, Drysuit) is a distinct yes/no gate. Levels live in `certifications`; specialties live in
  `specialty_certifications`, both captured pending and usable only once verified. **Nitrox** is
  not in this set — it is gated per tank at fill time, not per site.
- Bookings, waivers, certs, gear, and manifests all hang off the same trip/session spine —
  the manifest is a *view* of checked-in bookings plus staff, not a separate data entry task.
