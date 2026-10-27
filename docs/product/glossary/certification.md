# Certification

- **Requirement** — what a dive site, a departure or the running total of several of them asks of
  a diver, as one shape (`Requirement`, `src/lib/requirement.ts`): a minimum level, specialty cards
  and a nitrox card. Nothing set means it asks nothing, never unknown. Folding two is the strictest
  level, the union of specialties and the OR of nitrox (`unionRequirements`); readiness and trip
  admission both fold through it, so they cannot disagree about what a trip asks. It is stored as
  `requirementColumns` (`src/db/schema/requirement.ts`) on `dive_sites` and `trip_requirements` and
  edited with one form (`RequirementFields`). A course session's requirement is frozen when the
  session is created. Not part of it: the departure's waiver and payment gates, dive counts and depth
  limits.
- **Agency** — organization that trains and certifies divers. Major ones: **PADI**, **SSI**,
  **NAUI**, **SDI/TDI**, **RAID**, **CMAS**, **GUE**, **BSAC**, the cave-diving bodies
  **NSS-CDS** and **NACD**, and the technical agency **IANTD**, common issuers of Florida Cavern
  cards. A diver's card is
  agency-specific but levels are broadly equivalent across agencies. Two different fields carry an agency name and they
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
  from a course session's own roster (see **Shop-issued certification**); or an **Agency check** reads the
  agency's own lookup page from the staffer's browser and certifies a level card when that page names
  the diver at its level. DiveDay's servers never call an agency. A card awaiting a check carries a link
  to its agency's lookup page, which becomes an Agency check when the extension is
  in the browser. SSI instead opens a prefilled form for a staffer to complete manually. Some agencies (RAID, BSAC, the cave-diving bodies) get no link because they publish no
  lookup, while PADI's sits behind the shop's member
  sign-in and its link says so. Only a certified card at or above a trip's required level can
  satisfy readiness. (The staff surface says "certified"; the stored status value is `verified`, which
  is what readiness reads.)
- **Agency check** — the DiveDay browser extension doing an agency lookup from the
  staffer's own browser (H-105, ADR 20261008-cert-check-extension). The extension types the diver
  into the agency's own lookup page and hands back the page's text; the server certifies the card
  only when one record on that page names the diver ("Lena Ortiz" or "Ortiz, Lena", or a labeled pair
  of adjacent lines, "First name: Lena" over "Last name: Ortiz", paired top to bottom so one record's
  family name never completes the next one's given name), carries the birth date or card number the
  lookup was typed with, and states the claimed level in the agency's own words, with nothing
  limiting it. A record ends at the agency's own page furniture (SDI's "Request Certification", a
  search control such as "Manual Search" on its own line); a labeled pair's record holds only a
  record's kinds of lines and dates or numbers its rating, so the search form echoed back is not a
  result. "Jr." straight after the diver's last name is part of their name. A birth date written all in numbers whose day and month could
  swap is read in that agency's own order only, so a transposed date is another diver's. Short of a
  match the staffer is told which: someone by this name but not with this birth date or number (a
  namesake, whose words are never shown), a Junior or limited card, or the diver at another level.
  It stamps `agency_checked_at`, with those words as the review note, and names the staffer whose
  browser ran it. That stamp means *the staffer's browser reported a match*: the words came from
  their browser, not signed by the agency, so it attests no more than **Mark certified** does, with
  the same permission. Anything else writes nothing and leaves the link. A match on a pending card
  says it certified it; on an imported card, that it confirmed it. Level cards only, for NAUI,
  SDI, GUE, CMAS and PADI, never divemaster or instructor (a professional rating is checked on the
  agency's professional tool); an unsighted self-declaration still needs its sighting. The lookup carries
  only what the agency's form asks for: a birth date or a card number, both only for CMAS. SSI's
  manual handoff fills the name and known birth date, leaves its terms and search to the staffer,
  and never reads a result or certifies a card.
- **Check all (agency)** — a departure's "Check all 9 cards with their agencies" on its Divers tab
  (H-105): each **Agency check** the departure holds, one card at a time with a pause between, from
  the staffer's browser, excluding SSI's manual handoff. Each card is judged and certified on its own and keeps its own Undo; there
  is no Undo for the departure. One diver the agency's page does not show is skipped, named, with
  the agency's page to open; two unreadable pages or unanswered requests in a row stop the run, and
  a signed-out **DiveChek check** stops it at once. The staffer can stop it. A re-run skips the cards
  the page already settled. Never a bulk confirm: nothing is certified that its agency's page did
  not show.
- **Page-shape report** — what an **Agency check** that could not finish sends back instead of the
  page's text (ADR 20261008-cert-check-extension): the page's structure only, in a form's own words.
  The path (never its query string), the title, the top headings, each box's tag, type and label
  words, each button's words, counts, and whether a password box or a captcha is there. Every word
  outside a fixed vocabulary of form words becomes "_", and the diver's own names always do, so no
  name, date or number on the page is in it. The server checks it again, logs it as one line
  (`agency_check.page_shape`) and never shows it. It travels with two fixed reasons the staffer
  reads beside the agency's link: **captcha** ("SSI is asking if you're human. Check on its page."),
  a captcha on the lookup's own form, where nothing is typed, or on an answer that says nothing
  about the diver, whose text is never handed back; and **page changed** ("SSI's page has
  changed. Check on its page."), a lookup page with a form but no box or button where the
  extension expects one. In a **Check all**, either leaves that agency's other cards for the
  staffer.
- **Minimum extension version** — the oldest copy of the extension the app talks to
  (`MIN_EXTENSION_VERSION`). An older copy is treated as absent: the agency's link, never its
  button, and Settings says "Update the extension". SSI manual fill requires version 1.6.0 or newer;
  older supported copies show an update prompt for SSI and continue checking other agencies. The extension also answers **hello** with its
  version and the agencies it checks.
- **Try the checks** — Settings' disclosure (owners and managers), on the Card checks row, that runs the extension in this browser
  against nothing real: whether it is here and current, a **dry run** of each public agency's lookup
  on a sample page the extension carries, filled with a made-up diver by the real filler and never
  sent, whether Chrome lets the extension on each agency's own site, and whether an open PADI Pros'
  Site tab is signed in, read without a search. It ends in a copyable session report of versions,
  outcomes and **Page-shape reports**, with no person in it, to email to DiveDay's support address.
- **DiveChek check** — the **Agency check** for a PADI card, on PADI's DiveChek in the staffer's own
  browser, signed in to the PADI Pros' Site (H-121); the "(member sign-in)" link opens the same
  site. Searched by name and birth date, so a diver with no birth date on file keeps the link.
  Narrower than a public page. One diver: DiveChek may list a row per certification, so rows with
  the typed birth date are one diver's cards, and two birth dates under the name, or a page saying
  it found two divers or more, certify nothing ("PADI lists more than one diver by this name"). A
  record ends at the first line that could be someone else's (another name, or a name and another
  birth date) or at the page's own furniture, its birth date comes before its level, and it carries
  the card's number when the card has one. Only those records, and the words saying why or how many,
  leave the staffer's browser. An instructor named on the row is the trainer, not a limit. A **Junior certification**
  reads as its level for a diver 15 or older on the day of the check; under 15 it says "PADI shows a
  Junior card. Under 15, record it by hand." A signed-out browser says "Sign in to the PADI Pros'
  Site first" and stops a "Check all". A best guess of PADI's page until a staffer tries it (#2259).
  Offered only at a shop that turned the **PADI checks** on.
- **PADI checks** — the shop's own switch, "PADI checks (beta)" in Settings, for both checks run on
  the PADI Pros' Site: the **DiveChek check** and the PADI eLearning check (H-121, H-106). On for
  a new shop since 2026-10-23 (Aaron); they run under the membership of the shop's PADI Pro who is
  signed in. Off, a PADI card keeps its "(member sign-in)" link and nothing offers or accepts a
  check (`agencyCheckOffered`, `shops.padi_checks_enabled`).
- **Agency-listed certification** — a nitrox or specialty certification an **Agency check** found on
  the same page as the card it matched, and that the staffer chose to add (layer 3 of ADR
  20261008-cert-check-extension). After a match the staffer reads "PADI also shows these
  certifications. Add them? Each waits for Mark certified." with one tick per certification, all
  ticked. Only lines inside the diver's own matched record are read, and only as far as every line
  is explained (the diver's name, the birth date, the certification's name in that agency's words,
  a recreational card DiveDay holds no kind for such as Perfect Buoyancy, its dates and numbers);
  the first other word, such as a neighbour's name, "Tec" or "Instructor" after a certification's
  name, ends it. Each agency's words come from a closed table, so wording not in it is ignored. GUE's
  Recreational Diver 1 offers nitrox (see **Bundled nitrox**). A kind the diver already has on file
  in any state is never offered, except an unsighted nitrox **Self-declared certification**: adding
  the card the page lists retires that claim, as any card the shop holds outranks the diver's word.
  Ticked ones land **pending**, stamped with the level card whose check listed them, with the
  agency's words as the review note and "Listed on PADI's page." beside them, before and after the
  confirm. Where the agency numbers the diver (PADI, SSI, NAUI, GUE) they carry the number the shop
  holds for the diver, and a staffer's one-tap **Mark certified** certifies them, keeping the words.
  Where it numbers each card (SDI, CMAS) they carry the number printed on their own line, or none,
  and then the confirm is the card sighting. Never certified by the check that listed them: nitrox
  authorizes a fill and a specialty opens a site (each can be certified afterwards by its own
  **Agency check of a card** or by Mark certified). Undoing the check archives the ones still pending. The server judges
  the posted page again and files only kinds it offers itself. Not levels: a second level card on
  the diver's one agency number cannot be filed. On a departure's Divers tab the offer sits under
  the diver's row, after a **Check all (agency)** has finished; on Today it sits under the Needs you
  list, naming the diver with a link to their record, because the row leaves with the card it was
  about.
- **Agency check of a card** — an **Agency check** of one pending nitrox or specialty certification,
  with its own "Check Nitrox with NAUI" button on the diver record and a departure's Divers tab
  (issue #2592, ADR 20261008-cert-check-extension). The server certifies it only when the diver's own
  record on the agency's page lists that card in the agency's closed wording for its kind, under the
  card's own number, and never from a level card's match alone. Offered only for a card with a
  number of its own and not one a card sighting must confirm (a diver's own **Self-declared
  certification**, a **Shop-issued certification**, a listed card with no number). A match stamps
  `agency_checked_at` on the card, as for a level card, and its own Undo clears it and puts the card
  back to pending (or, for an imported card, back to awaiting its confirm). SSI opens a prefilled
  manual lookup; the staffer reads SSI's result and uses Mark certified or confirms the imported card.
- **eLearning check** — the same extension reading a course student's PADI eLearning on the PADI
  Pros' Site, searched by the student's email in the staffer's signed-in browser (H-106, ADR
  20261008-cert-check-extension). The server ticks **Materials done** only when one record names
  the student and their email, this course and no higher one, and a finished status; anything else
  writes nothing. A seat already ticked is left as it was. PADI only, and a best guess of PADI's
  page until a staffer tries it (#2259).
- **Claimed certification** — a card recorded as evidence but not yet verified: the stored status is
  `pending`. It is what a card entered by hand starts as (the shop-owner-facing word is "claimed").
  A claimed card never satisfies readiness or authorizes a nitrox fill until staff **Mark certified** or an **Agency check** certifies it.
  (A card brought in by the contact importer is *not* claimed — see **Imported certification**.)
- **Imported certification** — a card the contact importer brought in from a shop's prior system or
  spreadsheet. It lands `verified` (DiveDay assumes the shop's own system already checked it) but is
  permanently flagged `imported` (a non-null `importedAt`, with an optional prior-shop
  `importedFromLabel`), so it is never mistaken for a card this shop carded on sight. A level card
  satisfies readiness and clears depth gates on import; staff get a soft one-tap **Confirm card** nudge (which stamps `reviewedAt`) but boarding does not wait
  on it — the confirm is record-keeping, not a gate, and the only thing that holds a level card is the source file's own downgrade at the foot of this entry. **Two gates do wait for that confirm.** The **enriched-air fill**: an imported nitrox card
  gives plain air until it, because a wrong fill is the highest-consequence failure
  (ADR 20260724-import-verified-cards). And any **specialty** gate: an
  imported specialty card is `verified` but does not clear the dive it authorizes until a staffer
  confirms it, because a specialty is what permits a materially riskier dive (deep gates depth past
  18 m) and a spreadsheet cell is not a card sighting (H-23,
  ADR 20260725-import-specialty-cards). One thing imports `pending` rather than `verified`: a card
  the source file's own status column marks unverified.
- **Confirm to clear** — the display state of an imported specialty or nitrox card no staffer has
  confirmed yet: on file, `verified`, and still holding its gate (for nitrox, the fill). One fact,
  two tones. On the card's own row
  inside the diver's file the badge reads “certified · confirm to clear” in a **neutral** tone: a
  prompt, answered by one tap beside it. Every summary of that unfinished work — the closed
  Certification records door, the status ledger, the home's station, the held-card status — wears
  the **warning** tone, because a summary is where a staffer decides whether to open the file at
  all. Neither looks like a hand-verified card, so the two are never read as the same thing at a
  busy desk. Only `src/lib/readiness.ts` decides who boards; the tones carry no gate
  (`src/i18n/card-labels.test.ts` keeps this entry and the code in step).
- **Processed with the agency** — the instructor's "Mark sent to PADI", after Certify, that the
  shop has submitted the student to the agency (PADI, SSI and the rest), dated and naming who
  ticked it, and read back as "Processed with PADI · Oct 25". Any card this shop issued carries it:
  a level card, an Enriched Air card or a specialty card (`processed_with_agency_at`,
  `processed_by_person_id` on `certifications`, `nitrox_certifications` and
  `specialty_certifications`, each with its `*_processed_only_when_issued` check). It records the
  shop's own act and issues nothing: the agency sends its own card. The same tap takes it back, and
  the course page lists every issued card still to process, oldest first and with no lookback, a
  card waiting more than 30 days saying so. A card issued before the stamp existed
  (`CARD_PROCESSING_SINCE`, the migration that added it) is listed apart, in one collapsed "N cards
  certified before {date}" line, and never called late: nothing is backfilled, so a card truly
  never sent is still there to tick. Gates nothing.
- **Course ladder** — the Courses page's "N did Discover Scuba in the last 12 months · M went on to Open Water",
  with the names of those who did not and an Invite to the next course's soonest session with a
  seat (`nextCourseFor`, `src/lib/course-ladder.ts`; H-130's one-at-a-time invite under the
  **30-day invite cooldown**). The names leave out anyone holding a card at or above the level the
  next course certifies (any agency, any state) and anyone under its minimum age on the session's
  day, and the send re-checks both. Someone whose release waits on a physician's referral is
  flagged for a call instead of an Invite.
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
- **In training** — a diver with no card at a trip's level yet, holding a seat on a course session
  that certifies that level (or higher), ends before the trip starts, and has not ended yet. A
  **Training mark** (operations glossary) is a different thing and never makes a diver In training.
  Which courses certify a rung is agency fact, written on each template in `src/content/course-templates.ts`
  (`certifiesLevel`) and copied onto the course (`courses.certifies_level`, issue #2059), so a
  template update carries it and no editor changes it; it matches the importer: SSI Advanced
  Adventurer and SDI Advanced Adventure Diver are the Advanced rung; specialties, refreshers and
  tasters certify none, and neither does a course a shop built without a template. The roster's
  "Certify" select opens on it, or on an empty required choice where the course names none; an intro
  session (`courses.is_intro_course`) draws no Certify control, and the action refuses one posted
  anyway (`not_a_certifying_course`). A Rescue student counts as in training toward an Advanced trip
  (the higher rung covers the lower one) at sale only.
  It is **never evidence**. At a charter's sale it counts toward the trip's level, so a fun dive the
  morning after an Open Water course can be sold. It does **not** satisfy a course's own
  prerequisite: Advanced still asks for a certified Open Water card (H-08's course baseline). At
  boarding it is still a blocker (`certification_in_training`), worded as a plan rather than a
  problem, and only the card the instructor certifies clears it (**Shop-issued certification**).
  Both gates share one window (`inTrainingBefore`): once the course session has ended without a
  card, the diver is read as uncertified again, because a diver who did not finish and an
  instructor who has not tapped both need somebody to act; the blocker then names that session
  (`endedCourseTripId`, `courseEndedBefore`) and the diver record's fix opens its roster. Every door
  that asks admission (booking, seat claims, blow-out offers, the next-dive card) reads the same
  window (`src/lib/in-training.ts`), and Today says "Check the course result". A charter seat sold
  only on a course seat is named in that course seat's Remove confirm and its move, and only there:
  a no-show, a type change or the course ending says nothing of it
  (`chartersRelyingOnCourseSeats`, issue #2058); it stays booked, a warning and never a gate, and
  boarding asks for the card as for anyone. A self-declared card is never pointed at an ended
  session: verifying it is the fix (agency review G6).
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
  ([20260820-attested-at-booking-verified-at-boarding](../../architecture/decisions/20260820-attested-at-booking-verified-at-boarding.md)).
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
  ([20260814-self-declared-cards](../../architecture/decisions/20260814-self-declared-cards.md)).
- **Declared uncertified** — a joiner's answer of *"I'm not certified yet"* on one of those same two
  opt-ins: Discover Scuba and Try Scuba customers, snorkelers, the non-diving half of a couple,
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
  It gates nothing ([20260814-self-declared-cards](../../architecture/decisions/20260814-self-declared-cards.md)).
  Since 2026-10-13 a booked diver can also give it on `/ready`'s certification step, the first place
  the sale's silence (2026-08-27) meets a first-timer. While it stands on a seat whose level gate is
  unmet, the blocker reads `certification_not_yet` ("Says they're not certified yet") instead of
  `certification_missing`: the same Blocked seat, named so the desk knows which conversation to have.
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
  ([20260814-self-declared-cards](../../architecture/decisions/20260814-self-declared-cards.md)).
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
  in their hand**. (Nothing to do with a **Sighting**, which is an animal a crew saw on a dive.)
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
  (H-24 revised, [20260814-one-tap-imported-card-confirm](../../architecture/decisions/20260814-one-tap-imported-card-confirm.md)).
  Every imported card still confirms on one tap; what came back here is narrower and applies only to
  the diver-written rows that did not exist then. What did **not** change for imports is that the
  confirm exists at all: an imported card clears nothing until a staffer makes that tap, per card,
  and there is still deliberately no bulk confirm. An **Agency check** confirms an imported level
  card only when the agency's own page shows it, one card at a time, and a **Check all (agency)** is
  only that, card after card. Cards reviewed before that date keep the sentence
  the old attestation wrote into their `review_note`.
- **Prior visit** — one line of a diver's history at the shop's *previous* system, brought across by
  the contact importer from a bookings or orders export (one row per booking). It is a **booking
  record, not a dive record**: an export holds cancellations and no-shows, so the source's own status
  word and its price are kept verbatim and never mapped onto a DiveDay booking status or a currency
  amount. A prior visit points at no trip — it is never on the schedule, never in a manifest, never
  in capacity or owner reporting — and its amount is display text that nothing sums. It shows only on
  the diver's profile, merged into **Shop history** newest-first and marked imported. Distinct from a
  **booking**, which is a seat on a trip this shop ran here and has a roll call behind it.
  See [20260725-import-prior-visits](../../architecture/decisions/20260725-import-prior-visits.md).
- **Readiness** — the fail-closed answer to “can this diver board?” It lists human-readable
  blockers from the trip’s requirements and the diver’s waiver/cert evidence. Unknown,
  unconfigured, pending, expired, or insufficient evidence is never “ready.”
- **Aboard blocker kind** — what a blocker is asking of the crew once the diver is *already on the
  boat*, which is not the same question as which requirement family it belongs to. Four kinds,
  worst first: **medical** (a review hold — a doctor must confirm in writing, so nobody aboard can
  clear it from the boat; the shop records the **physician clearance** on the diver's own record when
  the letter arrives), **unknown** (nothing on file that clears them: an unsigned, unsent or expired waiver
  is *no medical declaration at all*, and so are an unconfirmed identity, a failed readiness
  lookup, or a trip with no requirements configured), **certification** (a card missing,
  unverified, self-declared or too shallow, a specialty absent, or a diver under the course's
  minimum age), and **payment** — the only one of the four that does not change what happens in
  the water today. Worst-first holds *within* one diver, so a diver on medical review who is also
  missing a card is a medical hold. On Today this order picks the headline of the diver's
  **Aboard** row (`blocked_aboard`): a danger-toned Needs you row with the blocker in a few words
  and its fix, ranked just under the after-dive roll call rows. An aboard diver never shares a row
  with ashore ones, and money owed alone never makes an Aboard row — that diver keeps an ordinary
  payment row. The departure card keeps the blocked count; the row carries the name and the fix.
  Deliberately not the
  blocker **category** (`waiver`/`certification`/`payment`/`setup`), which files a medical hold
  under *waiver*, correctly, since that is where the answer was collected. No line naming one of
  these names a role: DiveDay informs and never gates, the captain owns the vessel while the dive
  leader decides who splashes, and a pool session has neither.
- **Trip admission** — the answer to a *different* question, asked when the **seat is sold**:
  “could this diver **ever** be cleared for this trip?” It is **deliberately weaker than readiness
  and is never the boarding authority.** Readiness asks “is this diver cleared *right now*?”;
  admission refuses only a **settled impossibility** — the rung of the ladder they stand on, or a
  specialty/nitrox card they hold none of, in any state. A course that certifies the rung and
  finishes before the trip counts as standing on it (**In training**). Everything a person can still fix before
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
  See [20260803-trip-admission-at-booking](../../architecture/decisions/20260803-trip-admission-at-booking.md).
  Distinct from **course admission**, which is a course's own enrolment rule and fails *closed*.
- **Admission advisory** — what a trip asks for that a diver's record does not yet answer, on a
  booking that **went through anyway**. Deliberately a different word, and a different field, from
  a refusal: one means the seat was not sold, the other means it was. Carried back on the success
  result of `createBookingRecord` when `admissionGate: "advise"` and the shortfall is a
  declared-level one; the public booking form is the only caller that asks for it. It is advice
  about a *sale*, never about boarding — readiness still clears on a sighted card and nothing else.
- **Last known dive** — the latest day the shop knows this diver dived, anywhere: the later of the
  day a staff member recorded on the record (`people.last_dive_on`, off a logbook or a computer) and
  the diver's own last dive day with the shop (a departure that is back, not a pool session) or a
  real imported visit (`lastKnownDive`, `src/db/last-dive.ts`). A trip with the shop moves it
  forward; nothing moves it back. Not **Dive recency**, the diver's own band on a booking, which the
  record shows beside it only when it is newer. Gates nothing (ADR 20261023-last-known-dive).
- **Levels** (recreational ladder, roughly): **Open Water (OW)** → **Advanced Open Water
  (AOW)** → **Rescue** → **Divemaster (DM)** → **Instructor**. Names vary slightly by agency.
- **Assistant Instructor (AI)** — a professional rung between Divemaster and Instructor, and one of
  the **staff roles** a shop files a person under (`assistant_instructor` in `person_role`), never a
  level a diver is admitted on. It is a rung, not a job on a boat, which is why it is deliberately
  **not** a per-trip crew role: what an AI does on one sailing is assist, which the roster already
  spells `divemaster`, and the per-trip role may only narrow. To the in-water ratios an AI is a
  **certified assistant** — they add two students per instructor under the entry-level cap and add
  nothing at all under the intro-session cap, which is the distinction the product was getting wrong
  while `instructor` was the only rung available to file them under (issue #1680, ruled 2026-09-16).
  Adding the rung changed no ratio arithmetic: `inWaterCrewRole` maps it to the thing those rules
  already count. The credit assumes a rating **in teaching status** — a lapsed AI is out of teaching
  status and uninsured, and is not a certified assistant. Since H-59's 2026-10-07 amendment (issue
  #1853) the **supervision claim** checks it, so far as the shop has recorded it: an AI whose every
  recorded `instructor_rating` / `assistant_instructor_rating` / `divemaster_rating` renewed before the departure counts for nothing
  on Today, the staffing week and the trip page (see **Supervision claim**); the AI's own rating is
  filed as `assistant_instructor_rating` (issue #1850). Booking and rostering
  still give the credit, because H-59 kept those two gates closed.
  **It carries no permissions of its own** — DiveDay's authorization gates are
  unchanged by it, so a shop that wants their AI to hold a Divemaster's permissions files them as
  both, which the roles list has always allowed. The one that bites is
  `canOverrideGearRequest`, which admits a Divemaster and not an AI although an AI outranks one on
  every agency ladder: the person who finds a student's BCD two sizes too big *is* the assistant in
  the water with them. Raised on issue #1680 and not decided there. What the rung *does* change is
  who is told what:
  an AI reads the same Today queue as the rest of the water staff, and is deliberately absent from
  the owner/manager/instructor rows (a medical review, a certification, a waiver) that only those
  three can close.
  **On a diver's own card it is not a rung at all**: `certification_level` stops at Instructor and
  has no AI entry, so an Assistant Instructor booking a fun dive is recorded at **Divemaster** — a
  one-rung under-record, the same shape as Adventure Diver and Master Scuba Diver above — with the
  staff role carrying the rest.
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
  ([20260725-imported-card-sighting](../../architecture/decisions/20260725-imported-card-sighting.md)).
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
  under CMAS standards. CMAS does run a central portal (portal.cmas.org) that searches by CMAS code,
  or by name and birth date, but national federations are still filling it: a card it finds is
  confirmed, and a card it does not find is **not** thereby invalid — the lookup **Verified
  certification** describes then goes to the federation named on the card. That is why the staff
  link reads "Search the CMAS portal" rather than "Check with CMAS".
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
  tank over off-system — are both worse than an entry that looks odd. An **Agency check** of a GUE Rec 1 card offers the
  nitrox card on that number for the same reason (**Agency-listed certification**).
- **Other agency** — the enum's escape hatch (`certification_agency = 'other'`), and **a lossy one**:
  there is no free-text companion column anywhere in the schema, so a diver holding an **SEI**,
  **ANDI**, **ACUC**, **PSAI** or **NASE** card is recorded as "Other agency" with nowhere
  to write *which* one — and the staffer who later has to look that number up has no idea whose
  portal to open. Widening the enum (CMAS/RAID/GUE, then BSAC, then NSS-CDS/NACD/IANTD for Cavern
  cards) narrows the problem for the next shop
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
  staff surfaces state them rather than implying the adult limits. **The certified adult here is
  not the waiver's guardian** — see **Guardian co-signature** for the two senses of the word: this
  one is a diver with a booking, a card and a place on the manifest, and nothing about them is
  recorded on `waiver_records`.
- **Site maximum depth** — `dive_sites.max_depth_meters`, the site's deepest point, stored in
  **metres always** whatever unit the shop reads: the number a certification's depth ceiling is
  compared against. The **site depth range** is that number plus `dive_sites.depth_min_meters`, the
  shallow end, also in metres; a shallow end needs the maximum beside it and cannot sit below it.
  Every briefing prints the range through the shop's depth unit ("15–28 m", "49–92 ft"), so one
  unit shows on a page and a shop that flips its setting moves every site with it. `depth_range`
  survives as a free-text **depth note** (the migration cleared it where it could read a range out
  of it); it is shown only where a site records no depth, so it never names a second unit. A trip's
  depth is the deepest site it visits, across the primary site *and* every ordered dive.
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
  See [20260730-site-depth-and-diver-age-surfaces](../../architecture/decisions/20260730-site-depth-and-diver-age-surfaces.md).
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
  See [20260814-course-depth-markers](../../architecture/decisions/20260814-course-depth-markers.md).
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
  without opening a profile (H-21). **A minor does not sign their own waiver alone** as of
  2026-09-07 — see **Guardian co-signature** below. Note the two dates the word is measured on and
  never confuse them: the roster's badge asks whether the diver is under 18 on the **trip** date,
  because that is who is on the boat; the co-signature asks whether they were under 18 on the day
  they **signed**, because a release a seventeen-year-old executed alone does not become valid on
  their eighteenth birthday.
  Since 2026-10-13 a seat can also be a minor's **by its booker's word**: the public party form's
  "Under 18" box stamps `bookings.minor_declared_at` on that seat alone. A date of birth on file
  decides; with none, the stamp asks for the guardian and shows the badge ([H-113](../human-decisions/H-113-under-18-on-party-form.md)).
- **Guardian co-signature** — the second signature a **minor's** liability release takes: a parent
  or legal guardian signing the same release, on the same page, under the same signature provider
  as the diver's own (ADR
  [20260907-guardian-co-signature](../../architecture/decisions/20260907-guardian-co-signature.md);
  owner decision 2026-09-07, which closed H-21's open half). It is six columns on the release
  record — who, what they are to the diver (**parent** or **legal guardian**, a code, never free
  text), how to reach them, and the provider, consent and signature timestamps — never a `people`
  row, because a guardian is a party to one document rather than a customer of the shop. Until both
  signatures are on it, readiness raises **guardian signature missing** and the diver does not
  board; the shop's fix is the same as an expired release's, a fresh link that asks for both. The
  rule **fails open on an unknown date of birth**, exactly as the minimum-age gate does, so a diver
  the shop never asked is treated as an adult — and the day a date of birth lands on their record,
  the release they already signed becomes a blocker rather than a silent pass. It does not answer
  H-01 or H-03: the release wording is unchanged, still English, and whether typed consent is a
  sufficient assurance level is as open for the guardian as it is for the diver. **A co-signer whose
  name reads as the diver's own is not a co-signature** — the writer compares significant name
  tokens, so a middle initial is not a difference and a spelled-out middle name or a suffix is.
  That refusal is a name-match check, not an identity one, so it also catches the family it cannot
  help: a parent and child whose IDs read identically. **The paper path is the one way through**,
  decided by the owner on 2026-09-10 (issue 1573): a staffer recording the release ticks an
  explicit confirmation that the two really do share a name and that they watched both of them
  sign, and the co-signature is stored under its own signature method,
  `in_person_attested_namesake`. **The online path keeps refusing and gains no override** — there
  the shop has no evidence a second person exists at all. The distinction is evidence and nothing
  else: no surface renders it, readiness treats the record as co-signed, and the only readers are
  the integrity seal and the export bundle. The guardian's email is **optional**, and the one thing
  it is for is a copy of what was signed (see **Guardian's copy** below). **It can be erased on
  its own** (H-103): an owner takes it off from the child's record, and the release is re-sealed as
  **redacted** (integrity version 4), still verifying, with who erased it and when inside the seal.
  **Two codes, and only two** — `parent` and `legal_guardian`, confirmed by the owner on 2026-09-10
  (issue 1541) rather than widened. Free text was rejected in the ADR because the code renders to
  staff in their own language, and that reason still holds. **The paper path is not an escape hatch
  from the two codes**, and an earlier version of this entry said that it was:
  `recordInPersonWaiver` runs the same `isGuardianRelationship` check the online form does, so a
  grandmother signing for her grandson at the counter still picks `parent` or `legal_guardian`, and
  only the second is true of her if a court has said so. What the paper path adds beside that code
  is the staffer's own name on the row (`recorded_by_person_id`), which is evidence about who
  watched, not about who the signer is. The cost is a stepparent, foster carer or group leader
  filing a release under a code that is not quite theirs; accepted for now, and the thing a pilot
  shop would report (`dive-domain-expert`, issue #1453).

  **"Guardian" means two different things in this product and they are never the same record.** The
  *waiver guardian* defined here is a party to one document — six columns on `waiver_records`, never
  a `people` row, no booking, no card, no place on a manifest — and answers "who signed this
  release". The *Junior-certification guardian* (see **Junior certification**) is a certified adult
  who must be **in the water** with a 10–11-year-old, and therefore has a booking, a card and a
  place on the manifest. "Is the guardian diving with the junior?" can never be answered from
  `waiver_records`, which is the exact mistake this clause exists to stop.
- **Guardian's copy** — the message a co-signing parent gets when a minor's release is completed
  online and they left an address (issue 1453, owner decision 2026-09-10). It names the shop, the
  diver, the release title and version and the day it was signed, and **carries no link of any
  kind**: no bearer URL, no token, and no medical answers. A guardian is a party to one document,
  not a marketing contact and not an account, so it is a courtesy to a third party rather than a
  per-booking delivery channel — no `notification_deliveries` row is written for it, and a
  retryable failure is **dropped rather than queued**, because a queue row naming a minor and
  addressed to somebody else is one legal erasure cannot find (`notificationIsQueueable`). It is
  *not* keyed to one copy per release, which an earlier version of this entry and the code's own
  comment both claimed: the send is unguarded, so a resubmitted completion mails a second copy. No
  address means no copy, which is every paper release and every family who has none; the address
  stopped being required on the same decision, because a grandparent at a counter with no email was
  being refused outright. One thing the copy does carry beyond the release's facts: when the health
  answers parked the record in medical review, it says a physician has to sign off, because the
  adult reading it is the one who takes the child to that physician.
- **Specialties** — standalone certs gating specific activities: **Deep** (beyond 18 m/60 ft for
  OW divers), **Night**, **Wreck**, **Drysuit**, **Cavern** gate a **site/activity** and live in
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
  In Spanish this is **un bautismo (de buceo)**, never *un curso de iniciación*, which is the
  entry-level certification course and the *other* ratio below
  (`src/i18n/locales/es-ES/README.md`).
- **Intro-session in-water ratio** — the cap on a no-certification-required taster session
  (DSD/Try Scuba — `courses.is_intro_course`): PADI's published **Discover Scuba** figure from the
  Instructor Manual (HD-6, sourced 2026-08-02) — **4 students per instructor in confined/pool
  water, tightening to 2 students per instructor for the open-water dive**, with **no assistant
  bonus** (PADI publishes none for DSD). DiveDay's trip model has no confined-water session type —
  a trip is one dated open-water outing — so **only the tighter 2:1 open-water figure is enforced**
  as a booking gate (`INTRO_COURSE_RATIO` in `src/lib/course-ratios.ts`, derived from `DSD_RATIO`);
  the confined-water 4:1 number is recorded for reference, unenforced. A certified assistant aboard
  buys an intro session no extra seats; only another instructor does — which is why the staffing
  week words this gap apart as "Over intro ratio: add an instructor" rather than the entry-level
  "Over student ratio: add a DM or AI" (**Crew gap** below).
  Applies to **every agency** — unlike the entry-level ratio below, the *reason* this figure is
  tighter (participants with no prior water time) does not depend on whose logo is on the course, so
  an SSI Try Scuba and a NAUI intro session take the same cap. An intro session stays gated **even
  if a `minimum_certification_level` was typed onto its course row**: nobody on a DSD holds a card,
  so a stray value must not switch the tightest cap in the product off.
  See `src/lib/course-ratios.ts`,
  [20260802-dsd-instructor-manual-ratio](../../architecture/decisions/20260802-dsd-instructor-manual-ratio.md),
  and [20260724-course-admission-standards](../../architecture/decisions/20260724-course-admission-standards.md).
  Before HD-6 resolved, DSD was mistakenly held to the looser 8→12:1 Open Water figure.
- **Entry-level in-water ratio** — PADI's published maximum for **Open Water Diver training
  dives**: **8 students per instructor**, extendable by **2 per certified assistant** (a Divemaster
  or an Assistant Instructor, in DiveDay's role model) to a ceiling of **12 per instructor**. Enforced as a
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
  [20260820-shop-divemaster-ratio](../../architecture/decisions/20260820-shop-divemaster-ratio.md).
- **Refresher / ReActivate** — short course for certified divers returning after inactivity.
- **Certifications issued here** — the certification cards the shop's own instructors issued in a
  window (`issued_by_shop_at`; `certifiedHere` and `crewYearFacts`, `src/db/reporting.ts`; fifth
  loop, item 32), on the Reports year ("Certifications issued here: 34 · 22 Open Water") and each
  instructor's Team card ("4 certifications issued this year"). It counts cards, not people: a diver
  who does Open Water and Advanced Open Water here counts twice, as agencies count (dive-domain
  review F7). Level cards only; a specialty such as Nitrox is not in it, and a card captured from
  another shop never is.
