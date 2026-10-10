# Rental fit and prep

- **Demand signal** — a staff-only capacity-planning prompt shown when a trip is full and its wait
  list reaches the larger of two divers or 25% of the trip's capacity. It suggests another boat or
  departure; it never creates or changes a trip automatically.
- **Private staff note** — operational context attached to a diver's booking, visible only on
  authenticated staff surfaces. It is never included in diver readiness, waiver, recap, public
  schedule, manifest export, or notifications.
- **Activity event** — an append-only staff-facing sentence describing who did operational work and
  what happened (for example, “Maya added a private note about Dana”), with the time it happened.
  Activity uses shop language, never table names or record identifiers.
- **Activity log** — the shop-wide, owner-facing reading of who did what, to what, and when
  (D5): every activity event, every review publish or hide, and every meeting-point or conditions
  change a staffer made, newest first, filtered by person, kind (seats, departures, money, cards
  and identity, records, reviews) and date. It is a read model over those append-only trails
  (`src/db/shop-activity.ts`), not a trail of its own, and keeps nothing they do not: a line leaves
  the log when its row is pruned, and an erased diver's lines read `[redacted]` there as they do
  everywhere. Refunds, write-offs and the schedule builder's acts (add, repeat, move, copy, delete)
  record their actor for it. Owners and managers only (`canViewShopActivity`); reached from
  Settings' Data group at `/settings/activity`.

- **Rental set** — typically: **BCD** (jacket, sized), **regulator** ("reg", with octopus and
  SPG), **wetsuit** (sized, thickness in mm) with **boots**, mask/fins, **weights**, a **dive
  computer**, and a **tank/cylinder** (e.g. AL80 aluminum 80 cu ft). The dive computer is default-on
  for every diver **and** part of the priced core set (H-06, reconfirmed 2026-08-02 — HD-9). Six
  add-ons are off by default and priced separately: the **GoPro**, the **drysuit**, a **hood**,
  **gloves**, a **dive light** and an **SMB** (`RENTABLE_ITEMS`, `src/lib/rentals.ts`). A diver who skips a core
  piece (brings their own dive computer, say) is quoted whichever is cheaper — the set price or the
  sum of the pieces they actually take — so skipping one never costs more than the full set would
  have (`quoteRentalFit`, `src/lib/rentals.ts`).
- **Rental catalog** — the shop-level list of gear and services a shop actually offers
  (`shops.rental_items`, `src/lib/rentals.ts`). It gates the rental-fit forms: a diver is only
  offered — and only sees size fields for — gear the shop stocks, so a shop that doesn't rent
  GoPros never offers one. It also holds one non-gear entry, `"nitrox"` (`shopOffersNitrox`):
  whether the shop fills enriched air at all. Defaults to the five core items plus the dive
  computer (default-on); the GoPro and nitrox are opt-in — most shops don't fill nitrox, so a shop
  that hasn't ticked it never shows the nitrox request, its price field, or the packing list's
  nitrox tank count and blockers. Editing the catalog changes what is offered going forward; it
  does not rewrite a fit a diver already recorded, and **what the read side then does with a
  stored flag the catalog contradicts is the other half of that promise.** The piece *stays*,
  marked as something the shop no longer rents: dropping it silently would
  hide a fit nobody can fill, which is the same failure the writer refuses one layer up. It is
  marked on every surface that reads the fit, not only the trip prep list — the roll call, the
  offline manifest snapshot, the seat-a-diver list and the diver record's own fit summary all say
  it now (issue #1804), because two surfaces describing one departure differently is worse than
  either sentence. **A piece this booking already holds is not marked** (issue #1811, H-78): a
  live reservation of that kind on the gear register means a unit is on its peg with the diver's
  name against it, so the prep list and the manifest rail read it as an ordinary piece. The rule is
  one place, `rentalFitLine`/`buildDivePrepChecklist` handed the booking's held register kinds;
  mask & fins counts as held only when both units are, and a paid rental line with no unit behind
  it keeps the mark, because money taken is a refund conversation the mark starts. The offline snapshot freezes that fact with everything else it holds, so a shop
  that re-adds the piece after a snapshot is taken carries the old mark onto the boat until the
  next one. No *other* line changes with it: the weighting, the fin sizing and the drysuit-card
  advisory are not about the rental at all. They follow **Dives dry** below, which the catalog
  never touches, so a diver in a drysuit keeps "weight check in the water", fins sized over the
  boot and the card question whoever owns the suit (issue #1810). Completeness stops
  chasing that piece's size at the same time (**Complete rental fit** below), so the list neither
  nags for a size nobody can hand over nor pretends the piece was never asked for. The catalog is
  only **half** the nitrox answer — see **Nitrox-compatible course** below.
- **Nitrox-compatible course** — whether a shop will run a given course on enriched air
  (`courses.nitrox_compatible`, set on the course editor's *At a glance* box). It is the second of
  two gates on the enriched-air request: `nitroxAvailableOn` (`src/lib/rentals.ts`) offers the box
  only when the shop fills nitrox **and** this departure's course permits it, and every surface
  reads that one predicate — the booking page's gear picker, the pre-trip *ready* form, and the
  server actions behind both, so a hand-posted `nitrox=on` cannot slip past a hidden checkbox. A
  trip with **no course** is an ordinary charter and takes the shop's answer alone. Defaults true;
  the migration that added it backfilled **false** for a taster and for any course open to
  uncertified divers, because nobody enrolled on those holds the verified card a fill needs
  (**Nitrox/EANx** above) and their training dives are conducted on air — the box could only ever
  advertise a fill the course cannot give. It changes what is *offered*, never what a diver already
  requested, and it is not a fill authorization: a verified card still gates that.
- **Rental prices** — the shop's optional price list for rental gear (`shops.rental_pricing`,
  `src/lib/rentals.ts`): a **set price** for the full core kit of five hard-goods pieces (usually
  cheaper than the pieces), a **per-piece** price for any item, and a **per-dive nitrox** surcharge —
  all in minor units, all optional. A diver renting every core item the shop offers is quoted the
  set; a partial kit is quoted per piece; the dive-computer and GoPro add-ons and nitrox are always
  separate lines (so an own-computer diver keeps the set discount on the hard goods). A shop that
  doesn't stock a core item still reaches its set with the core it does offer. Prices are only a
  quote (`quoteRentalFit`) — never inventory or an allocation — and an unpriced item is settled at
  the shop rather than quoted at zero. A shop that prices nothing keeps the "ask the shop what's
  included" behaviour.
- **Rental fit** — a shop-scoped diver's reusable record of *which* pieces they take from the shop
  and in *what size* (BCD, wetsuit, drysuit, hood, gloves, boot, fin, usual weighting, plus the
  dive-computer, GoPro, dive-light and SMB add-ons). A **hood** and **gloves** are two kinds, each
  with a free-text size (H-102), each racked by size and thickness ("M, 5 mm", "L, 3 mm"). A
  drysuit diver's gloves are flagged on the packing line ("wet or dry gloves?").
  The **drysuit** is the one add-on that carries a size, and it is sized on its own scale — the
  manufacturer grid a rental wall is racked from (a girth letter, a trailing `T` for the tall cut),
  which shares the wetsuit's girth letters but carries a second axis the wetsuit scale has no room
  for. Which codes the diver's own select offers is open as H-76. **A stored size the diver's grid
  cannot spell is offered back to them as a selected option, and they can replace it** (issue
  #1728): a staffer typing `ML, rock boot 9` should know the diver will see those words on their own
  gear form. Before that the box painted blank over the stored value and the next save overwrote it,
  which was worse — but it does mean the free text is a shared field rather than a staff-only one.
  It contributes exactly **one**
  piece to the packing list and no boots of its own: most rental drysuits have their boots
  vulcanised on, so they come off the wall with the suit and there is nothing extra to pull. A fleet
  stocking neoprene-sock suits worn with separate rock boots writes that into the drysuit size
  itself ("ML, rock boot 9"), which is free text staff-side and reaches the packing list verbatim.
  The diver's shoe size still matters for fins over that boot, and the mask/fins question already
  asks it.
  Every size field holds **40 characters** and the usual-weighting note 120
  (`RENTAL_FIT_TEXT_LIMITS`, `src/lib/rentals.ts`) — one bound for all four writers, because the
  diver's own form re-submits whatever staff stored, so a tighter cap on the diver's side fails
  their save on a box they never typed in (issue #1728). That bound is product behaviour and not
  only form validation: the contact importer **drops** a longer size, with the original cell on
  the import report beside its row, rather than truncating it (issue #1754). A cut-off size is a
  plausible-looking wrong size that reaches the packing list verbatim and is acted on at the dock,
  while a size DiveDay does not hold is a gap completeness already chases and the diver's own form
  asks for again. It is the tightest constraint on the drysuit's second fact above: a fleet
  writing its rock-boot size into `drysuit_size` has 40 characters for both.
  A diver who **dives dry** with no **Drysuit** specialty on their record raises a roster advisory
  (`src/lib/drysuit-card.ts`) and nothing more: air in the suit expands on the way up and the
  specialty exists for exactly that, but a shop runs its own orientations, so this is a
  conversation before the first dive and never a boarding refusal (H-08's instrument, not readiness').
  It is a storage concept: a fit never reserves an item, is never evidence, and never replaces a
  dock-side fit check. It is the single input to the trip prep list. Reserving a particular unit is
  the **gear register**'s separate act (below) — a shop that keeps no register still has fits, and a
  fit alone still reserves nothing.
- **Dives dry** — the diver-level fact that this diver dives in a drysuit, whoever owns it
  (`rental_fit_profiles.dives_dry`, H-78, issue #1752). It is not a rental: most drysuit divers own
  their suit, and before this column a diver in their own drysuit looked exactly like a diver in
  their own wetsuit. Three readers key on it: the packing list's weights line, which says "weight
  check in the water" instead of the stated weighting because a drysuit's undergarments and trapped
  air change what a diver needs; the fins line, sized up over the drysuit boot; and the drysuit-card
  roster advisory. The rental flag (`rents_drysuit`) only answers "does a suit come off our wall".
  Every fit form asks the **suit** as one choice of four — own wetsuit (or none), rented
  wetsuit, own drysuit, rented drysuit — so a diver can never record two suits, and the database
  holds the same rule: a rented drysuit implies dives dry, and a diver who dives dry rents no
  wetsuit (two checks on `rental_fit_profiles`). `saveRentalFit` settles a post that names both
  suits for the drysuit, the conservative answer for weighting; a post that says nothing about the
  suit changes nothing. It defaults false with no separate "unknown": every fit form opens on the
  stored answer, and a diver nobody has asked is shown no weight check either way.
- **Gear register** — the shop's own rental fleet as physical units (`gear_items`), opt-in **by
  presence**: a shop with zero units sees no gear UI anywhere and its prep flow is untouched, and
  adding the first unit is what turns it on — never a settings flag
  ([20260815-minimal-gear-register](../../architecture/decisions/20260815-minimal-gear-register.md)).
  Staff surface at `/shop/[shopSlug]/gear`; sits strictly *beneath* rental fit, never replacing it.
- **Gear unit** — one physical tracked thing on the register: the shop's own **tag** ("BCD #14",
  unique per shop — it's how a wet hand finds the row), kind (the prep list's eight plus **tank**,
  **drysuit**, **hood**, **gloves**, **torch**, **DPV**, **SMB**, **reel**, **camera**,
  **nitrox analyzer**, **O2 kit**, and the **other** catch-all), optional size/serial/brand. Its
  status is `in_service` or `needs_service` (pulled to the bench, out of the assignable pool).
  Register-only kinds do not enter rental fit or trip prep: they are inventory a shop counts and
  services, not gear the app assigns to a diver.
- **Gear reservation** — one unit assigned for an inclusive shop-local date range to exactly one
  holder: either a **booking** or a known person in a bookingless **counter rental**. It is the
  fulfillment record behind "who has what and when is it due back", never a billing record
  (rental money stays in checkout gear lines and staff invoices). The double-booking guard is the
  **database's**: an exclusion constraint refuses two open reservations of one unit with
  overlapping windows, so two staff racing get one reservation and one worded refusal. Check-out
  and return are separate stamps — "reserved" and "out the door" stay distinguishable — and a
  return closes the window and frees the unit immediately. A lapsed window splits on the handover
  stamp: checked out and late is **overdue** (the unit is with a diver), never collected is
  **never picked up** (it hangs on the wall) and is closed by release, never a fabricated return.
  Both are *phases* of one reservation and keep those narrow meanings everywhere a phase is worded
  — the unit page's badge, Today's rows, the register row's own line — while the register files
  them under one heading (**gear register groups**, next entry), which is the one place the word
  "overdue" is deliberately wider.
  Cancelling a booking releases its un-collected units; a checked-out one stays until it really
  comes home. Assigning informs the prep page; it gates nothing at boarding. Booking-held rows
  are the prep-flow shape; person-held rows are a **counter rental** (next entry).
- **Counter rental** — tagged units lent at the counter to a known person who is not on a boat:
  the person-held **gear reservations** written together in one act, sharing one person and one
  creation instant, with one inclusive window that starts no earlier than the shop's today and
  runs at most 31 days. Staff open it from the register's "Rent out", the diver record's "Rent
  gear" or ⌘K, and it lands on a printable **rental ticket** (who, the tags, the back-by date,
  then the shop's **rental terms** and a "Received by" line; no money). The set is handed over,
  brought home with one outcome, or released if never collected, like a booking's rental set. Money is an ordinary staff invoice
  with one `rental` line per priced unit (or one set line when the picks are exactly the shop's
  core set), linked to the rental by `gear_reservations.order_id`; the rental itself is never a
  charge, and an invoiced rental cannot be released until the invoice is voided. **Life support**
  (regulator, BCD, tank, dive computer, drysuit, DPV, O2 kit, nitrox analyzer) goes only to a
  person with a verified certification, read by the predicate boarding reads, and a drysuit also
  wants the verified drysuit card; a pending or self-declared card clears nothing, and the way
  past is "Card seen", the staffer capturing and certifying the card they hold. Soft goods go to
  anybody. **The service screen** refuses a life-support unit whose service clock is overdue as of
  the window's last day or that has an open service concern, and lends a flagged soft-goods unit
  only with its own "Lend anyway": the one place a **service clock** gates. Counter tanks are air
  only; a nitrox fill is not modelled. **The waiver informs and never gates** (H-108): the
  release is the person's, so the ticket and the Rentals list say its standing when it is short of
  signed ("Waiver: Not signed"), and the ticket offers the person's waiver link.
  Trip-scoped reads (prep, manifests) never count one; a departure's Gear tab names the units a
  booked diver holds on one over its window. ADR 20260815-minimal-gear-register, amendment
  2026-10-08.
- **Rental terms** — the shop's own plain-text conditions for rented gear (`shops.rental_terms`,
  optional, set in Settings → Rental gear), printed on every rental ticket, the trip slip and the
  counter ticket alike, above a "Received by" line with a printed name and a date. The signature
  says the person took the units; it is a receipt for gear, never a liability release, and the one
  shop-wide waiver stays the only waiver (CR-015). No terms set prints none, and DiveDay supplies
  no default. ADR 20260815-minimal-gear-register, the second amendment of 2026-10-08.
- **Gear proposal** — the unit the Gear tab offers for a piece a diver wants, so staff confirm
  instead of choose (`proposeRentalUnits`, `src/lib/gear-proposals.ts`). A proposal is never a
  reservation and never a fit check, and it gates nothing: nothing is held until a staffer taps
  Assign, and the exclusion constraint still decides availability at write time. A sized kind is
  proposed only from units *exactly* the size on file; a sizeless kind only from units with no
  size label, because a mask labelled "Kids" or "RX -4.0" was labelled for somebody. A drysuit
  diver's fins and gloves, and a diver flagged for a staff fit, are never proposed. A unit whose
  service clock has lapsed, or whose last return raised a **service concern** nobody has answered
  since, is never proposed; a unit coming due soon is proposed only after every unit that is not,
  and its line says so. A concern is answered by the kind's own care, dated after the unit came
  home (on the same day, written after the return): a `service` for a kind that gets one, a visual
  inspection, hydro test or O2 clean for a tank, and never a note for either. A soft good (a
  wetsuit, a mask, fins) has no service and no check to write, so a dated note is its clearing
  event, because a note is the only record those units ever get. A return with no outcome (the
  register's quick Return) says nothing, and leaves an earlier concern standing. A concern on a
  departure's set return can also **pull the unit for service** in the same act (issue #2205): one
  unticked box per unit, shown only once the concern is open, which moves a ticked unit to
  `needs_service` with the concern as its note. Never automatic, and still no service event. A regulator is
  never proposed for a diver who asked for nitrox, because the register cannot yet say which
  regulators are O2-clean. One unit is never proposed twice. Every pick, one row or "Assign all",
  goes through `assignGearUnit` or `confirmProposedGearUnits`, and each is re-read against what
  the departure still wants before it reserves (`screenGearPicks`), so a stale tab cannot give a
  diver a second unit of a kind they hold. A proposed pick is also re-read for care at that
  moment: one whose unit has since gained a lapsed clock or an open concern is refused and its row
  left for a person. A unit picked by hand from the picker can still be a labeled one, knowingly.
- **Gear register groups** — the three windows the register files every live unit into, and its
  answer to "where is my fleet right now": **Out** (a window that has begun — with a diver, or
  waiting on the desk for someone to collect it), **Overdue** (a window that has closed and nobody
  has shut), and **On the wall** (everything else — unclaimed, returned, or spoken for on a date
  still ahead). These are *window* states, and the one place they part company with the phase
  vocabulary above is worth knowing: **the Overdue group takes both lapsed phases.** Its count is
  every claim that has run out, so "Overdue — 3" means three claims to close, never three units in
  divers' hands — two of them may be hanging on the shop's own wall under a stale claim. Which is
  which is the row's job and not the heading's: the never-collected unit says **Never picked up**
  in a quieter line and offers a *release*, the one with a diver carries the warning word and
  offers a *return*, and Today still raises the two as separate rows with separate detail. A unit
  is in exactly one group, by a pure rule (`gearRegisterGroup`, `src/lib/gear.ts`) the register and
  its row words both read
  ([20260827-the-shops-shelves](../../architecture/decisions/20260827-the-shops-shelves.md), slice 9d).
  **Service due** sits beside the three on the same chip row without being one of them: the
  fleet-wide list of units the bench owes work — pulled off the wall, or a clock overdue or running
  out inside the month — which asks what a unit *needs* rather than where it *is*, and is the one
  reading no group absorbs. **Rentals** sits on the same chip row for the same reason: every open
  reservation (not yet returned, the ones starting later included) under the person who holds it,
  trip-held and counter-held in one list (`listGearRentals`, `src/db/gear-rentals.ts`). It asks
  *who* has the fleet rather than where a unit is; a **rental** there is the units one holder took
  under one booking or over the counter, worded with the phase vocabulary above and the booking's
  own money word, and the list pages by holder so one diver's set never splits.
- **Service clock** — a unit's care deadlines, derived from its append-only service events
  (`gear_service_events`): manufacturer `service`, a tank's independent `hydro_test` and
  `visual_inspection` clocks, the `o2_clean` renewal, the printed dates of **safety kit**
  (`aed_pads`, `aed_battery`, `expiry`), and clockless condition `note`s. The newest
  event of a kind *is* that clock; the earliest deadline is the unit's state (ok / due soon /
  overdue), which **informs, never gates** — the dock decides whether an overdue unit dives, not
  the software. The one exception is a **counter rental** of life support, which has no dock and
  is refused on an overdue clock. A clock with a dive interval counts the unit's dives since its
  service: each returned trip rental adds the departure's planned dives, and each returned
  counter rental adds the dives the person said at the return (`dives_logged`, dated by the
  window's first day), or nothing when nobody asked. Both are a floor. A care event is not itself
  a work order; only a work order's **Work done record** writes one, for a check that passed
  (ADR 20261008-gear-work-orders).
- **Sizing** — BCDs and wetsuits are sized (XS–XXL and height/weight dependent), so a prep list
  groups by item *and* size; an unrecorded size is shown as a loose end, not silently dropped.
- **Complete rental fit** — a fit is complete when *every piece the diver takes from the shop* has
  the size it needs, not merely when a record exists: a diver who ticks BCD, wetsuit and weights and
  supplies only a shoe size has an **incomplete** fit, with three loose ends. One shoe size answers
  for both boots and fins. The **sized** pieces are BCD, wetsuit, boots, mask & fins, weights and
  drysuit (`SIZED_RENTAL_KINDS`, `src/lib/rentals.ts`); every other piece has no size column, so it
  has no size to be missing. Named that way round on purpose: the unsized list was kept by hand as
  three, drifted to six without anybody noticing, and a diver renting a dive light read "Not
  recorded" — a gap nobody could fill (#1805). "Not recorded" (nobody asked) and "incomplete" (asked, half blank) stay distinct.
  Completeness is a prompt for staff, never a gate: it refuses nobody a seat and blocks nobody from
  boarding.
- **Needs staff fit** — the safe fallback when the shop can't fill a size a diver asked for (H-06):
  staff flag the diver for hands-on fitting at check-in instead of quietly packing a different
  size. The flagged diver keeps their line on the prep list — the count is what the packer loads
  from, so dropping them arrives a BCD short with nothing to fit them from — but the **size** comes
  off, reading "fit at check-in", and they're named in their own "fit these divers at check-in"
  section, along with the sizes they asked for — the captain doing the fit can't edit the profile
  and needs somewhere to start. On the Gear tab a flagged diver still gets a picker for each piece, opened
  empty and never proposed, so their unit is still reserved through the register. Pieces with no size column are untouched by the flag; so are weights (lead is bulk stock, never a size to be short of, and usual weighting is
  the fit's most safety-relevant number) and tanks, since gas is never sized. Distinct from both "own kit" and "not asked yet" on
  a roster/manifest line, and sticky: editing sizes never clears it, only an explicit resolve does.
  See [20260724-gear-fit-fallback](../../architecture/decisions/20260724-gear-fit-fallback.md).
- **Gear-request override** — rewriting what a diver themselves asked for. Reserved to owners,
  managers, instructors, and **divemasters** (`canOverrideGearRequest`) — sizing a diver is in-water
  judgement. Deliberately wider than `canConfigureTrips`, which excludes divemasters. Substituting
  a real available item, recording a diver's *first* fit (there is nothing on file to override),
  and **raising** the needs-staff-fit flag stay open to every staff member: those are the day's
  work, not an override. **Clearing** that flag is gated — it asserts the stated size packs after
  all, which is the judgement call.
- **Trip prep list** — the derived packing list for one departure: tanks (one per diver per planned
  dive, split air/nitrox) plus rental kit grouped by item and size, with the divers each line is
  for. Crew get one air tank per planned dive when their job on this trip puts them in the water:
  the job rostered for this departure decides it (instructor or divemaster yes, captain or deck
  crew no), and only when no job is set do their standing roles (instructor, assistant instructor,
  divemaster) stand in (`divesOnTrip`, `src/lib/crew-roles.ts`; issue #1851). Purely derived —
  nothing on it is an allocation. A diver who **dives dry** (above, rented
  suit or their own) is the one diver whose weights line deliberately carries no number: every fit
  form asks usual weighting against a
  wetsuit ("Usually 12 lb with 3 mm suit"), and a drysuit needs two to four kilos more, so their
  weights line reads "weight check in the water" on the prep list and carries no size on a manifest
  or roster line. Under-weighted is the direction a drysuit diver cannot hold a safety stop in; the
  stated answer stays on the diver profile, where the question was asked. Their **fins** are the
  same question one step over: every fit form asks one shoe size ("Fin & boot size", "US 9 / EU
  42"), a vulcanised drysuit boot is two to three fin sizes bigger than the foot in it, and a pair
  packed to the stated number does not go on at the bench. That size stays on the line as the
  number the packer sizes up from, and the line says the pair has to clear the boot.
  **Both follow the diver, never the catalog** (H-78, issue #1810): every drysuit has a boot, a
  rented suit's vulcanised one or the diver's own, so a diver in their own suit gets the same fin
  line as one in ours. A piece the shop has since dropped from its **rental catalog** is the one
  line here that carries a reason rather than only a size: it stays on the list and on every other
  surface that reads the fit and says the shop no longer rents it, while the diver's weights and
  fins still read as a drysuit diver's. Rules in `src/lib/dive-prep.ts`.
- **Diver profile** — the shop's person-first operational record. A diver profile gathers contact
  details, certification evidence, rental fit, and bookings; cards are not managed as an unrelated
  certification inbox.
- **Date of birth** — optional on a diver profile (`people.date_of_birth`, date-only). Its one job
  is checking a course's `minimum_age` on the day that course runs — not the day it's booked, so a
  diver whose birthday falls in between is admitted. **Fails open** by product decision (H-08,
  option B): a diver with no date on file books exactly as they always have, because nothing
  collected one before and failing closed would lock out every existing diver overnight. Enforced
  two ways: a refusal on **staff-initiated** bookings, and an `under_minimum_age` readiness blocker
  re-evaluated on every read (which is what catches a date recorded *after* the booking). The
  anonymous public form never refuses on age — a refusal there answers "is this address a child
  under N?" to anyone who can guess an address. The diver-facing checklist **does** name the real
  reason (H-22, decided 2026-07-25) unless a name mismatch on the same booking is also unresolved
  — a known, documented, narrower residual gap rather than a full close: an attacker who already
  knows a specific person's exact name and email is not stopped. See
  [20260725-checklist-age-disclosure](../../architecture/decisions/20260725-checklist-age-disclosure.md).
  Real age verification stays a dock-side ID check.
- **Nitrox / EANx** — enriched-air breathing gas with a higher oxygen fraction than air
  (recreationally 22–40% O₂). DiveDay models the **nitrox specialty card** separately from the
  recreational ladder (it is a yes/no gate, not a rung): captured pending, then verified. A card
  brought in by the contact importer lands `verified` and flagged imported, but — unlike a level card
  — its fill authorization waits for a staff confirm (see **Nitrox request**), because a wrong fill
  is the highest-consequence failure in the product and a spreadsheet cell is not a card sighting
  (ADR 20260724-import-verified-cards). That reasoning used to lean on a level card having an expiry
  to backstop a bad import; no card carries one now, and the confirm stands on its own consequence.
- **Nitrox request** — a per-booking ask for enriched air, billed per dive, offered only when the
  shop's **rental catalog** includes nitrox (most shops don't fill it, so this is off by default).
  A diver may request it **without** a verified card on file: the request is recorded and flagged
  to the diver and the shop (`certified` on the write, the Today nitrox nudge, the prep-list
  blocker), never silently refused — so the diver is prompted to send their card and the shop
  knows to chase it. The request is not a fill authorization: every read (prep list, manifest,
  Today) re-checks the card at read time (`authorizesNitroxFill`) and downgrades the diver to air
  unless a card **authorizes the fill** — `verified`, unarchived, and (if imported) confirmed here.
  So neither an uncertified request nor an imported-but-unconfirmed card can become a nitrox tank.
  Clearing a request is always allowed. `setBookingNitrox` also refuses to turn a request *on* when
  the shop's catalog doesn't offer nitrox, so a shop that never enabled it can never end up with one.

- **The bench** — the shop's service work, beside the register as the Gear section's second tab: a
  board of open **work orders** grouped by status, and one page per ticket. A shop that only rents
  never opens it; a shop that only repairs can use it with no fleet at all
  ([20261008-gear-work-orders](../../architecture/decisions/20261008-gear-work-orders.md)).
- **Work order** — one open piece of bench work: what came in, whose it is, what the customer
  reports, who is working it, what was done, and the parts and labor it comes to. It covers
  **either** a customer's own gear **or** one of the shop's units, never both (the
  `work_orders_one_subject` check), and carries a short **number** (#12), the shop's next and never
  reused, which the claim tag, the board and a phone call use. It moves between **received**, **in
  progress**, **waiting on parts** and **ready for pickup** in any direction, and **picked up** is
  terminal: gear that comes back is a new ticket. A shop unit's ticket skips ready for pickup, and
  its end reads **Back in service** when the work was done, **Off the bench** otherwise. Opening one
  on a shop unit takes the unit off the wall (`needs_service`, the reported problem as its note).
  **No status move writes a clock**, pickup included; that is the Work done record's job. Every move
  appends to `work_order_events`, which is what answers "who said this was ready" a year later.
  Parts and labor are **figures, not a charge**: money stays with orders and Stripe, and the printed
  **claim tag** carries none of it.
- **Work done record** — how a work order's job ended, written once by the technician: **done**,
  **declined**, **unserviceable** or **condemned** (the last two say why), and for a done job each
  check performed (`work_order_care`): service, visual inspection, hydro test, O2 clean or other
  work, **passed or failed**, the day performed, and the next due date the technician confirmed.
  Only a passed check moves a clock: on a shop unit through `recordGearService`, on a customer's
  piece by setting the matching date. A failed check is kept as the record of the failure and
  writes nothing. Declined, unserviceable and condemned write no clock; a condemned shop unit stays
  off the wall with the reason as its note.
- **Technician** — the staff member a work order is handed to (`technician_person_id`). Any person
  with a staff role at the shop; never a diver, never another shop's person. Handing a ticket on is
  its own history row; **Unassigned** is a ticket nobody holds.
- **Late (work order)** — the promised day has passed on the shop's calendar and the ticket is still
  open. Ready for pickup counts: the work is done and the customer has not collected, which is what
  the promise exists to catch. A collected ticket is never late, however late it ran.
- **Bench notes vs work performed** — two texts on a ticket. **Bench notes** are the shop's own talk
  about the repair, for technicians, never shown to a customer and left out of the diver's export.
  **Work performed** is what the customer is told was done. Neither moves a clock; the Work done
  record does.
- **Customer gear** — a piece of equipment a *diver* owns, on the shop's record because the bench
  has worked it or is about to (`customer_gear_items`): kind, make and model, serial number, and its
  own due dates: a cylinder's **visual inspection** and **hydro test**, every other kind's one
  **service** date. Not the shop's fleet (`gear_items`) and never rentable — the register, the prep
  list and every manifest read ignore it.
- **Ready message** — what a customer is told when their ticket moves to ready for pickup: the shop,
  the ticket number, the pieces and the work performed, by email or the courtesy text. It is sent
  once per ready transition and can be resent from the ticket. It never goes for a ticket on one of
  the shop's own units ([20261008-work-order-follow-up](../../architecture/decisions/20261008-work-order-follow-up.md)).
- **Bench bill** — the order a ticket's parts and labor raise through `createOrder`, linked in
  `work_order_bills`. It is an ordinary order, so only one can be open per ticket. With no Stripe
  account, the ticket shows the total and says it is collected at the counter.
- **Service reminder** — the message a customer gets about a month before each of a piece's due
  dates, once per piece, clock and date, so a cylinder can get a visual-inspection reminder and a
  hydro-test reminder. It is on by default and switched off per piece on the diver record.
