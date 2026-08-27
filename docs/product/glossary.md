# Dive-domain glossary

Domain terms agents must use correctly — in code, UI copy, and data models. When you introduce a
new domain concept, define it here in the same PR.

- **Blow-out** — the captain's call that weather or sea state makes a departure un-runnable: the
  trip is cancelled by the shop, not the diver. Distinct from a **conditions hold** (below), which
  is reversible and keeps bookings live. In DiveDay a blow-out is called once per departure and
  triggers the cancellation cascade: every booked diver gets one message with the cancellation,
  their money story, and rebooking options filtered to departures they qualify for, and staff work
  the cascade record until nobody is left unresolved (ADR
  [20260804-blowout-cascade](../architecture/decisions/20260804-blowout-cascade.md)). A blow-out
  moves no money on its own — refunds stay a per-booking staff decision.
- **Conditions hold** — a reversible crew call while weather or sea state is uncertain. Existing
  bookings remain valid, new bookings pause, and booked divers are notified. It is not a
  cancellation and never implies a refund.
- **Staff note** — shop-private operational context written for the next person on the team. A
  note has one general kind for now and attaches either to a **diver** (shared across that diver's
  record and the live boat manifest) or to one **booking** (departure-specific desk context). It is
  displayed with its author and timestamp, is exported with the shop's records, and is never
  evidence: readiness, trip admission, capacity, boarding, and roll-call completion do not read it.
  New note kinds must name their audience and retention before they are added; free text is not a
  license to put medical or boarding decisions into an unaudited gate.

## Certification

- **Agency** — organization that trains and certifies divers. Major ones: **PADI**, **SSI**,
  **NAUI**, **SDI/TDI**, **RAID**, **CMAS**, **GUE**, **BSAC**. A diver's card is agency-specific but
  levels are broadly equivalent across agencies. Two different fields carry an agency name and they
  must not be confused: `certification_agency` is a **pg enum** — the agencies a diver's *card* may
  be recorded under — while `courses.agency` is **free text a shop types** for a course it teaches,
  and is the one `src/lib/course-ratios.ts` reads. Nothing in readiness, trip admission, or the
  nitrox fill gate reads either one; a card clears on its level and its verification state. See
  **Other agency** for what the enum still cannot say.
- **C-card** — the certification card (physical or digital) a diver presents as proof. Has an
  agency, a level, and a cert/diver number. A recreational **diver** card **does not expire**, and
  DiveDay stores no date saying otherwise: the column that once held a shop-set "refresher due" date was dropped on
  2026-08-21 along with everything that gated on it
  (ADR 20260821-a-card-does-not-expire, superseding H-08's relabel). Three things in diving *do*
  lapse and DiveDay models none of them, so none was ever what that column held: a **professional
  rating** renews annually at every agency (a lapsed Instructor is out of teaching status and
  uninsured), **GUE** alone among the agencies in the enum states a validity on its certifications,
  and a **CMAS** star card is permanent while the issuing national federation's licence is annual.
  CPR/EFR and O₂-provider tickets expire too, and are a real prerequisite for Rescue and above.
  What a card cannot tell you either way is when this diver was last in the water — that is
  **Dive recency**, a different question asked of the diver, and it is not a gate.
- **Verified certification** — a card is evidence, not clearance. `validVerifiedCertification` is one
  predicate, `status === "verified"`, read identically by every gate — but there is more than one
  path to it: a staffer looks a card number up with the issuing agency (in the agency's own portal,
  outside DiveDay) and clicks **Mark certified**; a card arrives already `verified` through the contact
  importer (see **Imported certification**); or this shop's own instructor certifies a diver directly
  from a course session's own roster (see **Shop-issued certification**). There is no automated agency
  integration for the first path. Only a certified card at or above a trip's required level can
  satisfy readiness. (The staff surface says "certified"; the stored status value is `verified`, which
  is what readiness reads.)
- **Claimed certification** — a card recorded as evidence but not yet verified: the stored status is
  `pending`. It is what a card entered by hand starts as (the shop-owner-facing word is "claimed").
  A claimed card never satisfies readiness or authorizes a nitrox fill until staff **Mark certified**.
  (A card brought in by the contact importer is *not* claimed — see **Imported certification**.)
- **Imported certification** — a card the contact importer brought in from a shop's prior system or
  spreadsheet. It lands `verified` (DiveDay assumes the shop's own system already checked it) but is
  permanently flagged `imported` (a non-null `importedAt`, with an optional prior-shop
  `importedFromLabel`), so it is never mistaken for a card this shop carded on sight. A level card
  satisfies readiness and clears depth gates on import; staff get a soft one-tap **Confirm card** nudge (which stamps `reviewedAt`) but boarding never waits
  on it. **Two gates do wait for that confirm.** The **enriched-air fill**: an imported nitrox card
  gives plain air until it, because a wrong fill is the highest-consequence failure
  (ADR 20260724-import-verified-cards). And any **specialty** gate: an
  imported specialty card is `verified` but does not clear the dive it authorizes until a staffer
  confirms it, because a specialty is what permits a materially riskier dive (deep gates depth past
  18 m) and a spreadsheet cell is not a card sighting (H-23,
  ADR 20260725-import-specialty-cards). One thing imports `pending` rather than `verified`: a card
  the source file's own status column marks unverified.
- **Confirm to clear** — the display state of an imported specialty card no staffer has confirmed
  yet: on file, `verified`, and still holding its gate. Shown as “certified · confirm to clear” in a
  warning tone rather than the plain green “certified” a hand-verified card gets, so the two are never
  read as the same thing at a busy desk.
- **Shop-issued certification** — a level card **this shop's own instructor certified**, from a per-
  student tap on a course session's own roster (issue #717), never automatic. It lands `verified`
  immediately (`issued_by_shop_at` set, alongside `issued_from_trip_id` naming the session and
  `issued_by_person_id` naming the instructor) with `identifier` left null — the card *number* is the
  agency's own processing, routinely days behind the instructor's own sign-off, and this is the one
  path from "this shop taught and ran this course" to a card its own booking gate actually reads. A
  numberless `verified` row is otherwise refused (`certifications_identifier_present_unless_self_declared`);
  this is the check constraint's third exception, deliberately not conditioned on `status = 'pending'`
  the way a **Self-declared certification** is, because the two are opposite cases — nobody has seen
  anything there, while here an accountable instructor is asserting personal knowledge that a specific
  person met the standard, in a session this shop ran. Trusted the same way an **Imported
  certification** is — by provenance rather than by a staffer looking a number up with the agency —
  and more strongly: an import is trusted because of a system nobody at this shop watched, this
  because of a specific instructor on this shop's own roster. Refuses a level the diver already holds
  a live verified card for, any provenance, so a repeat tap cannot mint a second numberless row the
  unique index (keyed on `identifier`) cannot catch. Scoped to `certifications` only — the level
  ladder — not the **specialty** or **nitrox** tables, which stay one-tap-away from this treatment on
  purpose (see their own entries on why even an *imported* row waits for a staff confirm there).
- **Self-declared certification** — a level (or a nitrox tick) a **diver typed about themselves** on
  one of the three public forms that ask: the shop-wide last-minute-deal list, a full trip's wait
  list, or — since 2026-08-20 — the trip booking form itself. It lands on the person as a `pending`
  card stamped `self_declared_at`. Since 2026-08-21 the forms also ask, optionally, for the **agency
  and card number** (issue #630), and where those land is the point: the agency rides in `agency`
  (`other` when unstated), while the number goes to its own **`declared_identifier`** column and
  never to `identifier`. `identifier` is what the *shop* holds, and it is a key — a number a stranger
  can write into it fails the sale on a collision, answers "is this number on file here?" to anyone
  who watches, and takes the card-entry form away from the real diver. Neither field gates anything;
  both exist so a staffer can pre-check the claim with the agency before the dive date, which is what
  "verified asynchronously" had no way to do before.
  **One gate reads it and one does not, and the split is the whole design.**
  `decideTripAdmission` — the *sale* — believes it, because the question there is "could this diver
  ever be cleared?" and a diver who names their rung has answered it. `calculateReadiness` — the
  *boat* — does not, and never has: it clears on `verified` and nothing else, so a claim buys a seat
  and never a place in the water
  ([20260820-attested-at-booking-verified-at-boarding](../architecture/decisions/20260820-attested-at-booking-verified-at-boarding.md)).
  That means the sale-time gate **can be talked past** — a refused diver can type a higher rung and
  succeed — and that is accepted rather than overlooked: it was never the thing keeping anyone out of
  the water, and refusing a shop's own carded regulars to hold a line it could not hold was the worse
  trade (H-27/H-29). Staff see it marked *"— unverified, no card"* in a warning tone wherever it renders, the
  same treatment an **Imported specialty card** gets for the same reason: it must never be scanned as
  a plain level. Deliberately *not* the same
  thing as an **Imported certification**: a CSV a shop uploaded out of its own prior system is
  materially more trustworthy than a stranger's typing, and the two provenances are separate columns
  so nothing can blur them. Turning one into real evidence takes a **Card sighting**, below. A claim
  never displaces a card the shop already holds — if the person has any live card that is **not
  itself a still-unsighted self-declaration**, nothing is written at all. "Still unsighted" is
  `self_declared_at IS NOT NULL AND status = 'pending'`, and the second half is load-bearing: the
  stamp stays forever after a sighting, so a rule phrased as "not self-declared" would read a
  staff-verified card as displaceable and let an anonymous post re-grade it
  ([20260814-self-declared-cards](../architecture/decisions/20260814-self-declared-cards.md)).
- **Declared uncertified** — a joiner's answer of *"I'm not certified yet"* on one of those same two
  opt-ins: Discover Scuba and Try Scuba customers, snorkellers, the non-diving half of a couple,
  somebody booked onto a course they have not started. It is **not a Self-declared certification and
  not a level**: it lands as one nullable stamp on the person (`people.no_certification_declared_at`)
  and never as a `certifications` row, because a Discover Scuba experience is not a certification and
  every row in that table asserts that a card exists. Nor is it a rung on the ladder —
  `certification_level` is an ordering, and a "none" member would eventually be compared as a level.
  It exists because the alternative was worse than silence: an uncertified joiner had to pick
  "Rather not say", which renders identically to a certified regular who skipped the question, so the
  shop mailed them a certified two-tank charter. Staff read it as *"Not certified yet — diver's
  word"*, in the same warning tone every unchecked claim wears, and on the last-minute-deal list the
  person is counted and lifted like anyone else **below this departure's minimum** — under every
  requirement there is, a rung, a specialty or nitrox, without being ranked on a ladder they are not
  on. That last part makes them the *only* recipient that list can place on a departure gated by
  cards rather than a rung. Same anti-displacement rule as a claim,
  widened to all three card tables: any live card the shop holds — level, nitrox or specialty —
  refutes "there is no card", and nothing is written. It **retracts the joiner's own still-unsighted
  claims** (archived, never destroyed) so a correction downward cannot be outlived by the higher claim
  it corrects, and it is **ignored rather than deleted** once evidence lands beside it — where a
  record began is history, so the column keeps the answer and the *reader* stops repeating it. There
  is a second supersession path, made by a person rather than by evidence: see **Clearing a
  declared-uncertified stamp** below.
  "Ignored" is that same three-table test: any live card the shop holds drops it from the summary,
  while a level the diver merely *claimed* later leaves it standing and simply renders ahead of it.
  It gates nothing ([20260814-self-declared-cards](../architecture/decisions/20260814-self-declared-cards.md)).
- **Clearing a declared-uncertified stamp** — a staffer saying, on the diver record, that this diver
  never gave that answer. The forms that write it are unauthenticated and resolve a person by shop +
  email, so for a diver the shop holds no card for anybody with a name and an email address can leave
  the stamp; before this the only thing that removed it was owner-only erasure of the whole record.
  It **supersedes rather than deletes** (`people.no_certification_cleared_at`, plus the staff member
  who did it) for the same reason the stamp itself survives a real card: where a record began is
  history. The direction is the whole safety argument — clearing can only take a record from a
  *stated* absence of a card to *no statement at all*, the silence of somebody nobody asked. It never
  touches the three card tables, so it can never turn a claim into evidence; a **Card sighting** is
  still the only door. A later declaration un-clears it, so one correction cannot silently swallow
  every answer the diver gives afterwards — but only the timestamp, never the staff member who made
  it, because the writer of that later declaration is an anonymous form and must not be able to erase
  the shop's own audit of its own correction. It is also, in effect, a **mute button on the deal
  list**: a stated "I hold no card" counts as below the departure's minimum and is lifted to the top
  of the capped preview, and a cleared one is quiet, so the control's own words name that consequence
  ([20260814-self-declared-cards](../architecture/decisions/20260814-self-declared-cards.md)).
- **Certification summary** — the one staff-facing phrase for *what a person may dive, as far as
  anybody here knows*, rendered beside a name on the last-minute-deal recipient list and the
  wait-list rows: a card the shop holds reads plainly, a **Self-declared certification** reads
  *"— unverified, no card"* in a warning tone, a **Declared uncertified** joiner reads *"Not
  certified yet — unverified"* in the same tone, and nothing on file reads *"Level not said"* rather
  than blank. On the deal list it also says *"· below this departure's minimum"* when that person
  ranks under the trip's effective gate — a **word**, because the warning tone beside it already
  means exactly one thing ("nobody has seen this card") and colour is never the only carrier of
  meaning. It **informs and gates nothing**: no blast is filtered, no mail reordered, no button
  disabled. Never called a *dive profile*, which to a diver is the depth/time curve of a dive that
  already happened.
- **Card sighting** — the staffer entering the agency, the card number **and the level off the card
  in their hand**.
  It is now the one thing that turns a **Self-declared certification** into evidence, and it is the
  same act as capturing a card rather than an extra attestation — which is the point: the diver's
  claim stops being what the record rests on. It asks for the **level** as well as the number,
  prefilled with the claim: the likeliest wrong claim is an overstated one, and a sighting that
  copied the number off a genuine Open Water card while keeping the diver's typed "Instructor" would
  verify the one field nobody looked at. Enforced twice, in `reviewCertification` and in the
  database's own `certifications_identifier_present_unless_self_declared`, so a numberless card can
  never reach `verified` — the constraint catches a *null* **and** a blank number as of 2026-08-15
  (it caught only null before, and `''` satisfied it; the tightened predicate keeps both conjuncts,
  because `length(btrim(NULL)) > 0` is NULL and a CHECK passes on NULL). The number is also
  **shape-checked** as of 2026-08-15
  (`isPlausibleCardNumber`: three characters and at least one digit, on this form and on the capture
  forms beside it), because *"xx"* certified a self-declared "Instructor" for a day. That check is a
  typo filter and never evidence: what the record rests on is the staffer holding the card and the
  agency lookup they do before tapping.
  *Its earlier meaning was retired on 2026-08-14* — an attestation checkbox a staffer ticked when
  confirming an **imported** specialty or nitrox card (*“I've seen this diver's card, or checked the
  number with the issuing agency”*), dropped when the owner levelled the two confirms against the
  imported *level* card, which opens the same depth on a bare tap and never asked
  (H-24 revised, [20260814-one-tap-imported-card-confirm](../architecture/decisions/20260814-one-tap-imported-card-confirm.md)).
  Every imported card still confirms on one tap; what came back here is narrower and applies only to
  the diver-written rows that did not exist then. What did **not** change for imports is that the
  confirm exists at all: an imported card clears nothing until a staffer makes that tap, per card,
  and there is still deliberately no bulk confirm. Cards reviewed before that date keep the sentence
  the old attestation wrote into their `review_note`.
- **Prior visit** — one line of a diver's history at the shop's *previous* system, brought across by
  the contact importer from a bookings or orders export (one row per booking). It is a **booking
  record, not a dive record**: an export holds cancellations and no-shows, so the source's own status
  word and its price are kept verbatim and never mapped onto a DiveDay booking status or a currency
  amount. A prior visit points at no trip — it is never on the schedule, never in a manifest, never
  in capacity or owner reporting — and its amount is display text that nothing sums. It shows only on
  the diver's profile, merged into **Shop history** newest-first and marked imported. Distinct from a
  **booking**, which is a seat on a trip this shop ran here and has a roll call behind it.
  See [20260725-import-prior-visits](../architecture/decisions/20260725-import-prior-visits.md).
- **Readiness** — the fail-closed answer to “can this diver board?” It lists human-readable
  blockers from the trip’s requirements and the diver’s waiver/cert evidence. Unknown,
  unconfigured, pending, expired, or insufficient evidence is never “ready.”
- **Aboard blocker kind** — what a blocker is asking of the crew once the diver is *already on the
  boat*, which is not the same question as which requirement family it belongs to. Four kinds,
  worst first: **medical** (a review hold — a doctor must confirm in writing, so nobody aboard can
  clear it), **unknown** (nothing on file that clears them: an unsigned, unsent or expired waiver
  is *no medical declaration at all*, and so are an unconfirmed identity, a failed readiness
  lookup, or a trip with no requirements configured), **certification** (a card missing,
  unverified, self-declared or too shallow, a specialty absent, or a diver under the course's
  minimum age), and **payment** — the only one of the four that does not change what happens in
  the water today. Worst-first holds *within* one diver, so a diver on medical review who is also
  missing a card is a medical hold; it never holds *across* a group, because a count is a census
  and a reason is not — the departure card renders one line per kind present. Deliberately not the
  blocker **category** (`waiver`/`certification`/`payment`/`setup`), which files a medical hold
  under *waiver*, correctly, since that is where the answer was collected. No line naming one of
  these names a role: DiveDay informs and never gates, the captain owns the vessel while the dive
  leader decides who splashes, and a pool session has neither.
- **Trip admission** — the answer to a *different* question, asked when the **seat is sold**:
  “could this diver **ever** be cleared for this trip?” It is **deliberately weaker than readiness
  and is never the boarding authority.** Readiness asks “is this diver cleared *right now*?”;
  admission refuses only a **settled impossibility** — the rung of the ladder they stand on, or a
  specialty/nitrox card they hold none of, in any state. Everything a person can still fix before
  the boat leaves (an unsigned waiver, a card captured but not yet verified, a payment
  outstanding) is *not* a reason to refuse the sale. **Absence of evidence never
  refuses**: a diver this shop has never carded books as before, the same trade-off H-08 settled
  for the course minimum-age gate. It exists to stop a diver **paying in full** for a dive they
  were never going to be allowed to do (DOM-M6) — it stops the money, never the manifest.
  **One narrow exception since 2026-08-20**, on the public booking form only: when the shortfall
  is a *level* and it rests on the rung this submitter just typed, the seat is sold with a warning
  under their own answer rather than refused — the case H-30 itself describes as "a response to
  what this submitter just typed rather than a disclosure about somebody on file". The refusal
  stands everywhere else: on a shortfall resting on the shop's **record** (H-30's own case, where
  the diver typed nothing and no warning could have reached them), on a **specialty or nitrox**
  gate (no field on the form can answer either), and at every staff door, reschedule and seat
  claim. See **Admission advisory** below.
  Two carve-outs: an **identity-unconfirmed** booking is not judged by the matched record's cards
  (H-13), and on a **course session** the *course's* own `minimum_certification_level` is the
  admission rule, because continuing education dives at the sites it certifies people for — an AOW
  course's deep adventure dive is at an AOW site, and the site's inherent gate must not refuse the
  student the course exists to create. Lives in one pure function, `decideTripAdmission`
  (`src/lib/trip-admission.ts`), called from exactly one place.
  See [20260803-trip-admission-at-booking](../architecture/decisions/20260803-trip-admission-at-booking.md).
  Distinct from **course admission**, which is a course's own enrolment rule and fails *closed*.
- **Admission advisory** — what a trip asks for that a diver's record does not yet answer, on a
  booking that **went through anyway**. Deliberately a different word, and a different field, from
  a refusal: one means the seat was not sold, the other means it was. Carried back on the success
  result of `createBookingRecord` when `admissionGate: "advise"` and the shortfall is a
  declared-level one; the public booking form is the only caller that asks for it. It is advice
  about a *sale*, never about boarding — readiness still clears on a sighted card and nothing else.
- **Levels** (recreational ladder, roughly): **Open Water (OW)** → **Advanced Open Water
  (AOW)** → **Rescue** → **Divemaster (DM)** → **Instructor**. Names vary slightly by agency.
- **Requirable level** — the levels a **site or trip may demand**, which since 2026-08-21 is a
  *different and shorter* set than the ladder above: **Open Water, Advanced Open Water, Rescue**, and
  that is the ceiling (`REQUIRABLE_CERTIFICATION_LEVELS`, `src/lib/readiness.ts`; issue #630, ADR
  20260821-a-card-does-not-expire). Divemaster and Instructor are working ratings — crew hold them,
  course ratios count them, an instructor-led session is gated on one being assigned — and none of
  that is a shop telling a paying diver to hold a professional rating to board a charter. A "pros
  only" departure is a **course**, and `courses.minimum_certification_level` still accepts both. It
  stops at Rescue because that is the highest *modelled* recreational rung: **Master Scuba Diver** is
  Rescue plus five specialties plus fifty dives, which a linear ladder cannot express, so the import
  path files it under `level_not_gated`
  ([20260725-imported-card-sighting](../architecture/decisions/20260725-imported-card-sighting.md)).
- **PADI Scuba Diver** — a real certification one rung *below* Open Water: limited to 12 m and
  required to dive under the direct supervision of a PADI Professional. DiveDay's ladder has no rung
  for it, so any course whose agency floor is Scuba Diver (ReActivate, for one) is gated at Open
  Water instead. That gate is the **shop's**, not the agency's, and diver-facing copy must say so.
- **Adventure Diver** — the PADI sub-level between Open Water and AOW, earned with three Adventure
  Dives. It is the agency's real prerequisite for Deep, Wreck, and Rescue. DiveDay's ladder cannot
  record it, so those courses are gated at AOW — again a **shop-set** gate, and a valid Adventure
  Diver deserves to be told the difference is ours and invited to ask.
- **CMAS** — a **confederation, not an issuer**: the card is issued and numbered by a *national
  federation* (FFESSM in France, VDST in Germany, FIPSAS in Italy, LIFRAS in francophone Belgium…)
  under CMAS standards, so there is no single CMAS registry a staffer can check a number against —
  the lookup **Verified certification** describes has to go to the federation named on the card.
  Its ladder is stars, and DiveDay's ladder holds it like this: **1★ ≈ Open Water** (ISO 24801-2
  *Autonomous Diver*, the same rung PADI Open Water maps to), **2★ ≈ Advanced Open Water**, **3★ ≈
  Divemaster** (ISO 24801-3 *Dive Leader*). Two traps live in that mapping. **The stars are also
  instructor grades** — "CMAS 2 star" is genuinely ambiguous between a roughly-30 m recreational
  diver and a fully qualified instructor, a four-rung gap on the same two words, so the card itself
  has to be read rather than the cell. And **2★ → AOW silently drops rescue content**: CMAS bundles
  rescue skills into 2★ that PADI puts in a separate Rescue course, so recording an honest 2★ as
  Advanced Open Water under-records a diver who would clear a Rescue gate. Both directions are
  DiveDay's ladder failing to hold the agency's rung, not the diver's card being wrong.
- **RAID** — Dive RAID International. **Open Water 20 ≈ Open Water**, **Advanced 35 ≈ Advanced
  Open Water** — and the numbers in those names are the depths, which is where DiveDay is wrong
  about a real diver: RAID's Advanced is a **35 m** qualification and DiveDay's Advanced Open Water
  ceiling is **30 m** (`src/lib/depth-ceiling.ts`), so a RAID Advanced diver booked on a 32 m site
  draws a depth warning that is factually wrong about *that* diver. It stays a **warning and never a
  gate** (H-08, see **Depth ceiling**), so nobody is refused — but a warning that is routinely wrong
  is one a crew learns to click past, and the cost lands on the next warning, which may be right.
  Also see **Bundled nitrox**: RAID issues no standalone EANx card.
- **GUE** — Global Underwater Explorers, and the agency DiveDay's ladder **does not hold at all**.
  There is no AOW rung, no Rescue rung and no Divemaster rung to map to: the progression is
  **Fundamentals → Rec 1–3 → Tech 1–2 → Cave 1–2**. **Rec 1 ≈ Open Water is an under-record, not an
  equivalence** — Rec 1 goes past 18 m and includes EANx 32, so filing it as Open Water hands the
  diver a 18 m ceiling they trained past and loses the nitrox training entirely. **Fundamentals is
  not an entry-level card**: it is a skills course that presupposes an entry-level certification
  from another agency, so the honest record for a Fundamentals diver is **two cards** — their
  original agency's rung, plus the GUE card — never one GUE row parked at an invented rung. Also see
  **Bundled nitrox**.
- **Bundled nitrox** — **RAID and GUE issue no standalone enriched-air card.** EANx is trained
  inside the level card (RAID Open Water 20, GUE Rec 1), so there is no second number to type, and
  a staffer filling enriched air for one of those divers enters the **level card's own number** in
  the nitrox row. That is correct and it works: `nitrox_certifications`' unique index is per shop,
  per agency and per table, so the same number on a `certifications` row and a `nitrox_certifications`
  row is not a collision. It is written down because it looks like a mistake to whoever does it, and
  the two things a staffer does instead — refuse a fill to a properly trained diver, or hand the
  tank over off-system — are both worse than an entry that looks odd.
- **Other agency** — the enum's escape hatch (`certification_agency = 'other'`), and **a lossy one**:
  there is no free-text companion column anywhere in the schema, so a diver holding an **IANTD**,
  **SEI**, **ANDI**, **ACUC**, **PSAI** or **NASE** card is recorded as "Other agency" with nowhere
  to write *which* one — and the staffer who later has to look that number up has no idea whose
  portal to open. Widening the enum (CMAS/RAID/GUE, then BSAC) narrows the problem for the next shop
  and never closes it; the closing fix is the companion field, not a longer list. **BSAC** —
  British Sub-Aqua Club, the UK national governing body, ISO-aligned ladder **Ocean Diver ≈ Open
  Water → Sports Diver ≈ Advanced Open Water → Dive Leader ≈ Divemaster → Advanced Diver → First
  Class Diver** — was added because UK visitor traffic makes it the most common non-listed card on a
  Florida or Caribbean boat.
- **Junior certification** — the age-linked form of a level for divers under 15: **Junior Open
  Water**, **Junior Advanced Open Water**, **Junior Night Diver**, and so on. Same card, extra
  restrictions — 10–11-year-olds are limited to 12 m and must dive with a PADI Professional or a
  certified parent/guardian; 12–14-year-olds reach 18 m (21 m on an AOW deep dive) with any
  certified adult. The restrictions lift at 15. They drive dock-side decisions, so course copy and
  staff surfaces state them rather than implying the adult limits.
- **Site maximum depth** — `dive_sites.max_depth_meters`, the site's deepest point, stored in
  **metres always** whatever unit the shop reads. Distinct from `depth_range`, the free-text
  briefing prose that lives beside it: the number exists solely to be comparable to a
  certification's depth ceiling. A trip's depth is the deepest site it visits, across the primary
  site *and* every ordered dive.
- **Depth ceiling** — how deep a certification trains a diver to go: Open Water 18 m/60 ft,
  Advanced Open Water 30 m/100 ft, Rescue 30 m (a skills course, not a deeper one), Divemaster and
  Instructor 40 m — the recreational limit. A verified **Deep** specialty lifts an Open Water diver
  to 40 m; it can only raise a ceiling, never lower one. A **junior age band** overrides the card
  outright: 10–11-year-olds are capped at 12 m, 12–14-year-olds at 18 m (21 m on an Advanced card),
  and the restriction lifts on the 15th birthday, not on any new card. In DiveDay a site deeper
  than a diver's ceiling is a **warning to staff, never a booking gate** (H-08) — an instructor may
  deliberately keep a diver shallower than the site's maximum, and that is an ordinary correct
  dive. No card on file, or no depth on file, produces no warning at all rather than a false one.
  On screen that warning is the **depth advisory** — the sentence on a diver's roster card and
  manifest row, and the "Depth advisory" chip a diver wears when the identical sentence applies to
  much of the boat and is stated once above the list. Distinct from an **Admission advisory**,
  which is about booking-time trust in a self-declared card, not depth.
  See [20260730-site-depth-and-diver-age-surfaces](../architecture/decisions/20260730-site-depth-and-diver-age-surfaces.md).
- **Depth unit** — `shops.depth_unit`, whether a shop's staff read depths in metres or feet.
  Display and entry only: storage is canonical metres, so switching it moves no stored number.
  Florida crews say "sixty feet"; every agency standard DiveDay encodes is published in metres,
  which is why the stored unit and the default are metric. It governs every vertical distance the
  product shows, not only depths — including the automated outlook's wave height, at its own
  precision rule (a tenth of a metre, a whole foot), because whole metres would collapse the entire
  range a reef boat ever sees into 0 and 1.
- **Depth marker** — `{depth18}` in a course page's prose, which renders as "18 meters" or
  "60 feet" depending on the shop's **depth unit**. Course copy is free text in the shop's own row,
  so nothing could convert it and a Key Largo shop was reading "No deeper than 12 meters" on its own
  page. The number in the marker is metres, but resolution is a **lookup into the agency pairs**
  (12/40, 18/60, 21/70, 30/100, 40/130 — the same table as the depth ceiling above), never a
  conversion, which would print "59 ft". `{depth18n}` is the bare number, for a range. A shop may
  delete a marker and write the depth in its own words at any time; only a *broken* marker is
  refused, when the course editor saves.
  See [20260814-course-depth-markers](../architecture/decisions/20260814-course-depth-markers.md).
- **Temperature unit** — `shops.temperature_unit`, whether a shop's staff and divers read water
  temperature in Celsius or Fahrenheit. Display and entry only, on the same terms as the depth unit
  above: storage is canonical Celsius (`trips.water_temperature_c`), so switching it moves no
  stored reading. A **separate setting from the depth unit**, not derived from it — a Caribbean
  operator serving American divers publishes depths in feet and water temperature in Celsius, and
  that pairing is common enough that welding the two together mislabels real shops. Celsius is the
  default because storage is Celsius; the migration that introduced the column backfilled
  Fahrenheit for shops already set to feet, matching what they were being shown at the time.
- **Minor** — a diver under 18 on the trip date. Eighteen, not the diving world's 15: the flag
  exists because a minor's liability waiver may need a guardian signature, a question of legal
  majority in the shop's jurisdiction (Florida at launch, H-01). The diving restrictions on
  under-15s are a separate rule and travel through the junior depth bands above, so the two never
  have to agree. Shown on the roster and manifest so a captain reading the boarding list can see it
  without opening a profile (H-21). **A minor can still sign their own waiver solo** — accepted
  as-is for now and explicitly flagged for the H-01–H-03 waiver legal review, not silently left
  open.
- **Specialties** — standalone certs gating specific activities: **Deep** (beyond 18 m/60 ft for
  OW divers), **Night**, **Wreck**, **Drysuit** gate a **site/activity** and live in
  `specialty_certifications`. **Nitrox/EANx** (enriched air) is modeled separately (its evidence
  lives in `nitrox_certifications`) because it gates a **per-booking mix request**; a site or trip may
  *also* require a nitrox card to **board** (a nitrox charter), enforced as its own requirement flag
  — the same card, two independent gates (see Operations, below).
  **DiveDay's specialties are flat; the industry tiers some of them.** `wreck` is one value, but
  PADI **Wreck Diver** authorizes only limited penetration inside the light zone while TDI
  **Advanced Wreck** authorizes full penetration with a guideline — genuinely different dives. A
  shop gating a penetration dive on `"wreck"` is therefore gating on something **coarser than it
  thinks**, and a diver holding the recreational card clears it. The same coarseness applies to
  `deep` (agency depth limits differ) and to `night`. Until the model tiers them, a penetration or
  otherwise stepped-up dive needs a **staff decision at the desk**, not a `required_specialties`
  entry, and diver-facing copy must not imply the card was checked against the harder standard.
- **DSD (Discover Scuba Diving)** — a supervised *experience* for uncertified people. Not a
  cert. Minimum age 10; maximum depth 6 m/20 ft confined water, 12 m/40 ft open water. Always
  dives with an instructor, at the **intro-session ratio** (below) — tighter than Open Water
  training, because a DSD participant has had no prior water time at all.
- **Intro-session in-water ratio** — the cap on a no-certification-required taster session
  (DSD/Try Scuba — `courses.is_intro_course`): PADI's published **Discover Scuba** figure from the
  Instructor Manual (HD-6, sourced 2026-08-02) — **4 students per instructor in confined/pool
  water, tightening to 2 students per instructor for the open-water dive**, with **no assistant
  bonus** (PADI publishes none for DSD). DiveDay's trip model has no confined-water session type —
  a trip is one dated open-water outing — so **only the tighter 2:1 open-water figure is enforced**
  as a booking gate (`INTRO_COURSE_RATIO` in `src/lib/course-ratios.ts`, derived from `DSD_RATIO`);
  the confined-water 4:1 number is recorded for reference, unenforced. A certified assistant aboard
  buys an intro session no extra seats; only another instructor does.
  Applies to **every agency** — unlike the entry-level ratio below, the *reason* this figure is
  tighter (participants with no prior water time) does not depend on whose logo is on the course, so
  an SSI Try Scuba and a NAUI intro session take the same cap. An intro session stays gated **even
  if a `minimum_certification_level` was typed onto its course row**: nobody on a DSD holds a card,
  so a stray value must not switch the tightest cap in the product off.
  See `src/lib/course-ratios.ts`,
  [20260802-dsd-instructor-manual-ratio](../architecture/decisions/20260802-dsd-instructor-manual-ratio.md),
  and [20260724-course-admission-standards](../architecture/decisions/20260724-course-admission-standards.md).
  Before HD-6 resolved, DSD was mistakenly held to the looser 8→12:1 Open Water figure.
- **Entry-level in-water ratio** — PADI's published maximum for **Open Water Diver training
  dives**: **8 students per instructor**, extendable by **2 per certified assistant** (a
  Divemaster, in DiveDay's role model) to a ceiling of **12 per instructor**. Enforced as a
  booking gate (`src/lib/course-ratios.ts`, H-08) on a **PADI** course session that carries no
  `minimum_certification_level` **and is not an intro course** — intro sessions take the tighter,
  agency-independent DSD rule above. The PADI scoping belongs to this figure only: 8/+2/12 is
  PADI's published number, and applying it to an SSI or NAUI course would be a
  wrong-but-confident safety control. Continuing-education courses (AOW, Rescue, specialty) already gate on a verified
  card and PADI does not publish a comparably strict numeric ratio for them, so they are not
  ratio-capped. `courses.agency` is shop-set free text, so the PADI check is case- and
  whitespace-insensitive: a course typed `"PADI"` is gated exactly like `"padi"`.
- **Target diver:divemaster ratio** — the shop's own stated ratio, `shops.divers_per_divemaster`,
  stored as the divers half (`5` is "5:1"). Asked of every shop on its settings page and applying
  to **every** dive, fun dive or course session alike. It **binds nothing**: it refuses no booking,
  holds up no manifest, and blocks no crew change — DiveDay shows a departure against it
  (`under_target`, on the trip page's Crew panel, and as the quieter `crew_below_target` or the
  `uncrewed_departure` Today row when a booked departure carries no in-water supervision at all;
  issue #732) and sizes the Requests planner's crew suggestion by it. Everybody supervising in the
  water counts towards it, instructors included, which is where
  it parts company with the two ratios above: those split instructors from assistants because an
  agency's published cap does. **Do not confuse it with them.** The **entry-level** and **intro
  in-water ratios** are sourced safety caps that refuse a seat; this is a preference, and a shop
  cannot loosen a published cap by typing a bigger number here. It replaced "Divers per departure"
  (`shops.shore_group_size`), which only a shop with no boat was asked for.
  See `src/lib/divemaster-ratio.ts` and
  [20260820-shop-divemaster-ratio](../architecture/decisions/20260820-shop-divemaster-ratio.md).
- **Refresher / ReActivate** — short course for certified divers returning after inactivity.

## Operations

- **Operational horizon** — the single forward window every readiness surface reads: now through
  seven days out. Today ranks the work inside it in both of its views, and the nav's blocked-diver
  badge counts the same set — so a diver cleared on one is cleared on all of them. Anything past it
  is Schedule's job, not a triage list's. Defined once in `src/lib/operational-window.ts`; each
  surface derives its bounds from there rather than declaring its own. Reports is deliberately
  outside this model — a calendar month is genuinely its job.
- **Not ready** — the **by-departure view** of Today's work queue (`?view=departures`), not a page
  of its own: the same blocked divers the urgency view ranks chronologically, grouped instead under
  the boat each one holds up, with a per-departure batch waiver send. It had its own route until
  ADR 20260803-not-ready-is-a-view folded it in; that URL now redirects. "Not ready" names the
  *view*; an individual diver's status is **Blocked** or **Ready**, never "Not ready".
- **Close-out** — the end-of-day ritual, and Today's evening mirror: one surface
  (`/shop/<slug>/close-out`, ADR 20260804-day-closeout) where staff confirm the day actually
  ended — every departure's end state read off the same roll-call evidence Today chases, today's
  unresolved queue rows each given an explicit **carry** or **dismiss**, and tomorrow's first
  blockers as the parting glance. Closing the day is a **recorded act, never a gate**: an
  append-only `day_closeouts` row remembers who closed, when, and exactly what was outstanding,
  and nothing anywhere conditions on it — a dismissed item resurfaces tomorrow if it is still
  true, and re-opening is just working again and closing again. An open after-dive head count or
  a boat still out makes the close *loud* (a by-name acknowledgement before the button) but never
  impossible: the human is the authority on their own day, and the count stays chased either way.
  readiness check has. Every *live* surface that shows one — roster, counter check-in, manifest,
  departure board — uses these words and one tone per state (blocked is always danger), resolved
  through `readinessStatusText`/`readinessStatusTone` in `src/i18n/readiness-labels.ts`. The same
  fact used to read as "Needs attention" in warning at the counter and "Blocked" in danger on the
  manifest, for the same diver. **The offline manifest is a deliberate exception**: it says
  "Ready when saved" / "Blocked when saved" (`shared.offlineManifest.single.readyBadge`) rather
  than resolving through those helpers, because a snapshot on a boat with no signal cannot know
  whether a waiver was signed or a card sighted since it was taken. Dropping the qualifier there
  would be the one lie a roll-call surface must not tell — a stale copy reading as current
  (design/principles.md #4, "safety surfaces keep their precision").
- **Shop day scan** — the coarse ±26-hour bound (`shopDayWindow`, `src/lib/operational-window.ts`)
  a query casts when the question is about the shop's own *calendar date* rather than a horizon —
  today's boat, for the command palette's boarding jump. SQL cannot ask "same day in this shop's
  timezone" of a UTC column, so the scan over-fetches and the caller filters by shop-local date.
  Twenty-six hours is what a local day can span either side of any instant inside it, plus slack
  for a daylight-saving transition. Never a readiness lens.
- **Arrivals window** — counter mode's narrower lens on the operational horizon: departures from six
  hours ago through the next thirty-six. The backwards reach is the one deliberate asymmetry (a
  diver still walks up to the desk for a boat that already sailed); forwards it never outruns the
  horizon, so a departure can never reach **check-in** without also appearing in both of Today's
  views.
- **Check-in** — a staff-recorded arrival state for a booked diver. It confirms the live readiness
  result at the counter and changes the booking to `checked_in`; it is not boarding, which remains
  a separate departure-time manifest decision.
- **Working shift** — a dated availability window for a staff member. It is not a crew assignment:
  the shift says who is available, while the trip assignment says who is actually on that
  manifest. Overlapping shifts for one person are rejected.
- **Crew gap** — a scheduled trip with nobody rostered on it, or a course session `courseCrewGap`
  reports as instructorless or booked past its ratio. It is a prompt for staff, not a boarding
  authorization by itself. **Today owns it**: Today names it (`instructor_missing`) and its
  departure board is where crew are assigned. The shift roster only counts them —
  "N departures in this window still need crew" — and links across
  (ADR 20260806-staffing-is-the-shift-roster). A **different** gap, the shop's own **Target
  diver:divemaster ratio** below, fires `uncrewed_departure`/`crew_below_target` instead —
  `courseCrewGap` wins when both would apply to the same course session, so one departure never
  carries two rows for one underlying fact (issue #732). Formerly "coverage gap", which named a second
  vocabulary that no longer exists.
- **Integrity-sealed waiver** — a signed waiver whose immutable metadata and template snapshot have
  a matching server-sealed HMAC. `unsealed` means legacy or imported evidence has no seal yet;
  `invalid` means staff must stop and investigate.

- **Trip / charter** — a scheduled boat outing to one or more **dive sites**; commonly a
  "two-tank" (two dives with a **surface interval** between). Has capacity, staff, prep needs,
  and minimum cert requirements per site (e.g. AOW for a deep wreck).
- **Trip series** — a repeating charter ("every Saturday two-tank", "Monday and Thursday", "every
  day") scheduled in one action. The series records only the cadence — which weekdays, how many
  weeks apart, and an optional last date; **no last date means the run simply keeps going**. Each
  date is materialized as its own independent **trip** that starts identical to the rest and is
  booked, crewed, edited, moved, or cancelled on its own. See
  [20260719-recurring-trip-series](../architecture/decisions/20260719-recurring-trip-series.md) and
  [20260810-open-ended-recurring-trips](../architecture/decisions/20260810-open-ended-recurring-trips.md).
- **Horizon** — how far ahead a repeating trip's dates are actually on the board (120 days). Not a
  limit on the run: a nightly pass keeps the window full ahead of today, so an open-ended series
  never runs out.
- **Skipped occurrence** — a date staff deleted outright from a repeating trip. Recorded so the
  horizon never puts it back (`trip_series_skips`); cancelling a date, by contrast, keeps the trip
  and can be reinstated.
- **Seat claim** — a party member taking over one seat of a party booking as their own identity,
  through a bearer `/claim/[token]` link the organizer shares (a `claim`-purpose
  `booking_capabilities` row; [20260804-seat-claim-links](../architecture/decisions/20260804-seat-claim-links.md)).
  Claiming re-points the seat's existing booking at the claimant's own person record and starts
  their own waiver and trip prep; the organizer's surfaces show which seats are claimed. It never
  creates or frees a seat, never moves money, and is never required — an unclaimed seat boards
  under the organizer's party exactly as before claiming existed.
- **Wait list** — a record of divers who asked to hear if a full trip frees a seat. It is not a
  booking, does not consume capacity, and never appears on a manifest. It is also **not a queue**:
  joining buys no standing, and staff invite whoever fits the departure. The join date is kept and
  shown to staff, so the longest wait is visible without being owed anything
  (ADR 20260813-wait-list-is-a-lead-list).
- **Last-minute list** — a shop-wide (not per-trip) opt-in of divers who want to hear about
  last-minute deals, each with an optional date range they said they're around. Distinct from the
  **wait list**: the wait list is per-trip interest in a charter that's already *full*; the
  last-minute list is a general "I'm around, tell me if something opens at a discount" signal used
  to fill a trip that is *under* capacity. See
  [20260727-last-minute-fill-promos](../architecture/decisions/20260727-last-minute-fill-promos.md).
- **Last-minute deal** — a staff-sent, time-boxed discount on one under-capacity trip: a real Stripe
  `Coupon` + `PromotionCode` created on the shop's connected account (percent off, expiring at the
  trip's departure, capped at the trip's open-seat count), emailed to every last-minute-list entry
  whose date range covers the trip. The diver redeems it by typing the code on the booking form; it
  is validated against that specific trip before being handed to Stripe Checkout, so a code issued
  for one trip cannot discount a different one. See
  [20260727-last-minute-fill-promos](../architecture/decisions/20260727-last-minute-fill-promos.md).
- **Dock call time** — how many minutes before departure a shop asks divers to arrive, for gear
  setup, cert checks, and the briefing (`shops.dock_call_minutes`, default 30). Configurable per
  shop in settings because real muster times vary; it drives the arrival copy on booking
  confirmations, the diver's dock-day rhythm, and every pre-trip reminder, so no surface hardcodes
  "30 minutes".
- **Export bundle** — the self-serve ZIP of the shop's records as documented RFC-4180 CSVs plus a
  README manifest: people and roles, all certification kinds, trips with their boarding gates and
  crew, series, bookings with payment state, wait lists, the roll-call ledger, waiver templates
  and signed records (attester included), rental fit, orders and their lines, any **prior visits**
  and separately labelled **imported payment history** from a previous system, and the shop's
  dive-site library and course catalog — soft-archived history included, credentials never. Leads
  with `contacts.csv`, a flat one-row-per-person file (names pre-split, best card with its
  verification status, nitrox flag, sizes, date of birth) shaped for another system's import
  wizard, so leaving never means hand-merging CSVs. It carries every diver's date of birth where
  one is on file, minors included — a deliberate part of "the whole record leaves with you", and
  why the download is owner/manager-gated. Every image URL any CSV references that DiveDay's own storage
  actually holds is also included as a real file under `photos/`, at the URL's own path, so a photo
  or safely re-stored imported receipt survives after the account closes — a pasted external link or
  bundled template asset stays a reference only (20260724-export-bundled-photos).
  Gated to owner/manager because it carries the
  roster's complete medical evidence, which staff surfaces never show in full. The "leave anytime"
  half of the data-portability strategy; its CSV schemas are the contract the planned importer and
  read API reuse. See [20260722-full-shop-export](../architecture/decisions/20260722-full-shop-export.md)
  and [20260724-export-bundled-photos](../architecture/decisions/20260724-export-bundled-photos.md).
- **Backup destination** — the S3-compatible bucket a shop points its weekly backup at: endpoint,
  region, bucket, optional key prefix, and a credential of the shop's own, whose secret half is
  sealed at rest (`src/lib/secret-box.ts`) and never shown back to anyone. One per shop, gated
  like the export download because what it receives is the full **export bundle** (with the
  shop-wide `trips.ics` riding along). Configured at Settings → Backups.
  See [20260804-shop-owned-backup-export](../architecture/decisions/20260804-shop-owned-backup-export.md).
- **Backup delivery** — one recorded attempt to put a week's bundle in the shop's backup
  destination: scheduled (the weekly cron) or manual (a staff test run), with a started → succeeded
  or failed lifecycle, byte count, object key, and a coded failure reason the settings page
  translates. At most one *succeeded scheduled* delivery exists per shop per ISO week — that is the
  cron's idempotency rule — and a failed week's retry is simply the next weekly run.
- **Dive site** — a **place**, saved once in the shop's own library (`dive_sites`) and reused by
  every trip that goes there: map or route imagery, point-of-interest landmarks, visual field
  guide, depth, local context, and the site's own certification demands. Evergreen by
  construction — a site entry never carries a date, because *dated* conditions (water
  temperature, visibility, surface state) belong to the charter that sailed, not to the reef.
  A shop's library is at Dive sites; DiveDay's published starting points are the **common-site
  catalog**, and importing one makes an independent copy the shop then owns.
- **Dive briefing** — what a diver reads (and the crew says) about **one tank on one dated trip**:
  the `trip_dives` row, rendered from the site's saved notes plus whatever the crew wrote for that
  particular dive. There is one briefing per *planned dive*, so a two-tank trip always has two —
  and it may visit two sites, the same site twice, or one site with the second tank still open.
  **"One dive site, two dive briefings" is therefore a normal, correct state**, not a mismatch: it
  is a two-tank day whose second site the crew has not chosen yet, and every surface that shows it
  says so in those words (`summarizeTripDiveSites`, `src/lib/trip-dives.ts` — one answer, shared by
  the public schedule card, the staff trip page, and the per-dive cards on the booking page).
  A blank dive is a deliberate published plan, never missing data.

  Two rules keep the pair legible. **The interface has exactly one word for the thing staff pick —
  *dive site*** — so every picker, label, and empty state in the library says that, and *briefing*
  survives only where briefing content is written or read (the site editor's "Underwater
  briefing", the diver-facing per-dive cards). And **no surface answers "where does this trip go"
  from `trips.dive_site_id`**: that column is dive one's site copied onto the trip row for the
  forecast point and the calendar feed's location, so reading it named one site for a two-site day
  and named *none* on the day whose open tank happened to be the first one.
- **Predicted conditions** — crew-entered expectations for one dated charter, such as water
  temperature, visibility, and surface state. It is a briefing rather than a live guarantee;
  the crew makes the final go/no-go call.
- **Automated marine outlook** — a provider-generated, date-specific planning fallback shown only
  in the ten days before a charter when no crew prediction exists. It states its source and valid
  time, never makes a go/no-go call, and yields completely to a crew prediction. It supplies water
  temperature and a **sea state** — three values, none of them a judgement: wave height, the
  direction the waves come *from*, and the wave period. Underwater visibility remains a crew
  observation. Two conventions worth stating, because both are easy to get backwards and neither is
  visible in the number: the height is **significant wave height** (the mean of the highest third,
  which is what every marine forecast means by "seas" — individual sets run roughly 1.5–2× it, so
  the product says *seas*, never *waves*), and the direction is where the waves are **coming from**,
  not where they are going. The going-toward convention exists, but it belongs to current.
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
- **Progression order** — the order the staff course roster lists a catalog in: each course's own
  `minimum_certification_level`, entry-level first (a taster before the Open Water it leads into),
  then title. It is a *reading* of the catalog, not a second stored artefact, so it can never drift
  from what the courses actually require. The shop-built **certification path** it replaced —
  hand-ordered rungs in their own tables, with public pages of their own — was removed on
  2026-08-05 ([remove-certification-paths](../architecture/decisions/20260805-remove-certification-paths.md));
  progression order is guidance in exactly the same way, changing what is *shown* first and never
  who may enrol.
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
  cleanly. An after-dive head count that is not closed is chased, not merely displayed: Today
  raises it and the schedule board badges the departure — **for crew as well as divers**. It comes
  in six distinct kinds, which are deliberately never worded or ranked alike — see **unaccounted
  for** below.
- **Pre-departure checklist** — a shop-authored, ordered list of lines a crew confirms once before
  a boat leaves the dock (emergency oxygen, life jackets, a fire extinguisher — whatever the shop's
  own flag state and vessel class require). DiveDay writes none of the content; a shop types its
  own list in Settings. Distinct from **roll call** in every way that matters: it happens once per
  departure rather than once per dive, it is never a per-*person* record, and it **informs, never
  gates** — an unchecked item cannot refuse a departure from sailing or a page from rendering,
  matching the stance the gear register's service clocks already take (whether it *should* gate is
  an open owner decision, H-51). It rides the same offline queue roll call does, as a second event
  array rather than a widened roll-call event, and its own answer — checked, by whom, when, or
  explicitly not checked — is what the **departure log** prints.
  See [20260824-pre-departure-safety-check](../architecture/decisions/20260824-pre-departure-safety-check.md).
- **Souls on board** — the industry's (and the coast guard's) term for how many *people* a vessel
  left with: divers plus crew, one number, no distinction between who paid and who works. It is
  printed at the top of the paper manifest and nowhere on screen, deliberately. On paper it is a
  **static** fact about the departure — how many the trip carries, how many crew it names — never a
  live roll-call count, because a "Boarded 6" printed at 07:12 is wrong by 07:20 and paper cannot
  correct itself. The screen answers the live question, in the checkpoint panel.
- **Departure log** (was "incident-ready export" until 2026-08-12) — the print-optimized document a
  shop hands to authorities or insurers after a departure, generated from close-out: the manifest roster with each person's per-checkpoint roll-call state, the
  **pre-departure checklist**'s own answer for each shop-defined item (checked, by whom, when, or
  explicitly not checked), the
  complete append-only roll-call timeline (corrections included), certification evidence as held,
  waiver **status** (state, date, template version — never the medical questionnaire's answers),
  the **buddy pair** staff recorded for the departure — a stable team number, the buddy's name,
  and who recorded the pairing when, since a pairing decided at the dock and one typed in that
  night are different facts (the live manifest's split-pair alert is deliberately not restated,
  because it reads a merely-unrecorded buddy the same as one a human stated was not back aboard)
  — crew and crew counts, and generation metadata. It reports
  recorded facts with timestamps and
  computes no safety judgment; every absence is stated ("Awaiting", "No certification evidence on
  file") rather than left blank. A SHA-256 **integrity code** over the printed facts sits in the
  footer — tamper-evidence, not a signature: regenerating the export from unchanged records
  reproduces the code, so two copies can be checked against each other. Staff-only, one tap from
  the manifest (`/shop/<slug>/trips/<id>/incident-export`).
- **Unaccounted for** — the six ways a head count can be open, in descending severity. A person is
  accounted for at an after-dive checkpoint **only if their latest live result there is
  "boarded"**; nothing else closes that count, and the rule is the same whether they hold a booking
  or a roster line.
  1. **Missing diver** — a crew member explicitly marked someone *not back aboard* at an after-dive
     checkpoint. A human said a diver did not return to the boat: the loudest row the app has.
  2. **Missing crew** — the same statement about a named **crew member**. The divemaster who went
     back down for a lost weight belt and has not surfaced is this row. It sits beside the diver
     row rather than below the clerical ones, because the crew are the people most reliably in the
     water.
  3. **Unfinished head count** — a diver who boarded at departure has no result at an after-dive
     checkpoint (a `cleared` undo counts as no result). Nobody said they are missing; nobody said
     they are aboard.
  4. **Unfinished crew count** — the same, for a crew member who boarded at departure.
  5. **Unfinished dock count** — the departure count was never finished. The boat is home and nobody
     was ever unaccounted for in the water: this is paperwork, and it is toned and ranked as such.
  6. **No roll call** — the trip has no roll-call events at all, of either kind. A shop not using
     the feature, not a lost diver — but never read as an all-clear either.
  Kinds 1–4 are the ones that can mean a person is still in the water, so they also raise on a
  trip *still underway* whose checkpoint was started and abandoned (at least one result and at least
  one person awaiting), and they never age to nothing: past the 48-hour dock-work window they drop a
  band and say plainly that the count was never closed. Kinds 5 and 6 are chased for 48 hours only.
  The population an after-dive count is counting is **who boarded**, never who bought a seat or was
  rostered — a diver who never showed and was never tapped is an unfinished *dock* count, not
  somebody left in the water, and a shop that has never tapped a crew roll call raises no crew rows
  at all rather than one on every trip it has run. The queue chases the whole
  crew half — the named results themselves. An open checkpoint held only because nobody is *aboard*
  (an empty crew list, or a whole crew marked ashore) raises no queue row: it fires on trips whose
  crew was never recorded at all, and would bury the rows that mean a person is in the water. The manifest states it; the queue chases what somebody
  actually recorded.
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
  own event so the correction stays in the audit trail rather than deleting history. **Cleared is
  emitted offline too**, and it is the reason it has to be: without it the only way to take back a
  mis-tapped "not back aboard" was to tap "aboard" — a positive claim that a person is back on the
  boat, which nobody had made. **A retraction is scoped twice.** A device may only retract a statement
  *that same device queued*; a mark that arrived on the saved copy says so instead, because the
  device cannot know what the crew who recorded it saw. And the queued retraction **names the
  statement it undoes**, so the server applies it only while that statement is still the one
  standing — otherwise a device that queued a mark, synced it, and retracts it an hour later could
  unsay whatever a second device has recorded since. A retraction can therefore come back
  **refused**: after a dive the mark stays up and the row says to undo it where it was made, and at
  the dock — where "not boarded" means *never left*, an accounted-for state that carries forward —
  the row goes back to awaiting rather than closing every later checkpoint on a statement the server
  has moved past. Asserting **aboard over a stated "not back aboard"** takes a
  confirming second tap that names the person, on a separate control, so a wet thumb on a rolling
  boat cannot turn the loudest row in the product green by bouncing. A note still
  being typed is also mirrored to the crew's own device and cleared once it syncs, so a dropped
  connection never loses it; that device draft is transient and unencrypted — separate from, and not
  protected like, the encrypted **offline manifest snapshot**.
- **Crew roll-call event** — the crew half of a head count: a named staff member said one **assigned crew
  member** is aboard, not aboard, or cleared, at one checkpoint. Same append-only history, same
  supersession, and the same two meanings of "not boarded" as a diver's roll-call event; the subject
  is a person on the trip's crew list rather than a booking, which is why it is its own table
  (`roll_call_crew_events`) and `roll_call_events.booking_id` stays `NOT NULL`. It exists because a
  count **names nobody**: "3 of 3 aboard" cannot tell the boat that the third body is the deckhand
  rather than the divemaster who has not surfaced — which is why it is now the *only* crew evidence
  a checkpoint reads. A trip with **no crew assigned is not exempt**: an empty crew list holds the
  checkpoint open, because it is a scheduling gap rather than evidence nobody else was aboard, and
  the manifest answers it with "Add crew to trip". **No longer read-only on the offline copy**: the
  crew half records aboard, not aboard and cleared on the device exactly as the diver half does, and
  a crew member with no saved result reads as still-to-call. A subject must be assigned to the trip *and*
  either hold a staff role **or already carry a result on that trip** — one condition
  (`isOnTripCrew`) the crew list reads through as well, so a result can never exist about somebody
  the head count cannot see, and somebody the head count is counting can never vanish out from under
  a result. Once somebody has one they **cannot be taken off the trip's crew**, and **leaving the
  shop does not remove them from trips they already crewed**: either would let a checkpoint that is
  open because they did not come back read complete. Employment ends; who was on the boat does not.
- **Buddy team** — two or more people staff group together on one departure, so roll call can say
  the thing a deck actually watches for: **someone is back aboard and someone on their team is
  not**. A member is either a *booking* (a roster entry of that trip) or a *crew person* — the
  divemaster leading the group holds no booking, and before crew could be members a diver
  deliberately placed with a DM printed on the departure log identically to a diver nobody
  paired. Membership is a decision about this boat, never a standing relationship.
  **Nothing above two is refused**; a team of one is, because a team needs someone to be a team
  with. A **diver** is on at most one team per departure — the invariant that keeps the manifest
  unambiguous — while a **crew member may be on several**, because one divemaster commonly leads
  more than one group, which is how guided diving runs. An unteamed remainder is a normal boat,
  never an error, and plenty of shops record no teams at all. Every act is explicit: adding an
  already-teamed diver is refused until staff dissolve first, a removal that would leave fewer than
  two is refused (dissolving is its own act), and each of forming, adding, removing, and dissolving
  appends to an **append-only pairing trail** carrying the member names as they stood at that
  moment — so who was paired with whom survives the membership rows a dissolve deletes, and the
  departure log renders it in the roll-call timeline. The split-team state (`separated_dock` as a
  boarding heads-up, `separated_after_dive` as the loud one) **informs and never acts** — it plays
  no part in readiness, admission, capacity, or whether a checkpoint reads complete, and it messages
  nobody. The offline manifest shows teams read-only by name and states that the split-team read
  belongs to the live roll call — a saved snapshot cannot know who came back.
  See [ADR 20260804-buddy-teams](../architecture/decisions/20260804-buddy-teams.md).
- **Per-trip crew role** — what a crew member is rostered to *do on one sailing*
  (`instructor`/`divemaster`/`captain`/`crew`), as opposed to the shop-wide roles they hold. Unset
  means **not specified**, which counts exactly as it always did, by shop-wide inference — never a
  claim that anyone is or is not in the water. It can only ever *narrow* what someone is worth to
  the in-water ratio: the roster says which job they are doing, `person_roles` stays the evidence of
  what they are qualified to do, and the count takes the lesser. A divemaster rostered as this
  trip's captain is therefore not a **certified assistant** for it (see
  [ADR 20260803-per-trip-crew-role](../architecture/decisions/20260803-per-trip-crew-role.md)).
  Set on the trip's crew section, per person, from the job picker beside their name. Both crew write
  paths refuse to leave a course session with nobody on the ratio, so rostering the session's only
  instructor onto the deck is refused exactly as removing them is — the two say the same thing about
  the session. Unassign-then-reassign does not preserve it: the row and its role go together, and
  the picker is how it is set again.
- **In-water certified assistant** — a Divemaster actually supervising students in the water on this
  trip; each one extends the **entry-level in-water ratio** by two students per instructor. A
  person holding both instructor and divemaster roles is counted as the instructor, never as their
  own assistant. One definition, `countInWaterCrew` in `src/lib/crew-roles.ts`, shared by the
  booking gate, the trip page, the Today queue, and — through Today's own reader — the shift
  roster's crew-gap count.
- **Roll-call checkpoint** — one independent head count: before departure or after a numbered dive.
  A two-tank charter has three checkpoints. Each checkpoint is re-verified against the bodies on the
  boat; a **boarded** result never carries into the next. **"Not boarded" means two opposite
  things depending on where it is recorded**, and they must never be treated — or worded — alike:
  at **departure** it means *never left the dock*, which is benign and genuinely accounted for; at
  an **after-dive** checkpoint it means *did not return to the boat*, which is the missing-diver
  event itself and opens the count rather than closing it. Only the departure meaning carries
  forward: once a diver is marked not boarded at the dock, later checkpoints default to not boarded
  (shown as "carried forward") until staff explicitly re-board them — a diver who left the boat is
  presumed still ashore rather than resetting to awaiting. The default is always flagged as carried,
  can never imply "present," and staff can override it at any checkpoint. A checkpoint is
  **complete** only when every booked diver is **accounted for** — which is not the same as having a
  result, since a diver recorded as not back aboard has one and is precisely the person who is
  missing — *and* every assigned crew member is accounted for individually, *and* at least one of
  them is actually **aboard**. Divers alone were never the whole boat. The last clause is what stops
  the two shapes of an empty boat from closing themselves: a trip with nobody on its crew list, and
  a trip whose whole crew is marked ashore. Both are a departure that sailed with nobody recorded
  running it, which is stronger evidence of an unrostered hand than of an empty boat. A count-level
  crew *attestation* ("crew aboard: 2 of 2") preceded this and is gone, table and all — a number
  that named nobody could not help anyone find a missing person
  ([ADR 20260804-crew-roll-call-is-per-person](../architecture/decisions/20260804-crew-roll-call-is-per-person.md)).

  A departure-checkpoint result also changes what Today's departure card says about a **blocked**
  diver, and the split is worth knowing: blocked-and-**aboard** is the more serious of the two — the
  gate is behind them, not in front — and leads the card; blocked-and-**ashore** keeps the "cannot
  board yet" wording; a diver marked **not boarded** stays in the ashore group until an hour past
  the scheduled departure, because until the lines are off "not boarded" still reads as *isn't
  aboard yet* to the deckhand tapping it, and the desk can still chase them. The card may go quiet
  about a blocker once the boat has gone; it never says everyone is clear while one stands.
- **Offline manifest snapshot** — a time-stamped, encrypted device copy of the complete derived
  manifest and every checkpoint, saved and refreshed automatically while the device has signal
  (staff can also force an immediate "Refresh now"). It is safety evidence as saved, never an
  editable roster or a claim that server-side readiness has not changed, and never manually
  deletable — it expires on its own retention schedule. In the UI its freshness tiers surface as
  **Fresh copy** (saved within 15 minutes), **Aging copy** (within 4 hours), and **Stale copy**
  (older) — the user-facing words for the current/aging/stale thresholds; "snapshot" itself never
  appears in user copy. A shop's near-term board auto-saves as a set, not one trip at a time:
  visiting any staff page saves a snapshot for every trip departing in the next 48 hours, not only
  a trip whose own live manifest someone opened. See
  [20260726-shopwide-offline-manifest-priming](../architecture/decisions/20260726-shopwide-offline-manifest-priming.md).
  The offline shell (`/offline-manifest`) lists every
  saved trip on the device (soonest departure first) when opened with no specific trip chosen, and
  the root path (`dive.day`/`/`) falls back to that list — instead of the browser's own offline
  error — the same way the live manifest route already falls back to its own trip's copy.
- **Reconciliation** — applying a device roll-call event to the live append-only history after
  reconnecting. The server rechecks staff, tenant, booking, checkpoint, and current readiness;
  duplicate events are idempotent and an older device event cannot replace newer live history. An
  **equally**-timestamped one is applied rather than refused, and both the device and the server
  then resolve the tie the same way: in the order the device queued the events, so the later tap
  wins. That is what lets a crew member who marks the wrong row and corrects it within the same
  millisecond keep the correction, on the screen and after the sync alike — and it is a rule with
  two halves that have to agree, so changing either one alone is a bug. On the server side that
  order is now a property of the rows rather than of the clock's resolution: `roll_call_events` and
  `roll_call_crew_events` carry a monotonic `seq` that is the final ordering key everywhere they are
  read, because `created_at` is *transaction* time and a synced offline batch ties on it exactly.
  A **rejected** device event is the one asymmetric case: it may never *downgrade* a "not back
  aboard" that a non-rejected source states — silently demoting a missing diver to "awaiting" is the
  one direction that takes an alarm off the screen — while it still may never resurrect a superseded
  "aboard", which is the stale optimism reconciliation exists to overrule.
- **Boarding** — the fast pre-departure pass: get every ready diver aboard before the boat leaves,
  waiver/cert/payment confirmed at a glance. It is not a separate surface — it is the **Manifest's**
  "Before departure" checkpoint, where readiness pills and a resolve-blockers link show alongside the
  roll call. Boarding a diver there is the same roll-call event as any later checkpoint. Day-of entry
  points (Today's departure card, the command palette's "Boarding" jump) open the manifest on that
  checkpoint. Crew, emergency contacts, after-dive roll call, print, and the offline snapshot are all
  on the same page.
- **Waiver / release** — the single liability release a shop uses, typically with a **medical
  statement**. DiveDay keeps one versioned release per shop: a *changed* release saves a new immutable
  version and new links snapshot the current one. The exact template version is snapshotted into each
  issued record; a signed record is immutable and a replacement link creates a new record. Some
  answers on the medical form require a physician sign-off — that's a blocking state, not a checkbox.

  **Publishing a version invalidates every standing signature at the shop, at once.** A signature is
  held against the version it was signed on, so a new version leaves every booked diver on every
  forward departure blocked until they sign again. That is why re-saving *identical* text publishes
  nothing at all — trimmed, newline-normalised and Unicode-normalised, so a paste from Word that
  differs only in Unicode form is not an edit — and why the editor says, before the tap, how many
  **divers** a real edit is about to put back in the queue and how many of those board inside the
  **operational horizon**. Divers rather than signed records, because one diver can hold several
  standing records and it is people who have to sign again; the second number because a shop that
  must publish a legally revised release will publish it either way, so the question it actually
  faces is which boat this lands on (issue #790). Whether a shop may declare an edit
  *non-material* and keep those signatures is an open legal question (H-01/H-03), not a gap.
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
  never a checkbox. Recorded from a **seat** (a trip's roster, the check-in queue) or from the
  **diver** (their own record), which is the same record either way — a diver who has booked nothing
  yet can still hand over a signed release, and the record simply names no booking. See
  [20260811-person-scoped-paper-waivers](../architecture/decisions/20260811-person-scoped-paper-waivers.md).
- **Imported waiver acceptance** — a contact-import row explicitly claiming a diver already accepted a
  waiver (medical clearance included) at a prior shop. DiveDay trusts that claim and writes the same
  immutable completed record any signature produces, marked `signatureMethod: "imported"` so it is
  never confused with a release DiveDay itself watched a diver sign or a staff-attested paper copy.
  Unlike the paper path, **no staff attestation is required** — a deliberate, knowingly-made
  product-owner decision (H-17 in human-decisions.md) that reverses the contact importer's original
  fail-closed medical rule. It carries the diver's real acceptance date when the row gives one (still
  subject to the one-year signature-validity window), snapshots the shop's *current* template for
  reference only (the diver never agreed to that text), and is never fabricated from a source
  "verified" flag alone — it requires an explicit `waiver_accepted` claim. See
  [20260724-import-waiver-acceptance](../architecture/decisions/20260724-import-waiver-acceptance.md).
- **Medical questionnaire** — the versioned diver-medical form a waiver presents, selected by the
  shop's **jurisdiction** (the 2026 UHMS/DMSC RSTC participant form by default). Defined as data
  in `src/lib/medical.ts`; a completed waiver stores the questionnaire id + version and the
  server-side yes/no answers, so a later edit never re-interprets signed evidence. Questions 3,
  5, and 10 and the affirmative answers in an applicable Box are
  physician referrals; a parent question can therefore be yes and still clear when its Box is all
  no. Unknown or incomplete questionnaires **fail closed** (review required), never waved through.
- **Waiver activity** — the staff-facing chronological explanation of stored waiver evidence:
  a link was issued, a diver started, signed, needs medical review, or had a pending link replaced.
  It is derived from timestamps on the evidence records and never exposes the raw completion token.
- **Transactional notification** — a single-recipient operational message such as a booking
  confirmation or a staff-issued waiver link. Delivery is helpful but never changes the booking or
  waiver evidence; a delivery failure must not undo the underlying operation.
- **Notification delivery status** — the latest known send result for one booking and notification
  purpose. It lets staff see an unresolved email issue; it is not proof of inbox delivery or a full
  provider event history.
- **DAN** — Divers Alert Network; dive accident insurance divers may carry. Captured as the
  free-text `people.dive_insurance` field (DAN or any provider) and shown on the diver profile — a
  safety detail for the crew, never a boarding gate.
- **Connected Stripe account** — a shop's own Standard Stripe account, authorized once via OAuth.
  The shop keeps its own Stripe dashboard, payouts, and tax reporting; DiveDay never holds the money
  and acts on the shop's behalf only through the `Stripe-Account` header the OAuth grant enables.
  See [20260719-stripe-connect-orders](../architecture/decisions/20260719-stripe-connect-orders.md).
- **Order** — a shop-issued bill for a customer: one or more line items (a trip fee, course fee,
  rental, nitrox, deposit, or free-form charge) against a person, optionally tied to a booking. Local
  status (`open`/`paid`/`void`/`uncollectible`/`refunded`) mirrors the Stripe invoice backing it. A trip's
  optional per-diver price pre-fills the trip-fee line item when an order is started from a
  booking's roster row — staff can still edit the amount or add more line items before sending.
  **Raising** one is owner/manager work, like the refund it may later need — every staff role can
  read orders, but billing a diver on the shop's own Stripe account is not deck work
  ([20260803-invoicing-role-gate](../architecture/decisions/20260803-invoicing-role-gate.md)).
- **Imported payment history** — an unverified payment, refund, receipt, or source Stripe reference
  carried from a prior system. It appears in its own section of Orders and may contribute to the
  clearly labelled source portion of a monthly net-revenue figure only when its date, direction,
  amount, and currency are unambiguous and its currency matches the shop's report. It is never a
  DiveDay order, booking payment, Stripe confirmation, reusable card credential, or readiness fact;
  its stored reference is a reconciliation clue only. See
  [20260816-imported-payment-history-is-evidence](../architecture/decisions/20260816-imported-payment-history-is-evidence.md).
- **Payment event** — one recorded *transition* of a booking's payment state: what it moved to,
  what it moved from, the amount and currency at that moment, and which operation caused it. The
  append-only trail (`booking_payment_events`) beside the single mutable `booking_payments` row,
  which carries only where the money stands now and which a refund overwrites in place. Written
  inside the same transaction as the mutation it records, so the two commit or roll back together.
  "Transition, not write" is the load-bearing distinction: a webhook redelivered twice appends
  nothing the second time, and a refused write appends nothing at all, so a row here always means
  the state genuinely changed — otherwise the money ledger would slowly become a delivery log.
- **Retention window** — how long one append-only table's rows are kept before the weekly prune
  deletes them. Set per table in `RETENTION_DAYS` (`src/lib/retention.ts`), which is the only place
  a human edits. Most windows are a preference; `stripe_webhook_events` is not — its rows are the
  chronological evidence an out-of-order Stripe account update is checked against, so its window has
  a floor that a test enforces against Stripe's own retry horizon.
- **Invoice** — the payable Stripe document behind an order, created on the shop's connected
  account. Staff can share its hosted link directly, or let Stripe email the customer; a webhook
  (or manual refresh) brings the paid/void result back into the order and, when the order is linked
  to a booking, into that booking's payment gate the same way a staff mark does. A paid invoice can
  be fully refunded from the diver's payment workspace when Stripe exposes its payment intent.
- **Shop currency** — the one currency a shop displays prices in and charges its divers in
  (`shops.currency`, lowercase ISO 4217, chosen in settings). Changing it **re-denominates rather
  than converts**: a 130 trip stays the number 130, now meaning 130 of the new currency, so a shop
  that switches re-checks its own price list. Amounts that already settled (orders, checkouts,
  payments, refunds) carry their own currency and are never reinterpreted. What Stripe *reports*
  for the connected account (`shop_stripe_accounts.default_currency`) is advisory — a disagreement
  is surfaced, not silently resolved. See
  [20260731-shop-currency](../architecture/decisions/20260731-shop-currency.md).
- **Minor unit** — the indivisible unit of a currency, and what every `*_cents` column counts. The
  name is historical: it is 1/100 of a dollar or euro, but a *whole yen* for JPY, which has no
  sub-unit at all. So the divisor between a stored amount and a displayed one comes from the
  currency (`src/lib/money.ts`), never from a literal 100 — a bare `/ 100` prints a ¥13,000 trip
  as ¥130.
- **Booking checkout** — the pay-at-booking path: right after a public booking (or party) commits,
  the diver is handed one hosted Stripe Checkout session on the shop's connected account for the
  per-diver price × party size. Paid state comes only from Stripe's webhook or a direct API read —
  never from the return URL — and cascades into the booking's payment gate like any other payment.
  An abandoned checkout costs nothing: the booking simply stays unpaid, exactly as if the shop had
  no checkout. See [20260721-checkout-at-booking](../architecture/decisions/20260721-checkout-at-booking.md).
- **Settled total** — what a completed checkout *actually collected*, as Stripe itself reported it
  (`booking_checkouts.settled_total_cents`, copied from the session's `amount_total`), as opposed to
  the **asked total** (`total_cents`) DiveDay quoted. The two differ whenever Stripe applied a promo
  code. Only the settled figure is money the shop received, so it is what a refund returns and what
  a revenue report counts; it is split back across a party's bookings in proportion to what each
  diver was asked for (trip fee plus their own gear), in whole minor units that sum to the total
  exactly. Null on a historical row or a completion Stripe reported no total for — callers then fall
  back to the asked amounts rather than reading null as "collected nothing."
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
- **Night-before brief** — the 24-hour reminder cadence enriched into a full pre-departure brief:
  the crew's plain-language conditions read, what to bring (the shop's packing list), a concrete
  dock-arrival time, and who to text on the day. It is the same `trip_reminder_24h` send, not a new
  kind — the cheapest cancellation-prevention tool a shop has, since most day-of no-shows are anxiety
  plus logistics confusion. Copy in `src/lib/night-before-brief.ts`; the 7-day reminder stays a light
  nudge.
- **First-timer track** — the night-before brief in a softer, what-happens-on-the-boat voice for a
  diver with no prior non-cancelled booking on a departed trip with the shop. Same data, extra
  reassurance; the signal is derived at send time, not stored.
- **Post-trip recap** — a single shareable per-diver-per-trip page (`/recap/[token]`) generated after
  the trip ends: the sites dived, the day's conditions, and a bring-a-buddy nudge. It rides the same
  delivery-row dedup as the reminders, sent once per booking as the `trip_recap` kind no earlier than
  four hours after the departure ends. The dedicated hourly recap scan (`/api/cron/recaps`) keeps that
  floor punctual without weakening it. The link is a purpose-separated signed booking token, distinct
  from the readiness link. See
  [20260723-post-trip-recap](../architecture/decisions/20260723-post-trip-recap.md).
- **Review request** — a "Leave a review" section on the post-trip recap page, shown only when the
  shop has set a single, optional outbound link (`shops.review_url`) in Settings — DiveDay never
  integrates with a review platform's API, never tracks whether a diver actually left a review, and
  never gates anything on it. Unconditional whenever a shop has one configured; no sentiment gating
  (asking a private "how did it go?" first) to avoid review-platform ToS risk. See
  [20260726-post-trip-review-request](../architecture/decisions/20260726-post-trip-review-request.md).
- **Tip** — an optional, diver-initiated payment to the crew from the post-trip recap page: a full
  100%-to-shop Stripe Checkout on the shop's own connected account, same merchant-of-record model as a
  **booking checkout** but tracked in its own `tips` table (never the booking-payment gate). A diver
  picks a preset ($5/$10/$20) or types a bounded custom amount ($1–$500); its own lifecycle is
  `pending` → `paid`/`expired`, reconciled against Stripe the same way a booking checkout is — never
  trusted from a return-URL param alone. See
  [20260726-post-trip-tipping](../architecture/decisions/20260726-post-trip-tipping.md).
- **Courtesy message** — the short text that rides alongside a trip reminder or post-trip recap, and
  the *only* channel for a diver who gave a phone number but no email. It goes out over exactly one
  of two channels, never both, chosen per shop by `sendCourtesyMessage()`
  (`src/lib/notifications/courtesy.ts`): the shop's **WhatsApp sender** when it has connected one,
  and the **SMS channel** otherwise. Any WhatsApp failure — most often a diver who simply isn't on
  WhatsApp — falls back to SMS immediately rather than being retried, because a reminder that lands
  after the boat leaves is worth nothing.
- **SMS channel** — an optional text channel for notifications, delivered through an AWS SNS seam
  (`SmsProvider.send()`, resolved by `smsProviderFromEnvironment()`). A number is texted only if it is already E.164, and the channel degrades to
  `not_configured` with no SNS credentials configured, exactly like the email seam. The platform-wide
  fallback half of a **courtesy message**. What happened to a sent text arrives later as a **delivery
  receipt**. See [20260802-sns-sms-adapter](../architecture/decisions/20260802-sns-sms-adapter.md).
- **Delivery receipt** — a provider's after-the-fact report of what became of a message DiveDay sent:
  delivered, failed, bounced. Applied to the `notification_deliveries` row by provider message id,
  guarded so a stale event never overwrites a newer outcome. Every channel reports them differently —
  email by webhook from Resend or SES, WhatsApp by webhook from Meta, and SMS *not* by webhook at all,
  since SNS writes receipts to CloudWatch Logs and an AWS-side forwarder republishes them onto a topic
  the app can verify
  ([20260802-sms-delivery-receipts](../architecture/decisions/20260802-sms-delivery-receipts.md)).
  A receipt matching no row is routine, not a fault: only a **tracked channel** has one, so a courtesy
  text sent alongside an email has nothing to update.
- **WhatsApp sender** — a shop's *own* WhatsApp Business number, connected in Settings → WhatsApp
  through **Meta Embedded Signup**: the shop presses one button and completes Meta's own hosted
  popup, and DiveDay registers the number, subscribes to its delivery events, and submits the
  message template for approval on the shop's behalf. DiveDay is not the sender; the dive shop is, so
  divers see the shop they booked with and a reply reaches that shop's own inbox. WhatsApp requires
  business-initiated messages to use an approved **template**, so the template's name and language
  are stored per shop alongside its access token, which is encrypted at rest and never readable back
  out. Dormant until Meta approves DiveDay's app — the settings page says so, and courtesy messages
  go out as SMS meanwhile. See
  [20260802-whatsapp-embedded-signup](../architecture/decisions/20260802-whatsapp-embedded-signup.md).
- **Demo mode** — a shop flagged `isDemo` gets the Demo Playground banner, its role switcher, and a
  "Reset demo data" affordance scoped to that one tenant. "Try the live demo" **mints a fresh
  `isDemo` shop per visitor** with a generated name/slug, seeded with the full sample schedule; a
  daily reaper clears minted demos after 7 days. The canonical `isDemo` shop (Blue Mantis) is
  bootstrapped in every environment as the fixture the e2e/visual-regression fleet tests against,
  and is never reaped. Onboarding a **trial** at `/onboard` creates a real shop that is *not* demo mode and is
  **never seeded** — it starts empty, with no playground banner or destructive reset (ADR
  20260724-per-visitor-demo-shops, superseding 20260718-production-demo-seed). A trial runs
  **3 weeks** from `shops.created_at` (`TRIAL_DURATION_DAYS`, `src/lib/trial.ts`), shown to the
  owner in Settings as days left / trial ended. Expiry is **soft** — the shop keeps working exactly
  as before past the window; there is no paid/trial entitlement flag in the schema to gate on.
  Moving to a paid plan is by writing to `onboarding@dive.day`, not a self-serve checkout
  (product-owner decision, 2026-08-05, [human-decisions.md](human-decisions.md#decision-register)).
- **Owner reporting / monthly report** — the owner's "how's my month" view (`/shop/[slug]/reports`):
  net revenue, bookings, **fill rate**, and **waiver completion** for the trips that departed in a
  chosen month, plus a per-trip breakdown. Trip metrics remain anchored to trip-departure month in
  the shop timezone. Net revenue starts with money actually collected on those trips' bookings
  (`paid` + `deposit_paid` payments), then may include a separately named, unverified imported
  payment/refund slice by source calendar date when its currency matches. Owner/manager only. See
  [20260723-owner-reporting](../architecture/decisions/20260723-owner-reporting.md) and
  [20260816-imported-payment-history-is-evidence](../architecture/decisions/20260816-imported-payment-history-is-evidence.md).
- **Fill rate** — seats booked ÷ seats offered. On a report it is the month's active bookings over
  the sum of its trips' capacities; on one trip it is that trip's active bookings over its capacity,
  capped at fully booked. "Active" excludes cancellations and no-shows. That is **not** the manifest
  roster: the manifest lists every non-cancelled booking, no-shows included, because a no-show is a
  name the crew has to account for at roll call (`getTripRoster`, `src/db/trips.ts`). Fill rate is a
  commercial measure of seats that earned; the manifest is a head count of who was expected aboard.
- **Waiver completion** — the share of a month's active bookings that carry a signed
  (completed, non-superseded) **waiver record**. The reporting counterpart of the per-trip roster's
  waiver gate.
- **Staff invite** — an owner/manager adding a named person to the team
  (`/shop/[slug]/settings/team`) with one or more staff roles. Reuses the shop's existing person
  record by email when there is one (a diver about to start crewing keeps their one record — see
  the Modeling notes' "a person may be simultaneously..." rule) rather than forking a duplicate.
  Mints a `user_accounts` row in **invited** status right away — visible on the team list, but
  unable to sign in, until the invitee follows their emailed link to `/invite/[token]` and sets
  their own password, which flips the account to **active**. A shop may never end up with zero
  people holding the `owner` role: removing, disabling, or demoting the shop's last owner is
  refused. See [20260726-staff-invite-accounts](../architecture/decisions/20260726-staff-invite-accounts.md).

## Rental fit and prep

- **Demand signal** — a staff-only capacity-planning prompt shown when a trip is full and its wait
  list reaches the larger of two divers or 25% of the trip's capacity. It suggests another boat or
  departure; it never creates or changes a trip automatically.
- **Private staff note** — operational context attached to a diver's booking, visible only on
  authenticated staff surfaces. It is never included in diver readiness, waiver, recap, public
  schedule, manifest export, or notifications.
- **Activity event** — an append-only staff-facing sentence describing who did operational work and
  what happened (for example, “Maya added a private note about Dana”), with the time it happened.
  Activity uses shop language, never table names or record identifiers.

- **Rental set** — typically: **BCD** (jacket, sized), **regulator** ("reg", with octopus and
  SPG), **wetsuit** (sized, thickness in mm) with **boots**, mask/fins, **weights**, a **dive
  computer**, and a **tank/cylinder** (e.g. AL80 aluminum 80 cu ft). The dive computer is default-on
  for every diver **and** part of the priced core set (H-06, reconfirmed 2026-08-02 — HD-9); the
  **GoPro** is the one off-by-default add-on, always priced separately. A diver who skips a core
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
  does not rewrite a fit a diver already recorded. The catalog is only **half** the nitrox
  answer — see **Nitrox-compatible course** below.
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
  and in *what size* (BCD, wetsuit, boot, fin, usual weighting, plus the dive-computer/GoPro add-ons).
  It is a storage concept: a fit never reserves an item, is never evidence, and never replaces a
  dock-side fit check. It is the single input to the trip prep list. Reserving a particular unit is
  the **gear register**'s separate act (below) — a shop that keeps no register still has fits, and a
  fit alone still reserves nothing.
- **Gear register** — the shop's own rental fleet as physical units (`gear_items`), opt-in **by
  presence**: a shop with zero units sees no gear UI anywhere and its prep flow is untouched, and
  adding the first unit is what turns it on — never a settings flag
  ([20260815-minimal-gear-register](../architecture/decisions/20260815-minimal-gear-register.md)).
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
  Cancelling a booking releases its un-collected units; a checked-out one stays until it really
  comes home. Assigning informs the prep page; it gates nothing at boarding. The direct-person
  shape is modeled but deliberately has no staff form yet; booking-held rows remain prep-flow
  shape.
- **Service clock** — a unit's care deadlines, derived from its append-only service events
  (`gear_service_events`): manufacturer `service`, a tank's independent `hydro_test` and
  `visual_inspection` clocks, the `o2_clean` renewal, and clockless condition `note`s. The newest
  event of a kind *is* that clock; the earliest deadline is the unit's state (ok / due soon /
  overdue), which **informs, never gates** — the dock decides whether an overdue unit dives, not
  the software. Deliberately not a work order: no parts, no labor, no billing.
- **Sizing** — BCDs and wetsuits are sized (XS–XXL and height/weight dependent), so a prep list
  groups by item *and* size; an unrecorded size is shown as a loose end, not silently dropped.
- **Complete rental fit** — a fit is complete when *every piece the diver takes from the shop* has
  the size it needs, not merely when a record exists: a diver who ticks BCD, wetsuit and weights and
  supplies only a shoe size has an **incomplete** fit, with three loose ends. One shoe size answers
  for both boots and fins. The one-size pieces (regulator, dive computer, GoPro) have no size to be
  missing. "Not recorded" (nobody asked) and "incomplete" (asked, half blank) stay distinct.
  Completeness is a prompt for staff, never a gate: it refuses nobody a seat and blocks nobody from
  boarding.
- **Needs staff fit** — the safe fallback when the shop can't fill a size a diver asked for (H-06):
  staff flag the diver for hands-on fitting at check-in instead of quietly packing a different
  size. The flagged diver keeps their line on the prep list — the count is what the packer loads
  from, so dropping them arrives a BCD short with nothing to fit them from — but the **size** comes
  off, reading "fit at check-in", and they're named in their own "fit these divers at check-in"
  section, along with the sizes they asked for — the captain doing the fit can't edit the profile
  and needs somewhere to start. Unsized pieces (regulator, dive computer, GoPro) are untouched by
  the flag; so are weights (lead is bulk stock, never a size to be short of, and usual weighting is
  the fit's most safety-relevant number) and tanks, since gas is never sized. Distinct from both "own kit" and "not asked yet" on
  a roster/manifest line, and sticky: editing sizes never clears it, only an explicit resolve does.
  See [20260724-gear-fit-fallback](../architecture/decisions/20260724-gear-fit-fallback.md).
- **Gear-request override** — rewriting what a diver themselves asked for. Reserved to owners,
  managers, instructors, and **divemasters** (`canOverrideGearRequest`) — sizing a diver is in-water
  judgement. Deliberately wider than `canConfigureTrips`, which excludes divemasters. Substituting
  a real available item, recording a diver's *first* fit (there is nothing on file to override),
  and **raising** the needs-staff-fit flag stay open to every staff member: those are the day's
  work, not an override. **Clearing** that flag is gated — it asserts the stated size packs after
  all, which is the judgement call.
- **Trip prep list** — the derived packing list for one departure: tanks (one per diver per planned
  dive, split air/nitrox) plus rental kit grouped by item and size, with the divers each line is
  for. Purely derived — nothing on it is an allocation. Rules in `src/lib/dive-prep.ts`.
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
  [20260725-checklist-age-disclosure](../architecture/decisions/20260725-checklist-age-disclosure.md).
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

## Records and evidence

- **Executed dive** — what a departure *actually* dived, as opposed to what it planned. One
  `executed_dives` row per dive number per trip, carrying the site actually visited, entry and
  exit times, max depth and observed conditions, written by crew at the rail from the manifest's
  `after_dive_N` checkpoint. Distinct from a **trip dive** (`trip_dives`), which is the *plan*.
  It informs and never gates: no readiness, admission or boarding decision reads it. It is,
  however, evidence — `buildIncidentExport` renders it into a SHA-256-sealed document for an
  investigator or a treating physician, which is why a dive nobody logged must read as *not
  recorded* rather than being interpolated from its neighbours.
- **Surface interval** — the time between one dive's exit and the next dive's entry. Only ever
  stated between **consecutively numbered** executed dives that were both recorded and do not
  overlap; anything else is "not recorded". An interval measured across a dive nobody logged
  overstates the diver's rest, which is the one direction this figure must never err.
- **Material generation** — a shop's explicit assertion that a new waiver version changes the
  bargain, and therefore that standing signatures no longer cover it
  (`waiver_materiality_decisions`, ADR
  [20260826-waiver-material-generations](../architecture/decisions/20260826-waiver-material-generations.md)).
  It is **not** the display version number: a typo or a reformat increments the version and leaves
  the generation alone, so nobody is asked to sign again. DiveDay cannot infer legal materiality
  from a text diff and does not try — a human says so. Never reason about re-signing from the
  version number.
- **Staff credential** — a professional qualification a *staff member* holds (instructor rating,
  first-aid, boat licence), with an optional renewal date that raises a Today row as it approaches
  (`staff_credentials`). Distinct from a **certification**, which is always a diver's. Renewal is
  a calendar date, so it is good through the end of its own shop-local day.

## Security

- **Step-up** — a fresh second-factor check for one sensitive act, bound to one Better Auth
  session and expiring on its own (`account_step_ups`, ADR
  [20260826-account-security-step-up](../architecture/decisions/20260826-account-security-step-up.md)).
  Three purposes: `money`, `export`, `backup`. A grant from another browser, or from a session
  since revoked, never satisfies it. Being signed in is not being stepped up; **and step-up is
  only demanded of an account that has enabled two-factor**, so it is a control a staff member
  opts into rather than a floor under every account.
- **Recovery code** — one of ten single-use strings issued at two-factor enrolment, shown once and
  stored only as a salted HMAC under the deployment's own sealing key. It is a second factor, not
  a password reset: presenting one satisfies the same check a TOTP code does.

## Money

- **Pass-through fee** — a fixed per-diver charge a shop collects on behalf of somebody else — a
  marine-park levy, a mooring fee — and remits in full. It rides on the checkout as its own line
  item and is **not the shop's revenue**: it must not be discounted by a promotion code, and a
  refund should return the diver's share of it. Distinct from **tax**, which Stripe computes and
  owns (ADR
  [20260826-stripe-tax-is-opt-in-and-provider-owned](../architecture/decisions/20260826-stripe-tax-is-opt-in-and-provider-owned.md)),
  and from a **deposit**, which is the shop's money held early.

## What a shop says about itself

- **Conservation commitment** — one of a fixed set of codes a shop ticks to state its own practice
  (Green Fins member, PADI AWARE partner, mooring buoys only, no-touch policy, no-gloves policy,
  reef cleanup dives, lionfish containment, coral nursery support). DiveDay **cannot verify these
  and does not**: they are shop claims, displayed as such, and no operational rule reads them — a
  no-gloves commitment gates nothing at the rail (ADR
  [20260826-shop-stated-conservation](../architecture/decisions/20260826-shop-stated-conservation.md)).
  The vocabulary is `src/lib/conservation-commitments.ts` and there is exactly one of it; the
  words for each code are DiveDay's, in every language, like the marine-life catalog and unlike a
  site briefing.
- **Conservation note** — a shop's own prose about its conservation practice at one dive site.
  The shop's words, in the shop's language, alongside the rest of the briefing — not a code and
  not a claim DiveDay renders on the shop's behalf.

## Modeling notes

- A **person** may be simultaneously a customer, a student, and staff — model roles, not
  separate person types.
- Cert requirements attach to **sites/activities** ("this wreck requires AOW + Deep"). A dive site
  carries an inherent gate (minimum level + required specialties); a trip carries its own; both
  compose into **one** gate — the **stricter** minimum level and the **union** of specialties
  ([20260718-specialty-site-cert-requirements](../architecture/decisions/20260718-specialty-site-cert-requirements.md)).
  That one gate is read at two moments, and they ask **different questions**:
  - **Boarding** (**Readiness**) is the authority. It requires a **verified** card, and for an
    *imported specialty* card a staffer's confirm as well. Nothing else clears it.
  - **Booking** (**Trip admission**) is deliberately weaker. It refuses only when the shop's own
    record of this diver makes the seat impossible, and **absence of evidence never refuses** — a
    diver this shop has never carded books exactly as before. It ignores verification status
    entirely, because that moves before the boat leaves.

  A booked seat is therefore never proof a diver can board, and a refused sale always means the
  dock would have refused too.
- **Technical / overhead rating** — trimix, helitrox, rebreather (CCR/SCR), cave and cavern,
  decompression procedures, extended range, TDI's Tec and Advanced Nitrox tickets. DiveDay's ladder is
  the *recreational* one and models none of these, so the importer **declines** them by name rather
  than bending one onto the nearest-looking rung — "Advanced Nitrox" is a gas certification, not
  Advanced Open Water, and a ladder card clears its gate on status alone. A shop that gates on one
  records it by hand. Distinguished from a recreational card that simply isn't a rung (Master Scuba
  Diver, Sidemount, Photography), which gets the ordinary "isn't a level we gate on" note.
- **Level vs. specialty** — a **level** (OW→Instructor) is a rank; a **specialty** (Deep, Wreck,
  Night, Drysuit) is a distinct yes/no gate. Levels live in `certifications`; specialties live in
  `specialty_certifications`, both captured pending and usable only once verified — except a card
  brought in by the importer, which lands `verified` but (for a specialty only) still holds its gate
  until a staff confirm (see **Imported certification**). A diver's agency number identifies the
  *diver*, not the card, so their Deep and Wreck cards carry the same number; the specialty table is
  keyed on `(shop, agency, specialty, lower(identifier))` so one number can hold each of a diver's
  specialties. **Nitrox** is not in this set — it gates the per-booking mix request, not a site.
- Bookings, waivers, certs, rental fit, and manifests all hang off the same trip/session spine —
  the manifest is a *view* of checked-in bookings plus staff, not a separate data entry task.
- **Identity match key** — self-service paths (booking, wait-list, CSV import) treat a shop's
  active people as unique by `(shop_id, lower(email))` and **reuse** the matching person on any
  submission with that email, so a re-typed regular collapses onto their own cert/waiver/rental-fit
  history (`findOrCreatePerson`, `src/db/people.ts`, CR-008). **Name-mismatch safeguard (H-13):** the
  reuse is no longer silent — `findOrCreatePerson` now compares the submitted name to the stored one
  (`personNamesMatch`, `src/lib/person-name.ts`; case/accent/order/middle-initial tolerant), and a
  public booking that reuses an email under a genuinely different name is stamped
  `bookings.identity_unconfirmed_at`. That raises a fail-closed `identity_unconfirmed` readiness
  blocker — so a shared inbox (a spouse, or a minor booked under a parent's email; see **Junior
  certification**) can't board on the matched diver's evidence — until staff **Confirm identity** on
  the roster. Staff-facing diver create/edit/restore still **refuse** on the same email collision
  rather than reuse, and a soft-deleted person's email frees up for a new, unrelated person (that
  soft-delete window is accepted as-is; it fails closed to a blank record). See H-13 in
  [human-decisions.md](human-decisions.md) and
  [20260723-person-email-uniqueness](../architecture/decisions/20260723-person-email-uniqueness.md).
- **Remove vs. erase (a diver)** — two different operations, deliberately not the same button.
  **Removing** a diver is the reversible archive action every entity has
  ([20260719-crud-archive-semantics](../architecture/decisions/20260719-crud-archive-semantics.md)):
  `people.deleted_at` is set, they drop off the active lists, and *nothing about the record is
  destroyed* — an owner or manager can undo it. **Erasing** a diver is the one-way answer to "delete
  what you hold about me": their name, contact details, date of birth, emergency contact, card
  numbers and card photographs, medical answers, sizes, notes, review comments, and shared photos
  are destroyed across every table, and `people.anonymized_at` is stamped. What survives is the
  **evidence skeleton** below. Erasure is owner-only, requires typing the diver's name, cannot be
  undone (a database check constraint keeps an erased record removed), and always removes them too.
  See [20260802-diver-data-erasure](../architecture/decisions/20260802-diver-data-erasure.md).
- **Evidence skeleton** — what is deliberately left of a signed release after its diver is erased:
  that a release was signed, against which template title/version/body, at what moment, by what
  signature method, on which booking and trip, and which staff member attested it if any. The
  signer's name and their medical questionnaire are gone. The skeleton is re-sealed under
  **waiver integrity version 2** so it verifies as *erased* rather than reading as *tampered*;
  version 1 is the seal over an intact signed release, which covers the signer's name and medical
  answers and therefore cannot survive erasure. The seal proves the skeleton has not drifted since
  erasure — it says nothing about what was erased, which no one can verify afterwards.
- **Buddy-group preference** — an optional, non-sensitive note a diver adds while booking about
  pace, photography, or friends they hope to stay with. It helps the crew plan groups but is never
  a promise and never carries medical or safety-clearance information.
