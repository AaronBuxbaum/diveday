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
- **Verified certification** — a card is evidence, not clearance. DiveDay records it as pending
  until staff certify it — staff look the card number up with the issuing agency (in the agency's
  own portal, outside DiveDay) and click **Mark certified**. There is no automated agency
  integration. Only a certified, unexpired card at or above a trip’s required level can satisfy
  readiness. (The staff surface says "certified"; the stored status value is `verified`, which is
  what readiness reads.)
- **Readiness** — the fail-closed answer to “can this diver board?” It lists human-readable
  blockers from the trip’s requirements and the diver’s waiver/cert evidence. Unknown,
  unconfigured, pending, expired, or insufficient evidence is never “ready.”
- **Levels** (recreational ladder, roughly): **Open Water (OW)** → **Advanced Open Water
  (AOW)** → **Rescue** → **Divemaster (DM)** → **Instructor**. Names vary slightly by agency.
- **PADI Scuba Diver** — a real certification one rung *below* Open Water: limited to 12 m and
  required to dive under the direct supervision of a PADI Professional. DiveDay's ladder has no rung
  for it, so any course whose agency floor is Scuba Diver (ReActivate, for one) is gated at Open
  Water instead. That gate is the **shop's**, not the agency's, and diver-facing copy must say so.
- **Adventure Diver** — the PADI sub-level between Open Water and AOW, earned with three Adventure
  Dives. It is the agency's real prerequisite for Deep, Wreck, and Rescue. DiveDay's ladder cannot
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
  lives in `nitrox_certifications`) because it gates a **per-booking mix request**; a site or trip may
  *also* require a nitrox card to **board** (a nitrox charter), enforced as its own requirement flag
  — the same card, two independent gates (see Operations, below).
- **DSD (Discover Scuba Diving)** — a supervised *experience* for uncertified people. Not a
  cert. DSD participants have stricter ratios and depth limits and always dive with an
  instructor.
- **Refresher / ReActivate** — short course for certified divers returning after inactivity.

## Operations

- **Trip / charter** — a scheduled boat outing to one or more **dive sites**; commonly a
  "two-tank" (two dives with a **surface interval** between). Has capacity, staff, prep needs,
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
  course identity, the prerequisite card (certification and minimum age), and the fact that every
  course session needs an instructor and a signed waiver; the shop controls its two prices, its
  course page, and whether the course appears when scheduling. Hiding never rewrites existing
  sessions.
- **Course page** — the diver-facing page for one course: subhead, overview, photos, spec chips
  (duration, group size, minimum age, prerequisite), a day-by-day plan, what the fee covers, an
  FAQ, and the upcoming sessions it can be booked through. There is no separate draft/publish
  state: a course is either **active** or hidden, and that one switch gates both the session
  picker and the public web page (20260720-course-single-visibility-state).
- **Default course page** — every course arrives pre-filled with DiveDay's default page copy for that
  agency course (day plan, what the fee covers, the questions divers ask). It is a starting point,
  not a binding: the shop edits from there, and nothing reaches back to rewrite the shop's words.
  There is no separate import step and no course-page catalog — the default is simply already there.
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
- **Emergency contact** — a name *and* a reachable phone number the crew can call for a diver in
  an incident. It is captured from the diver (the waiver flow, and the `/ready` page), never
  invented, and it is **only "on file" when both the name and the phone are present** — a name with
  no number is unreachable when it matters, so it counts as missing on the manifest and in the
  Today nudge. It is never a boarding blocker: a missing contact is an administrative gap, not a
  fitness-to-dive gap, so it surfaces only as a low-priority, dock-settleable nudge on boats within
  three days.
- **Roll-call event** — an append-only record that a staff member marked one booking boarded,
  not boarded, or cleared, including the time and any note. Its newest event is the current state;
  older events remain evidence of what the crew recorded. **Cleared** is an undo: staff tapped the
  current status again to correct a mistake, and the diver returns to awaiting. It is stored as its
  own event so the correction stays in the audit trail rather than deleting history.
- **Roll-call checkpoint** — one independent head count: before departure or after a numbered dive.
  A two-tank charter has three checkpoints. Each checkpoint is re-verified against the bodies on the
  boat; a **boarded** result never carries into the next. The one deliberate exception is
  **not boarded**: once a diver is marked not boarded, later checkpoints default to not boarded
  (shown as "carried forward") until staff explicitly re-board them — a diver who left the boat is
  presumed still ashore rather than resetting to awaiting. The default is always flagged as carried,
  can never imply "present," and staff can override it at any checkpoint.
- **Offline manifest snapshot** — an explicit, time-stamped, encrypted device copy of the complete
  derived manifest and every checkpoint. It is safety evidence as saved, never an editable roster
  or a claim that server-side readiness has not changed. In the UI its freshness tiers surface as
  **Fresh copy** (saved within 15 minutes), **Aging copy** (within 4 hours), and **Stale copy**
  (older) — the user-facing words for the current/aging/stale thresholds; "snapshot" itself never
  appears in user copy.
- **Reconciliation** — applying a device roll-call event to the live append-only history after
  reconnecting. The server rechecks staff, tenant, booking, checkpoint, and current readiness;
  duplicate events are idempotent and an older device event cannot replace newer live history.
- **Boarding** (the `check-in` surface) — the fast pre-departure pass: get every ready diver aboard
  before the boat leaves, waiver/cert/payment confirmed at a glance. It is the departure checkpoint of
  the **Manifest** viewed readiness-first — boarding a diver here is the same roll-call event — so it
  reads "Boarding" to avoid reading as a second, separate roster. Crew, emergency contacts, after-dive
  roll call, print, and the offline snapshot live on the Manifest. (The route stays `/check-in`.)
- **Waiver / release** — the single liability release a shop uses, typically with a **medical
  statement**. DiveDay keeps one versioned release per shop: editing it saves a new immutable version
  and new links snapshot the current one. The exact template version is snapshotted into each issued
  record; a signed record is immutable and a replacement link creates a new record. Some answers on the
  medical form require a physician sign-off — that's a blocking state, not a checkbox.
- **Sign once** — a diver signs the release once, not every trip. A **completed** signature is held
  against the diver (not just the booking it was signed on) and satisfies the waiver gate on any of
  their bookings while it stays **current**: signed against the shop's current release version and
  within a year of signing. A medical-review record never carries; a stale or old-version signature
  falls back to "send a fresh link." See [20260721-waiver-sign-once](../architecture/decisions/20260721-waiver-sign-once.md).
- **Paper / in-person signature** — a non-diver (staff) recording that a diver signed the release on
  paper — a copy on the boat or on shore — that the app never saw signed. It creates the same
  immutable completed record, marked as staff-attested and stamped with the staff member who recorded
  it, and carries forward like any other signature. The app captures **no medical questionnaire** for
  these records, so recording one requires an explicit staff attestation that the paper medical form
  was reviewed and no answer needs physician sign-off. A flagged medical must instead go through the
  diver-facing link, which captures the questionnaire and routes to review — the medical block is
  never a checkbox.
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
  The shop keeps its own Stripe dashboard, payouts, and tax reporting; DiveDay never holds the money
  and acts on the shop's behalf only through the `Stripe-Account` header the OAuth grant enables.
  See [20260719-stripe-connect-orders](../architecture/decisions/20260719-stripe-connect-orders.md).
- **Order** — a shop-issued bill for a customer: one or more line items (a trip fee, course fee,
  rental, nitrox, deposit, or free-form charge) against a person, optionally tied to a booking. Local
  status (`open`/`paid`/`void`/`uncollectible`/`refunded`) mirrors the Stripe invoice backing it. A trip's
  optional per-diver price pre-fills the trip-fee line item when an order is started from a
  booking's roster row — staff can still edit the amount or add more line items before sending.
- **Invoice** — the payable Stripe document behind an order, created on the shop's connected
  account. Staff can share its hosted link directly, or let Stripe email the customer; a webhook
  (or manual refresh) brings the paid/void result back into the order and, when the order is linked
  to a booking, into that booking's payment gate the same way a staff mark does. A paid invoice can
  be fully refunded from the diver's payment workspace when Stripe exposes its payment intent.
- **Booking checkout** — the pay-at-booking path: right after a public booking (or party) commits,
  the diver is handed one hosted Stripe Checkout session on the shop's connected account for the
  per-diver price × party size. Paid state comes only from Stripe's webhook or a direct API read —
  never from the return URL — and cascades into the booking's payment gate like any other payment.
  An abandoned checkout costs nothing: the booking simply stays unpaid, exactly as if the shop had
  no checkout. See [20260721-checkout-at-booking](../architecture/decisions/20260721-checkout-at-booking.md).
- **Deposit** — an optional per-diver amount (`trips.deposit_cents`) a shop may take at booking
  checkout instead of the full fare. Charged now and labelled a deposit on the Stripe page; the
  booking becomes **deposit paid** (which clears the readiness payment gate) with the balance still
  owed and collected later by a staff order or a full checkout. Off by default; only ever a *partial*
  of the fare (a value at or above the price charges full). DiveDay ships no default amount — the
  value is the shop's commercial term. See
  [20260721-deposit-cancellation-policy](../architecture/decisions/20260721-deposit-cancellation-policy.md).
- **Cancellation window** — an optional count of hours before departure (`trips.cancellation_window_hours`)
  during which a diver may cancel for a refund. Shown to divers at booking and on the confirmation
  ("Free cancellation until …") and to staff as a "refund-eligible until" cue on paid seats. Off by
  default; DiveDay ships no default window. Cancelling a paid seat inside it triggers an **automated
  cancellation refund**.
- **Automated cancellation refund** — when a paid booking is cancelled *inside* the shop's stated
  cancellation window, its Stripe payment is refunded automatically through the shop's own connected
  account and the booking settles to `refunded`. Money moves only on a confirmed Stripe reversal; a
  counter/cash payment, a disconnected account, a past-deadline (forfeit) cancel, or a Stripe failure
  degrade to a staff-run refund surfaced in the trip notice. No stated window means no automation.
  See [20260721-automated-cancellation-refund](../architecture/decisions/20260721-automated-cancellation-refund.md).
- **Reminder cadence** — a scheduled pre-trip nudge sent once per booking at a fixed lead time: a
  7-day and a 24-hour reminder, each its own `notification_kind` so it is deduped like any other
  send. The rule for which reminder is due (`src/lib/reminders.ts`) partitions the run-up to
  departure into buckets, so a late booking gets only the accurate reminder, never a stale one. An
  external scheduler drives an idempotent cron endpoint; the app holds no timer. See
  [20260721-scheduled-reminder-cadence](../architecture/decisions/20260721-scheduled-reminder-cadence.md).
- **SMS / WhatsApp channel** — an optional text channel for notifications, delivered through a
  fetch-based Twilio seam (`notifySms()`). A number is texted only if it is already E.164, and a
  channel with no configured sender degrades to `not_configured`, exactly like the email seam. Used
  today as a courtesy channel alongside reminder email. See
  [20260721-sms-whatsapp-notifications](../architecture/decisions/20260721-sms-whatsapp-notifications.md).
- **Demo mode** — a shop flagged `isDemo` gets the Demo Playground banner, its role switcher, and a
  "Reset demo data" affordance scoped to that one tenant. `isDemo` is reserved for the canonical
  seeded example shop (Blue Mantis), bootstrapped in every environment and reached via "Try the live
  demo". Onboarding a **trial** at `/onboard` creates a real shop that is *not* demo mode; the "Seed
  with demo data" checkbox only preloads sample trips, and a trial never shows the playground banner
  or a destructive reset (ADR 20260718-dynamic-demo-onboarding, revised by
  20260720-trial-shops-are-not-demo).

## Rental fit and prep

- **Rental set** — typically: **BCD** (jacket, sized), **regulator** ("reg", with octopus and
  SPG), **wetsuit** (sized, thickness in mm) with **boots**, mask/fins, **weights**, and a
  **tank/cylinder** (e.g. AL80 aluminum 80 cu ft). Some shops also rent a **dive computer** or a
  **GoPro** — optional add-ons, off by default.
- **Rental catalog** — the shop-level list of gear a shop actually rents (`shops.rental_items`,
  `src/lib/rentals.ts`). It gates the rental-fit forms: a diver is only offered — and only sees size
  fields for — gear the shop stocks, so a shop that doesn't rent GoPros never offers one. Defaults to
  the core kit; add-ons are opt-in in shop settings. Editing the catalog changes what is offered going
  forward; it does not rewrite a fit a diver already recorded.
- **Rental fit** — a shop-scoped diver's reusable record of *which* pieces they take from the shop
  and in *what size* (BCD, wetsuit, boot, fin, usual weighting, plus the dive-computer/GoPro add-ons).
  It is a storage concept: DiveDay tracks no equipment inventory, so a fit never reserves an item, is
  never evidence, and never replaces a dock-side fit check. It is the single input to the trip prep
  list.
- **Sizing** — BCDs and wetsuits are sized (XS–XXL and height/weight dependent), so a prep list
  groups by item *and* size; an unrecorded size is shown as a loose end, not silently dropped.
- **Trip prep list** — the derived packing list for one departure: tanks (one per diver per planned
  dive, split air/nitrox) plus rental kit grouped by item and size, with the divers each line is
  for. Purely derived — nothing on it is an allocation. Rules in `src/lib/dive-prep.ts`.
- **Diver profile** — the shop's person-first operational record. A diver profile gathers contact
  details, certification evidence, rental fit, and bookings; cards are not managed as an unrelated
  certification inbox.
- **Nitrox / EANx** — enriched-air breathing gas with a higher oxygen fraction than air
  (recreationally 22–40% O₂). DiveDay models the **nitrox specialty card** separately from the
  recreational ladder (it is a yes/no gate, not a rung): captured pending, then verified.
- **Nitrox request** — a per-booking ask for enriched air, billed per dive. Writing it on requires
  a **verified** nitrox card at write time; clearing it is always allowed. Because a card can be
  rejected after the fact, every read (prep list, manifest, Today) re-checks the card and
  downgrades the diver to air rather than trusting the flag.

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
  not in this set — it gates the per-booking mix request, not a site.
- Bookings, waivers, certs, rental fit, and manifests all hang off the same trip/session spine —
  the manifest is a *view* of checked-in bookings plus staff, not a separate data entry task.
