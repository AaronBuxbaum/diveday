# Modeling notes

- A **person** may be simultaneously a customer, a student, and staff — model roles, not
  separate person types.
- Cert requirements attach to **sites/activities** ("this wreck requires AOW + Deep"). A dive site
  carries an inherent gate (minimum level + required specialties); a trip carries its own; both
  compose into **one** gate — the **stricter** minimum level and the **union** of specialties
  ([20260718-specialty-site-cert-requirements](../../architecture/decisions/20260718-specialty-site-cert-requirements.md)).
  That one gate is read at two moments, and they ask **different questions**:
  - **Boarding** (**Readiness**) is the authority. It requires a **verified** card, and for an
    *imported specialty* card a staffer's confirm as well. Nothing else clears it.
  - **Booking** (**Trip admission**) is deliberately weaker. It refuses only when the shop's own
    record of this diver makes the seat impossible, and **absence of evidence never refuses** — a
    diver this shop has never carded books exactly as before. It ignores verification status
    entirely, because that moves before the boat leaves.

  A booked seat is therefore never proof a diver can board, and a refused sale always means the
  dock would have refused too.
- **Technical / overhead rating** — trimix, helitrox, rebreather (CCR/SCR), cave,
  decompression procedures, extended range, TDI's Tec and Advanced Nitrox tickets. DiveDay's ladder is
  the *recreational* one and models none of these, so the importer **declines** them by name rather
  than bending one onto the nearest-looking rung — "Advanced Nitrox" is a gas certification, not
  Advanced Open Water, and a ladder card clears its gate on status alone. A shop that gates on one
  records it by hand. Distinguished from a recreational card that simply isn't a rung (Master Scuba
  Diver, Sidemount, Photography), which gets the ordinary "isn't a level we gate on" note.
- **Level vs. specialty** — a **level** (OW→Instructor) is a rank; a **specialty** (Deep, Wreck,
  Night, Drysuit, Cavern) is a distinct yes/no gate. Cavern is the one a guided tour must not tick:
  the card is only one of the things a cavern dive needs, so "Ready" means the card was seen and
  nothing more, and a Full Cave diver blocks on a Cavern gate until staff record a Cavern card. Levels live in `certifications`; specialties live in
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
  certification**) can't board on the matched diver's evidence — until staff **Confirm identity**
  (below), on the trip roster. **The same blocker has a second
  raiser (#1556):** a staffer who types a name at the
  counter is shown the divers it half-matches (`similarity() > 0.4`, `findSimilarDivers`) with the
  day each of them last dived, and tapping one seats that diver `identity_unconfirmed` too. The
  prompt fires on genuinely different people, so the answer is to make a wrong tap harmless rather
  than the matching cleverer — the seat inherits no certification, waiver or rental fit until the
  same **Confirm identity** tap. Staff-facing diver create/edit/restore still **refuse** on the
  same email collision rather than reuse, and a soft-deleted person's email frees up for a new,
  unrelated person (that soft-delete window is accepted as-is; it fails closed to a blank record). See H-13 in
  [human-decisions/](../human-decisions/README.md) and
  [20260723-person-email-uniqueness](../../architecture/decisions/20260723-person-email-uniqueness.md).
- **Held seat** — a booking attached to an existing diver on a guess: it carries
  `bookings.identity_unconfirmed_at` (with `identity_booked_as` and `identity_matched_by`) and the
  `identity_unconfirmed` readiness blocker, raised by the **Identity match key** above. The seat is
  real and counts against the boat; the *person* is not settled. It boards on nothing of the
  matched diver's, and the flag gates **disclosure** as well as boarding (security review
  2026-09-11): the roster, the boat manifest, its printed sheet, the crew phone's offline copy and
  the departure log show the seat's own state (its name as booked, readiness, payment, roll-call
  marks) and withhold the matched person's particulars (contact, emergency contact, age, sizes,
  nitrox, medical answers), saying only that other holds may apply (`withholdHeldSeatParticulars`,
  `src/lib/held-seat.ts`; issue #1690). The Gear tab packs nothing of the matched diver's for it
  either: its booked-as name, no sizes and no verified nitrox card until the desk confirms who it
  is (`listTripPrepDivers`, issue #2144). Its bearer links name nobody: `/ready` greets the name
  it was booked under and remembers nothing on the device, no release link is issued or signed
  until the desk confirms or splits it (`issueWaiverRequest` and `completeWaiver` refuse
  `identity_unconfirmed`), and confirming or splitting sends the release then (issue #2125). It
  ends one of two ways, both on the roster: **Confirm
  identity** or **Split off a held seat**. Crew never settle it at the rail.
- **Confirm identity** — the staff tap that clears `bookings.identity_unconfirmed_at`, and the
  most consequential one in the product: it says *this person is the diver this seat was attached
  to*. Clearing the flag hands the seat the matched diver's **certifications** (readiness stops
  withholding them) and their **live signed release** — `issueWaiverOnJoin` asks for no new one
  from somebody who already holds a valid signature, so the seat boards on that paper — and
  **spends** the prepaid dives that cover it: `settleConfirmedPackageCoverage` settles the fare
  against the diver's package in the same transaction, which is money leaving a balance rather
  than a permission being granted. **There is no undo.** `confirmBookingIdentity`
  (`src/db/bookings.ts`) is the only writer, reached from the trip roster's guest row, which is also the desk
  inside the arrivals window, and writes a trail line on the departure and on the *matched
  person's* record naming the staffer (`identity_confirmed`). The counter's own door
  (issue #1696) and its trail line went with the Check-in tab on 2026-10-05: a window
  that opens 36 hours ahead is no evidence the person was at the desk. **Open to every live staff role on
  purpose**: the flag is raised at the counter, and a staffer who cannot clear one they just
  raised strands a walk-in until a manager walks past — what carries the weight is the trail, not
  the role list (`src/lib/authz.ts`). **When the answer is no**, staff use the other answer on the
  same row, **Split off a held seat** below. Nothing else may be attested onto a held seat in the meantime —
  recording a paper release on one is refused at the writer (`recordInPersonWaiver`), because a
  staff-attested signature with a medical tick would land on the very record the flag says the
  shop is unsure of. **The seat's bearer links know nothing of the matched diver either** (issue
  #2082): `/ready` and `/waivers` neither show nor write the record's emergency contact, rental
  fit, cards or language, a clean release signed on the seat does not carry to the diver's other
  bookings (a medical hold signed there still does), and no readiness reminder or recap is sent
  until the flag clears. See H-13 in [human-decisions/](../human-decisions/README.md).
- **Split off a held seat** ("Different person") — the other answer to a held seat: this booking is
  *not* the diver it was attached to. `splitBookingIdentity` (`src/db/bookings.ts`) creates a new
  diver record, named by the staffer and prefilled with the name the seat was booked under
  (`bookings.identity_booked_as`), and moves onto it what was about the seat: the booking and the
  gear held for it. Staff notes stay with the matched person, since they were written while the
  seat read as theirs. It **carries nothing** of the matched diver's:
  no cards, sizes, date of birth, contact or email (the shared address stays with the record that
  owns it, and is refused if typed). What the staffer types about the person in front of them
  lands on the new record (issue #2081): a **date of birth** or the staffer's **"They're 18 or
  older"** (H-100), one of the two on every departure and the date itself when a moving seat is on a
  course with a minimum age, because the age check and the guardian co-signature rule both read the
  date and fail open without one (the tick is filed with who gave it, `people.adult_attested_at`),
  and an optional **email or phone** for sending their own waiver. When
  there are **other held seats under the same name** matched to the same diver on *other*
  departures, one box names each of those departures and, when ticked (it starts unticked: two
  strangers can share a name), moves them onto the one new record, so three dives booked with a
  friend's email make one person rather than three. It never moves a seat on the split seat's own
  departure, nor on a departure carrying two such seats: one person is never on one boat twice. A
  medical hold on any of them refuses the lot, and an age-gated course among them makes the date
  of birth required. Every release and link on the seat is **superseded** and every bearer link
  minted over the booking **revoked**, because any signature on it names the matched diver, so the
  seat asks for its own release and is blocked until it has one; the moved links lose the
  delivery outcome they recorded for the matched diver's address. A seat on a **medical hold**,
  whether the physician referral is unanswered or the physician did not clear the diver, is
  refused, since superseding it would lift the hold; the desk's way out is to cancel the seat and
  seat the person fresh, which asks for their own release and medical answers.
  A **signed release stays with the matched diver** (issue #2080): a signature is refused unless
  the typed name matches the record's diver, so every signed release on a held seat names the
  matched person and is their paper. The seat's **unsigned links** follow it, with any half-typed
  answers cleared, and record the move in `waiver_records.moved_*`. The seat's **order stays with
  the person it billed** (the invoice went to the shared address's Stripe customer) and still
  settles the seat through `booking_id`. Open to every live
  staff role for the same reason as confirming; a wrong split is undone by merging the two records
  (owner or manager), which re-seals each verified release it moves as integrity **version 3**
  (who moved it, when, from which record) so it does not read as tampered. Trail lines on the departure (`identity_split`) and on the matched diver's
  record (`identity_split_off`).
- **Merge (two diver records)** — the shop saying two records are one diver, and the record kept
  taking everything the other held (`mergeDiverRecords`, `src/db/diver-merge.ts`; issue #1240).
  Owner or manager only. A **likely duplicate** is offered on the record and flagged on the roster
  when two live records share one mailbox (a `+tag`, or Gmail's dots, folded away), one phone, or
  one name and one date of birth; a name with a date missing on one side is offered only when an
  email or phone agrees too, and two records under one name with *different* dates are two people
  and are never offered on the name (`src/lib/diver-duplicates.ts`). Every merge
  goes through a side-by-side **merge preview** (`divers/[personId]/merge/[survivorId]`): both
  records' particulars, what each holds, and a choice wherever they disagree (name, date of birth,
  email, phone, emergency contact as one pair, rental sizes as one profile), the kept record's value
  preselected. Two *live* seats on one departure refuse the merge until staff cancel or move one,
  and so does a live seat on the record merged away beside a cancelled one on the record kept
  (keep the other record instead); a cancelled seat on the record merged away does not refuse, it
  becomes a **seat left behind** (issue #2177). A seat on a departure that is out right now refuses
  too ("Merge after the boat is back"). On the departure both records shared, the merged-away
  record's duplicate wait-list entry or invitation is dropped and the kept record's stands. Two different
  dates of birth, one date missing where only the name matches, cards or signed releases on both
  records, releases signed under names that do not match, or a medical answer still waiting on (or
  declined by) a physician mean the two may be **two people**, and the merge runs only after the
  staffer ticks that they confirmed it with the diver; the tick names the exact warnings read, and a
  new one appearing before the click refuses the merge. Every
  signed release and medical answer moves, re-sealed as integrity version 3; none is dropped. The
  record merged away is deleted with a pointer to the one kept (`people.merged_into_person_id`), so
  its old links land on the kept record, and the kept record's trail says who merged which name
  into it (`diver_merged`).
- **Seat left behind** — a **cancelled** seat that stays on the record **merged away**, because the
  record kept holds its own seat on the same departure and `bookings` allows one seat per diver per
  departure (`assessMerge`, `src/db/diver-merge.ts`; issue #2177). Only the booking row stays: its
  pointer and the departure log are untouched, while the release, order and notes tied to it move to
  the kept record with the rest of the diver's file (their `booking_id` still names the seat). Only
  the seat's own `cancelled` status qualifies; a live seat is never left behind, on a deleted
  departure or anywhere else.
- **Remove vs. erase (a diver)** — two different operations, deliberately not the same button.
  **Removing** a diver is the reversible archive action every entity has
  ([20260719-crud-archive-semantics](../../architecture/decisions/20260719-crud-archive-semantics.md)):
  `people.deleted_at` is set, they drop off the active lists, and *nothing about the record is
  destroyed* — an owner or manager can undo it. **Erasing** a diver is the one-way answer to "delete
  what you hold about me": their name, contact details, date of birth, emergency contact, card
  numbers and card photographs, medical answers, sizes, notes, review comments, and shared photos
  are destroyed across every table, and `people.anonymized_at` is stamped. What survives is the
  **evidence skeleton** below. Erasure is owner-only, requires typing the diver's name, cannot be
  undone (a database check constraint keeps an erased record removed), and always removes them too.
  See [20260802-diver-data-erasure](../../architecture/decisions/20260802-diver-data-erasure.md).
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
