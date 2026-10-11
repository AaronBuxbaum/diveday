# Operations

- **Operational horizon** — the single forward window every readiness surface reads: now through
  seven days out. Today ranks the work inside it in both of its views, and the nav's blocked-diver
  badge reads the same readiness — so a diver cleared on one is cleared on all of them. The badge
  counts the **next boat day** inside it, not the whole week: today's departures while one is still
  to sail (not yet an hour past leaving the dock), tomorrow's once they are all away, plus every
  diver blocked aboard a boat still out, whose departure the horizon dropped an hour after it
  sailed. That is the sum of the day's cards' "N blocked" plus the Aboard rows in Needs you, and the
  blocked clause of the summary under the date says the same figure in words
  (`blockedOnNextBoatDay`, `src/db/blockers.ts`). Anything past the horizon is Schedule's job, not
  a triage list's. Defined once in `src/lib/operational-window.ts`; each
  surface derives its bounds from there rather than declaring its own. Reports is deliberately
  outside this model — a calendar month is genuinely its job.
- **Needs you** — the one list of jobs on Today (ADR 20261001-logbook, decision 4): every row from
  Today's work queue, at a boat or at the desk, ranked together by tone and then by when it is due,
  each naming its own boat on a quiet line. It sits under the day's departures, which carry no rows
  of their own. A status list, not a page: an empty one is not drawn. A row about one diver is
  titled with their name over what is wrong in a few words ("Waiver not signed, not sent yet."); a
  row for several says it as one sentence ("9 divers not certified for this trip.") and names
  nobody. Neither carries the levels or the other blockers — the roster and the diver record carry
  the full sentence. Failed emails of one kind and one cause are one row with one resend, however
  many people they missed. **A crew reader's lens** (UX audit 2026-10-07, item 7): for a captain or
  divemaster who crews one of today's boats, the list leads with that boat's rows, every
  danger-tone row about any boat (a diver unaccounted for is everyone's to see), and any row about
  the reader themself, such as their own credential coming due; the rest — other boats' work and
  the desk's — folds into one closed line, "N more for other boats and the desk", never gone.
- **Not ready** — the **by-departure view** of Today's work queue (`?view=departures`), not a page
  of its own: the same blocked divers the urgency view ranks chronologically, grouped instead under
  the boat each one holds up, with a per-departure batch waiver send. It had its own route until
  ADR 20260803-not-ready-is-a-view folded it in; that URL now redirects. "Not ready" names the
  *view*; an individual diver's status is **Blocked** or **Ready**, never "Not ready".
- **Blocked / Ready** — the shop's one readiness vocabulary, and the only two states a booking's
  readiness check has. Every *live* surface that shows one — roster, counter check-in, manifest,
  departure board — uses these words and one tone per state (blocked is always danger), resolved
  through `readinessStatusText`/`readinessStatusTone` in `src/i18n/readiness-labels.ts`. The same
  fact used to read as "Needs attention" in warning at the counter and "Blocked" in danger on the
  manifest, for the same diver. **The offline manifest is a deliberate exception**: it says
  "Ready when saved" / "Blocked when saved" (`shared.offlineManifest.single.readyBadge` /
  `.blockedBadge`) rather than resolving through those helpers, because a snapshot on a boat with
  no signal cannot know whether a waiver was signed or a card sighted since it was taken. Dropping
  the qualifier there would be the one lie a roll-call surface must not tell — a stale copy reading
  as current (design/principles.md #4, "safety surfaces keep their precision"). The exception
  covers **every readiness word on that page, not just the diver row's status pill** — the
  missing-divers grid's blocked chip reads the same qualified key, and no caller anywhere under
  `/offline-manifest` resolves through `readinessStatusText`. The grid held a bare "Blocked" one
  scroll from a qualified badge until #1360; a future session narrowing this sentence back to the
  row would re-open that gap. The **refusal** counts too: the sentence a turned-down boarding tap
  shows (`shared.offlineManifest.single.record.notAllowed`) reads "wasn't ready to board when this
  copy was saved", never the present tense.
- **Close-out** — the shop home's evening state (ADR 20260827-clearwater-surface-language,
  decision 4): once every departure of the shop day has settled, each station reads its end state
  in strict precedence off the same roll-call evidence Today chases, then the clock, and only then
  the crew's own **trip stage** (`departureStatus`, `src/lib/closeout.ts`), and the day's takings
  read beneath them. **A stage settles a station the clock would leave open, and never reopens one
  the clock has closed** (issue #1480): inside the late-arrival hour a live `home` reads `all_home`,
  because a crew member tapping Home at the rail is the statement that buffer was standing in for
  rather than an inference from a time. Nothing demotes — a stage that says `underway` over a
  departure the clock calls back is silence, not a contradiction, and so is one the crew stopped
  maintaining. The asymmetry is affordable only because the head count returns before any of it:
  the promotion is reached solely over a departure whose divers are all already counted back
  aboard. There is **no act of closing the day**: a "Close the day" button that recorded who closed
  it (`day_closeouts`) and a leftovers list with per-row Dismiss were removed on 2026-10-05,
  because nothing read the record and the leftovers repeated Needs you (ADR 20260804-day-closeout,
  withdrawn).
  The evening's **"All boats are home"** line is narrower than the close itself, and deliberately:
  it needs every departure of the shop day settled, every one of them reading `all_home`, **and**
  every *assigned* crew member accounted for at the closing checkpoint — the manifest's own
  `crewIsAccountedFor` (issue #1346). Roll-call gaps stay as they were: tightening those would
  raise a danger-toned row on every departure of every shop that has not adopted crew roll call,
  so the moment is what narrows, not the chase.
- **Shop day scan** — the coarse ±26-hour bound (`shopDayWindow`, `src/lib/operational-window.ts`)
  a query casts when the question is about the shop's own *calendar date* rather than a horizon —
  today's boat, for the command palette's boarding jump. SQL cannot ask "same day in this shop's
  timezone" of a UTC column, so the scan over-fetches and the caller filters by shop-local date.
  Twenty-six hours is what a local day can span either side of any instant inside it, plus slack
  for a daylight-saving transition. Never a readiness lens.
- **Counter self-registration** — the shop's QR door at `/s/<slug>/register`: a walk-in puts
  themselves on file **before any booking exists** (issue #1236). The shop prints the QR from
  Settings (`/shop/<slug>/print/counter-card`) and stands it on the counter. The form writes a
  person, a **self-declared certification** and their rental sizes, matched to a returning diver
  by email as the importer does, and the shop's ordinary person-scoped waiver goes to the contact
  they gave; sign-once holds. There is no diver account and no second waiver flow. **The visitor is
  told nothing about themselves**: one success sentence whether they were created or found, sent a
  waiver or already on file, cleared or referred to a physician, so nobody can type an address and
  learn who dives with the shop (`src/lib/self-registration.ts`). The page is never indexed.
- **Arrivals window** — the counter's narrower lens on the operational horizon: departures from six
  hours ago through the next thirty-six. The backwards reach is the one deliberate asymmetry (a
  diver still walks up to the desk for a boat that already sailed); forwards it never outruns the
  horizon. It decides when a departure's Divers tab carries the arrival desk and what the **arrival lookup**
  searches.
- **Arrival lookup** — Today's search for "which boat is this diver on?" (`?q=`): a name, phone,
  email or booking ID matched across every departure in the **arrivals window**, each match a row
  that opens that boat's Divers tab at the diver's own row. The tab itself has no search.
- **Check-in** — a recorded arrival state for a booked diver. It confirms the live readiness
  result and changes the booking to `checked_in`; it is not boarding, which remains a separate
  departure-time manifest decision. A staffer's tap at the counter (the departure's Divers tab, inside the arrivals window) writes it. Readiness is confirmed **wherever the tap is applied**, which
  since the counter went offline-capable is at the desk for a live tap and at reconciliation —
  minutes or hours later, against readiness as it stands *then* — for a queued one.
- **Arrival event** — one append-only row in `booking_arrival_events` recording a single tap at the
  counter: `arrived`, or the `cleared` that takes it back. `bookings.status` stays the projection
  every reader looks at; this is the history beneath it, and it is what lets a check-in be recorded
  with no signal and reconciled later on the rules roll call already uses — deduplicated on the
  device's own event id, refused when a newer statement stands, and, for an undo, applied only
  while the arrival it names is still the one standing. Its vocabulary has no `boarded` and no
  checkpoint, and its writers cannot reach `roll_call_events`: an arrival is never promoted to
  aboard by the queue
  ([ADR 20260907-the-counter-survives-offline](../../architecture/decisions/20260907-the-counter-survives-offline.md)).
- **Running late** — a diver's own statement, before the boat sails, that they are on the way and
  behind (J3). Said by tapping "Running late" on their `/ready` link or by replying `LATE` (`TARDE`
  in Spanish) to a shop's WhatsApp, email or the **night-before brief**'s text, and stored as one
  instant, `bookings.running_late_at` (`src/db/running-late.ts`). Open only on a booked seat not yet
  checked in, from when the night-before brief goes out (24 hours ahead) until the boat has sailed
  (`hasSailed`: the scheduled time plus the departure buffer), on a scheduled departure
  (`canSayRunningLate`); the first statement stands. Only a boat day's brief teaches the word
  (`trips.dive_mode`). A party organizer's statement — a tap or a reply — covers the party's seats
  (`partyLeadBookingId`), and a text covers every seat on that boat under the same number. The arrivals list (Today's arrival lookup and
  the Divers tab once arrivals open) says "Running late, said 7:42" in the shop's zone on that row
  until the diver checks in, which clears it. **It gates nothing** and it is not a **no-show**: the
  diver still has to arrive, and a diver who said it and never came is still the desk's call.
- **No-show** — one staffer's recorded statement that a booked diver did not come. The status is
  `bookings.status = "no_show"`, written only by `markBookingNoShow` (`src/db/no-show.ts`), behind
  the Divers tab's "Not here" disclosure (inside the arrivals window, on any row the gate allows, blocked or not) and its confirm tap. **It is not the three things it is most easily mistaken
  for.** Not a **cancellation**: a diver who told the shop they were not coming gave the seat up
  themselves, and the mark is refused on that booking (`not_booked`), because the difference between
  a courtesy and an accusation is the whole point of keeping them apart. Not a charge or a refund:
  it touches no order, no payment and no checkout, and what the diver owes or is owed stays a
  decision a person makes on the order. Not a boarding decision: nothing on the boarding path reads
  it. **The door opens when the boat leaves without them**, never at the shop's **dock call time** —
  late for the dock call and not coming are different statements, and only the second is what this
  tap writes — and it closes at the end of the **arrivals window**, so it can never outlive the
  queue row it sits on. Inside that window the same tap says two different things either side of a
  sailed boat: while the boat is still there it is about the seat, and once the boat has gone it is
  about the day, and the disclosure's words change to match (`noShowClaim`). **It removes nobody
  from the manifest.** The roster keeps every non-cancelled booking (`getTripRoster`,
  `src/db/trips-roster.ts`), because a diver the desk wrote off is still a name the crew must
  account for at roll call; the row wears a mark of its own so it cannot read as somebody merely
  late, and it stays in the expected head count until somebody at the boat speaks for them. **The
  evening's souls count is the one place it does subtract, because that line asks a different
  question** (issue #1689): it counts who the boat *carried*, so a seat still marked absent when the
  day closes is taken out of it on the desk's statement alone (**sailed**). Nobody is in the water to
  be missing there — the mark cannot co-exist with a boarding at any checkpoint, since `noShowGate`
  refuses one and `reclaimReleasedSeat` undoes the other — and the crew's own `not_boarded` at the
  dock is read ahead of it. **A statement made at the boat outranks one made at a desk.** A diver
  the crew recorded aboard at any **roll-call checkpoint** can never be marked absent
  (`already_boarded`), and neither can one the crew recorded `not_boarded` at an *after-dive*
  checkpoint: there the word is "did not come back from the dive" rather than "never came", and it
  is the row that means somebody may still be in the water. **The two refusals say different
  sentences**, because the desk's next act differs: a diver counted aboard is fine and there is
  nothing to do, while a diver the crew recorded missing means call the boat and open the manifest
  (`already_boarded` / `already_missing_after_dive`). One reader answers both
  (`onTheWaterByRollCall`, `src/db/manifests.ts`), over the diver roll call *and* the crew roll
  call — a staffer can hold a seat on a trip they crew, and **missing crew** outranks a missing
  diver — and it applies `standingResultMeansSailed` (`src/lib/roll-call.ts`), the one predicate
  every reader of this question shares rather than inventing a second definition of who is on the
  water. The same word at the **departure** checkpoint is the benign half and stays markable,
  because "never left the dock" is the ordinary absence this mark exists to record. When the crew
  get there second, **both** statements take the released seat straight back rather than refusing a
  body somebody is looking at (`reclaimReleasedSeat`, `src/db/manifests.ts`): for one slice only
  the boarding did, which left a mark standing over a diver in the water on the ordering the
  offline manifest makes ordinary — after-dive taps are made with no signal and sync hours later.
  **From both halves of the head count, because the refusal reads both.** `recordCrewRollCall`
  takes the seat back the same way `recordRollCall` does; while it did not, the sentence above was
  a promise the reader made and the writer did not keep, and the seat it was broken on is the one
  that most needs it — a staffer's own seat is the one readiness refuses at the dock, so the crew
  list is often the only place a boarding for them can be written at all (issue #1686). It is never
  a **dive day**, in any of the four readers that count them.
- **Seat release** — the confirm tap on a **no-show** *is* the release. There is no second tap, no
  timer, no evening sweep and no `seat_released_at` column: `no_show` leaves the statuses that hold
  a seat (**seat held**), so the boat reads one seat lighter the moment the mark lands and the next
  diver claims it through `bookSpot`'s ordinary transaction. Releasing is the desk's act and is
  gated and confirmed once (`noShowGate`); a mis-tap at the rail may never sell a diver's seat out
  from under them, so a later `not_boarded` releases nothing. The **Undo** is the only way back, and
  it is not a status flip: the seat may already be sold, so it re-counts under the departure's own
  lock against both limits every seat-granting path applies — the boat's capacity and a ratio-gated
  session's crew cap — and refuses with its own line on the trail rather than overfilling the boat. See
  [20260911-the-confirm-tap-is-the-release](../../architecture/decisions/20260911-the-confirm-tap-is-the-release.md).
- **Salvage offer** — what the counter offers in the seconds after a seat is released, as a
  precedence rather than a list: the **wait list** first, a rebooking for the diver who missed
  second, nothing third (`salvageOffer`, `src/lib/no-show.ts`). The wait list leads because those
  divers asked for this exact boat — the offer and the empty seat are the same object — and the
  counter points at the departure's own invite control rather than growing a second sender beside
  it. The second offer is about the **diver**, not the seat: a departure cannot take a seat on
  another departure, so it names the person and links to the door that seats them on a **similar
  departure**. The third is said plainly, because a surface that invents an offer here is worse than
  one that says nobody is waiting. No branch moves money; the money is one sentence and a link to
  that diver's orders.
- **Crew schedule** — whether a shop plans its crew in DiveDay (`shops.crew_schedule_enabled`, Settings
  → Team, **off for a new shop**). On, the shop has the Crew view of Schedule (working shifts, days
  away, crew asking for a departure), the crew line on the week, and the nudges measured against
  its **Target diver:divemaster ratio**. Off, all of that is gone. Every departure keeps its crew
  editor either way, because who is aboard is manifest data (the crew roll call, the souls-on-board
  count) and a course session's agency ratio gates enrolment from it (`src/lib/crew-schedule.ts`,
  ADR 20261005-crew-schedule-is-a-setting).
- **Optional feature** — a feature a shop can switch off in Settings: diver reviews, date
  requests, the last-minute list and tips (`src/lib/shop-features.ts`, one `shops.*_enabled`
  column each, all on for a new shop). Off hides the feature on every surface that offers it and
  deletes nothing (ADR 20261005-optional-shop-features).
- **Working shift** — a dated availability window for a staff member. It is not a crew assignment:
  the shift says who is available, while the trip assignment says who is actually on that
  manifest. Overlapping shifts for one person are rejected.
- **Boat clash** — one hull on two departures whose windows **overlap** (H-80: one hull, one
  departure at a time). Same half-open predicate as the **Crew clash** below
  (`src/db/trips-clashes.ts`), so a hull that ties up at 12:00 and takes the 12:00 out is the plan
  rather than a defect, and a departure with no boat clashes with nothing. A shop wanting a course
  group and a fun-dive group on one charter models it as one departure with two groups. Said on the
  Move panel before a move lands one (`boatMoveClashes`), and on both departures' pages while it
  stands — the Divers tab's pulse and the Details tab's Boat and crew row (`boatClashes`). Like the
  crew clash it is information, never a gate. Each side goes silent once **its own** overlapping leg
  has sailed, since nothing on a hull that has left is left to move; the side still on the dock
  keeps the warning until it sails or its boat changes, because its divers are the ones with no
  boat.
- **Crew news** — what a crew member is told when their boats change: put on a departure, taken off
  one, given a different role on one, the departure called off, or an answer to their own request.
  Recorded as `crew_notices` rows by the crew write path, never for the staffer who made the change,
  then netted per departure and sent as one email per person. A call-off, or a change on a departure
  leaving within a day, goes at once. Anything else waits until their crew has been still for two
  minutes, on the hourly pass. On then off before it settles is no news, and every row is settled
  with an outcome, never in silence (ADR
  [20261009-crew-hear-about-their-boats](../../architecture/decisions/20261009-crew-hear-about-their-boats.md)).
- **Crew clash** — one person on two departures whose windows **overlap**. It is a time overlap and
  never a shared day: a divemaster on the 08:00 and the 14:00 is how a shop runs a Saturday, and
  `setTripCrew`/`changeTripCrew` allow it deliberately while refusing the overlap outright. The
  schedule builder's move preview reports it before a move that would create one
  (`crewMoveConflicts`, issue #1310), by name and with the other departure named too — never as a
  count, which was built for #1203, measured at 24 of the demo board's 25 departures, and removed.
  **It is not the whole of "is she free?"**: that question has three readings, and the two the app
  can answer are this one and the **Working shift** blackout above, reported as its own separate
  line because one is an inference from the roster and the other is the crew member's own
  statement. The third — over her hours — is unmodelled, and nothing says otherwise. `moveTrip`
  does not refuse a clash; the preview informs and the owner decides. **The words state the fact,
  "also rostered on", never an impossibility** (H-80): "cannot be on both" was false of a
  split charter, and the sentence has to stay true of every state a shop can reach. **And the preview is no longer
  the only reader** (issue #1695): the panel that warned about a move closes with the move, so the
  clash a departure is *standing* in is read back on its own Crew panel, on its About summary row,
  and in the staffing week on the day the overlap falls (`crewClashes`, the same overlap query the
  preview asks with a shifted window). The staffing week (the Crew schedule) names the pair
  **once, under the earlier departure**: the later one's chip does not say it back (UX audit
  2026-10-07, item 34). Still information on every surface — nothing gates on it.
  **Three writes manufacture one, not just `moveTrip`** (dive-domain-expert review 2026-09-12): the
  move, `updateTripRecord` — the About → Details form, which writes `starts_at`/`ends_at` straight
  through and replaces `trip_schedule_days` wholesale with no crew read at all — and
  `setTripStatus(…, "scheduled")`, which reinstates a called-off departure whose crew were
  re-rostered while it was off the board. The last two are mild rather than silent, because both
  redirect with a `?notice=` whose form re-opens About, so the read speaks on the next paint. A
  clash already **home** is reported nowhere: it is permanent, unfixable and true, which is the
  shape of a warning a shop learns to scroll past.
  **Today names it on both boats** (H-80), decided **per leg** by `crewClashPhase`: `crew_clash`
  while the clashing leg has yet to sail (issue #1776), and `crew_clash_sailed` while it is out,
  pointing at the roll call (issue #1814), so a course clashing on its second morning is still a
  clash to fix while its first day is out. Both read through one batched `crewClashesByTrip`, never
  from roll-call events, so a crew member nobody tapped is still not a roll-call subject; a person
  the departure roll call has already answered for drops off the sailed row. A boat that is out but
  no longer a station files these rows at the desk, never into the week's count.
  **The boat manifest reads it too, and it is the loudest of the five** (issue #1779): a crew member
  on two overlapping departures prints aboard both, and the sheet said nothing — so the second boat's
  deck met a crew member missing at the count with no reason, and souls-on-board named a body that
  was on the other hull. The crew row now says which other departure, and the printed souls-on-board
  line carries how many of the named crew another boat claims, because a qualification forty lines
  below a number does not reach somebody reading that number over the radio. It is **bounded to the
  departure checkpoint and to a crew member nobody has tapped yet**: a roll-call result on this boat
  is the authority and supersedes it, and after a dive the same sentence would be a pre-written
  excuse for a body that is unaccounted for, which is what stops a search (dive-domain-expert review
  2026-09-13). The dock copy carries it for the same reason it carries everything else — the rail is
  where there is no signal to ring the office with. Still information: nothing gates, and the sheet
  always prints.
- **Crew gap** — a scheduled trip with nobody rostered on it, or a course session `courseCrewGap`
  reports as instructorless or booked past its ratio. It is a prompt for staff, not a boarding
  authorization by itself. **Today owns it**: Today names it (`instructor_missing`) and its
  departure board is where crew are assigned. The shift roster only counts them —
  "N departures in this window still need crew" — and links across
  (ADR 20260806-staffing-is-the-shift-roster). A **different** gap, the shop's own **Target
  diver:divemaster ratio** below, fires `uncrewed_departure`/`crew_below_target` instead —
  `courseCrewGap` wins when both would apply to the same course session, **except where nobody is in
  the water at all, which takes the slot as `uncrewed_course`** (issue #1338). A course session past
  its ratio splits once more on *which* cap it broke: `staffGapForCourseGap`
  (`src/lib/staffing-week.ts`) reads `courseCrewGap.ratio` and words an intro session as
  `over_intro_ratio`, every other course as `over_ratio` (issue #1339) — the entry-level cap takes a
  certified assistant and the intro one takes only another instructor, so one word for both sent a
  divemaster to ask for the single gap their being aboard cannot close. One departure still
  never carries two rows for one underlying fact (issue #732); that rule is about the count, and the
  count has not moved. What moved is which row, because "Course needs instructor" beside an empty
  boat reads as though a divemaster is already aboard, and an empty-water phrase beside a course session sends a
  manager to phone one — who cannot run a training dive or sign anybody off. A session with **nobody
  booked**, or one carrying the **self-guided** mark, keeps the instructor word: neither has anyone
  to supervise, and not being able to enrol is still the actionable fact. That second case is now a
  statement about the *detector* rather than something a shop can arrange — no trip-creation door
  writes the mark onto a course session any more (issue #1342, see **Self-guided departure**) — and
  it is kept because a row written out of band still has to resolve correctly. Formerly "coverage
  gap", which named a second vocabulary that no longer exists. **The seven words a staffer reads**
  are "No divemaster", "Under target", "Course needs instructor", "No instructor or crew",
  "Over student ratio: add a DM or AI", "Over student ratio: add an instructor" and "Over intro
  ratio: add an instructor". "Student" says the agency cap rather than the target two rows down;
  each over-ratio chip names who a manager goes to find, which is the gap's `remedy`
  (`src/lib/course-ratios.ts`): a divemaster or assistant instructor raises the student cap 2 at a
  time, but never past 12 per instructor, so past that ceiling only another instructor adds a seat,
  and an intro session credits an assistant nothing at all. All seven share the same 135px column of
  the staffing week (issues #1125, #1338, #1339, #1677).
- **Self-guided departure** — `trips.self_guided`. A departure the shop has said runs without an
  in-water guide: buddy pairs go in on their own. It silences the shop's own **Target
  diver:divemaster ratio** for that one sailing and reaches nothing else — never an agency training
  ratio, never readiness, trip admission, capacity, roll call or the manifest. It is a **statement,
  not a permission**: nothing about it clears anybody to do anything. **Never true of a course
  session** — no trip-creation door will write the two together (issue #1342), because a departure
  running a course has an instructor of record whether or not they are in the water, so the shop's
  own target is exactly the signal that should keep applying to it. The refusal only ever *adds* an
  advisory row, never removes one. Offered at creation as well as on the departure's own form, since
  the case it exists for is a standing unguided charter created once as a series template (ADR
  20260827-self-guided-departures).
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
  [20260719-recurring-trip-series](../../architecture/decisions/20260719-recurring-trip-series.md) and
  [20260810-open-ended-recurring-trips](../../architecture/decisions/20260810-open-ended-recurring-trips.md).
- **Horizon** — how far ahead a repeating trip's dates are actually on the board (120 days). Not a
  limit on the run: a nightly pass keeps the window full ahead of today, so an open-ended series
  never runs out.
- **Skipped occurrence** — a date staff deleted outright from a repeating trip. Recorded so the
  horizon never puts it back (`trip_series_skips`); cancelling a date, by contrast, keeps the trip
  and can be reinstated.
- **Seat claim** — a party member taking over one seat of a party booking as their own identity,
  through a bearer `/claim/[token]` link the organizer shares (a `claim`-purpose
  `booking_capabilities` row; [20260804-seat-claim-links](../../architecture/decisions/20260804-seat-claim-links.md)).
  Claiming re-points the seat's existing booking at the claimant's own person record and starts
  their own waiver and trip prep; the organizer's surfaces show which seats are claimed. It never
  creates or frees a seat, never moves money, and is never required — an unclaimed seat boards
  under the organizer's party exactly as before claiming existed.
- **Seat held** — the booking statuses that count against a departure's capacity: `booked` and
  `checked_in`, and nothing else (`SEAT_HELD_STATUSES` and `seatIsHeld`, `src/lib/no-show.ts`,
  spelled once as a `where` clause in `seatHeld`, `src/db/trips-queries.ts`). `cancelled` never held
  a seat, and `no_show` stopped holding one when the counter gained the power to release it (**seat
  release**). Every seat *count* reads that one predicate — the booking transaction, the restore,
  the walk-in picker, the departure's own record and its capacity floor, the wait-list join, the
  public dive-site page's departures and the schedule board — because a call site that spells the
  rule itself instead shows a shop "Full" over a seat that is free, or oversells a seat that is not.
  It is not the roster: the **manifest**, the gear register and the buddy builder still read every
  non-cancelled booking, and must. A few counts stay deliberately looser and treat a released seat
  as still held — crew sizing, the minimum-decision sweep, blow-out candidates — each conservative
  in the direction its own question needs, and none of them can oversell.
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
  [20260727-last-minute-fill-promos](../../architecture/decisions/20260727-last-minute-fill-promos.md).
- **Last-minute deal** — a staff-sent, time-boxed discount on one under-capacity trip: a real Stripe
  `Coupon` + `PromotionCode` created on the shop's connected account (percent off, expiring at the
  trip's departure, capped at the trip's open-seat count), emailed to every last-minute-list entry
  whose date range covers the trip. The diver redeems it by typing the code on the booking form; it
  is validated against that specific trip before being handed to Stripe Checkout, so a code issued
  for one trip cannot discount a different one. See
  [20260727-last-minute-fill-promos](../../architecture/decisions/20260727-last-minute-fill-promos.md).
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
  roster's complete medical evidence in one file, where staff surfaces show it one signed record at a
  time (`divers/[personId]/waivers/[recordId]`). The "leave anytime"
  half of the data-portability strategy; its CSV schemas are the contract the planned importer and
  read API reuse. See [20260722-full-shop-export](../../architecture/decisions/20260722-full-shop-export.md)
  and [20260724-export-bundled-photos](../../architecture/decisions/20260724-export-bundled-photos.md).
- **Backup destination** — the S3-compatible bucket a shop points its weekly backup at: endpoint,
  region, bucket, optional key prefix, and a credential of the shop's own, whose secret half is
  sealed at rest (`src/lib/secret-box.ts`) and never shown back to anyone. One per shop, gated
  like the export download because what it receives is the full **export bundle** (with the
  shop-wide `trips.ics` riding along). Configured at Settings → Backups.
  See [20260804-shop-owned-backup-export](../../architecture/decisions/20260804-shop-owned-backup-export.md).
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
- **Diver moment** — a caption, usually with a photo, that an earlier diver brought back from one
  **dive site** (`dive_site_moments`). The caption is the diver's own line. Moments are
  **staff-moderated and opt-in**: a row shows nowhere until the shop publishes it
  (`is_published`). No surface writes one yet: today only the demo seed does, and the shop export
  carries them. Published moments with a photo show as one strip on a public trip page, deduplicated
  by site and capped at four (`dayMomentsFor`), and on the site's own public page. Marketing copy
  calls them "moments from divers".
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
- **Tide window** — where the tide is when the boat reaches a site: **slack** (the half hour either
  side of a predicted high or low), the **flood** (rising, low to high) or the **ebb** (falling), read
  off NOAA CO-OPS's high/low predictions for the site's own `tide_station_id` at the dock-day
  rhythm's arrival instant for that dive, never at the departure time (ADR
  [20260907-noaa-tide-predictions](../../architecture/decisions/20260907-noaa-tide-predictions.md)). A
  site may say when it **dives best** (`any` / `slack` / `flood` / `ebb`) and the sentence says
  whether this departure meets it. The time named is the tide table's turn, not a current
  measurement — real slack on a reef lags it by a site-specific amount, which is the crew's to know.
  Staff read it wherever a site has a station; divers never do. Informs; never a gate.
- **Station echo** — NOAA's own name for the station a site points at, shown under the id on the
  dive-site editor. `isTideStationId` is `/^\d{7}$/` and can be no stricter — a subordinate
  station's id looks exactly like a harmonic one's and every seven-digit id answers — so a station
  typed for the wrong end of the chain produced a confident tide sentence about the wrong water on
  every departure and said nothing (issue #1468). The echo makes a wrong id legible as a wrong
  *place* rather than as digits nobody can check. CO-OPS covers **US waters only**; a shop with no
  station near it gets no echo and no tide sentence, which is the right answer rather than a gap.
- **Implausible-station advisory** — the sentence on that same field when the station sits further
  than `IMPLAUSIBLE_STATION_DISTANCE_KM` (40 km, `src/lib/tide-stations.ts`) from the site's own
  coordinates. It names what the distance costs on the water rather than the distance alone: the
  turn that station predicts can reach this water up to an hour early or late, stacked on a number
  that is already a height turn and not slack. Forty is calibrated on the mistake the demo's own
  seed names — a Key Largo reef reading Vaca Key at Marathon — against a correct pairing at
  twenty-nine kilometres.
  Advice, never a refusal: the lookup lives in the page's render rather than in the save, every
  failure renders nothing, and a site that has not said where it is draws no sentence at all.
- **Station acknowledgement** — a shop saying, once, that it meant the station the advisory above
  questions (`dive_sites.tide_station_confirmed`, a checkbox under the station field). A genuinely
  remote site has no nearer station to pick — Flower Garden Banks reads Galveston at about 190 km
  and is right — and no threshold both spares that and catches the Marathon mistake, so the
  instrument is a per-pairing answer rather than a bigger number. Once set, the advisory does not
  render; the box stays on the page so the answer can be taken back. **It is about one pairing, not
  about the site**: every writer that can move `tide_station_id` clears the flag in the same
  statement, so a shop that acknowledges Galveston and then mistypes a different id gets the prompt
  back. Stored on the row rather than in the browser — which station a site reads is a fact about
  the site — and read by nothing but that one sentence.
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
  2026-08-05 ([remove-certification-paths](../../architecture/decisions/20260805-remove-certification-paths.md));
  progression order is guidance in exactly the same way, changing what is *shown* first and never
  who may enrol.
- **Prerequisite note** — shop prose beside a course's certification gate ("comfortable swimming
  200 m", "bring your logbook"). It adds to the gate and never substitutes for it: the card the desk
  checks is `minimum_certification_level`, which the agency owns and no shop edit can reach. The
  course page labels the two apart for exactly this reason — a note reading "or a qualifying
  certification" next to an unlabelled gate is how a diver arrives believing they are eligible.
- **Learning materials** — what a course asks a student to work through before day 1, usually the
  agency's eLearning: an ordered list of names, each with an optional `https:` link and note, kept
  on the course. DiveDay sends it with the booking confirmation, whether the student booked
  themselves or a staffer seated them, repeats it on the 7-day reminder, and shows it on the
  diver's thread. **Materials done** is a staffer's tick that the student finished them, stamped
  with who and when. It belongs to the student's enrollment, not one departure: ticked on the pool
  weekend, it counts on the open-water weekend of the same course. It is the shop's word, never
  the agency's (the eLearning check ticks it only after reading PADI's page in the staffer's
  browser), and it gates nothing: the 7-day reminder stops asking, and Certify shows a neutral
  reminder to check the agency's record when it is missing
  ([20261008-course-learning-materials](../../architecture/decisions/20261008-course-learning-materials.md)).
- **Private session / private course** — a course with a private price can also be run for one
  diver or one group on a date of their own. The course page says so ("Private course available",
  or "Private session available" for an intro like Discover Scuba) and points at the inquiry form.
  It never prints the private price, because whether that price is per diver or per group is the
  shop's to explain.
- **Instruction fee / e-learning fee** — a course invoices as two lines on one bill, and the diver
  makes a single payment for their sum. Enrollment assumes the e-learning is included; a student
  who already completed it elsewhere has that line cleared before the invoice goes out, or
  refunded after. Keeping them separate on the order is what makes either one adjustable without
  re-working the total by hand.
- **Manifest** — the authoritative list of every person on a boat (divers, students, staff,
  crew), with emergency contacts. "Every person on a boat" is about who must be *accounted for*,
  which is not the same set as who signs the release — see **waiver / release** for why crew are
  outside that one. A legal/safety document — in US waters, coast guard
  regulations apply. **Roll call** happens before departure and *after every dive*; a diver
  left behind is the industry's nightmare scenario. Manifests must work offline and print
  cleanly. An after-dive head count that is not closed is chased, not merely displayed: Today
  raises it and the schedule board badges the departure — **for crew as well as divers**. It comes
  in six distinct kinds, which are deliberately never worded or ranked alike — see **unaccounted
  for** below.
  Two rules travel with it onto paper: **the app is the record and paper is the fallback**, so
  nothing printed is ever a second,
  quieter register; and **the roll is called by name**, every diver and every crew member, by two
  people — a head count is the practice that leaves people behind, which is why no DiveDay surface
  asks for one. The number printed beside each name is a line number and never an identity; see
  **roll-call order**.
- **Roll-call order** — the order the manifest lists divers in: **oldest seat first, then the diver's name, then the booking id** (`getTripRoster`, `src/db/trips-roster.ts`). The screen, the departure log and the saved dock copy all read that one query, so the three can never disagree about who sits where in the list. The **number beside each name is a line number, not the diver's number**: it is that row's position in today's list, so it shifts when a seat is cancelled, when a released seat is resold to somebody else, and when a name is corrected inside a group of seats sold in the same instant. It exists so a person can keep their place down a wet list, and for nothing else — **the roll is still called by name** (see **Manifest**), and no note, message, export or radio call ever refers to a diver as a number. A shop wanting a number a diver keeps for the day (a tank station, a group) does not have one: that is a stored fact about a person on a departure, not a position in a list. The order is stable against a re-read and against a fresh seed of the same data; it is not stable against the roster's own contents changing (issue #1720). The rename case is the owner's accepted cost, not an open question: the name stays the tie-break and no monotonic seat number is added (H-81, issue #1759).
- **Paper pass** — the A6 pass printed at the counter for a diver without a phone: the departure,
  the hull, the meeting point, the shop's dock call, what to bring, and a code carrying **the
  booking's id and nothing else**. A booking id is not a capability — the counter resolves it inside
  its own shop — so a pass left on a boat seat hands a finder nothing. It carries the diver's name
  and no readiness, waiver or medical state.
- **Trip packet** — the browser-print document for one departure (`/shop/<slug>/trips/<id>/print`,
  `TripPacket`): three sections, each on its own sheet — the **dive plan** in words, the **manifest**
  (the roster in roll-call order with each person's emergency contact, the shop's **emergency
  reference**, the missing-diver procedure and the ruled kit blanks), and the morning **packing
  list**. It is a document, not the live tabs stacked: no control reaches the sheet
  (`e2e/trips.spec.ts` counts them under print emulation). The day's paper prints the same block
  once per departure. Not the **departure log**, which reports what was recorded after the boat
  is back.
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
  See [20260824-pre-departure-safety-check](../../architecture/decisions/20260824-pre-departure-safety-check.md).
- **Certificate passenger limit** — the passenger ceiling printed on a passenger vessel's
  certificate (in the US, the Coast Guard's Certificate of Inspection), stored as
  `boats.certified_passengers` beside the boat's own `capacity`. The two are different numbers:
  capacity is the seats the shop sells, a business choice, and the certificate is what a boarding
  officer counts against. When the people booked on a departure pass it, the departure's **Boat**
  tab says so in danger ink above the **pre-departure checklist**; once the crew have recorded more
  people aboard than it allows, the line counts them ("13 passengers aboard") instead of the
  bookings. **No seat above it is sold** (H-107): a boat whose seats on sale pass it is refused at
  save with a field error, so is a certificate lowered under the seats an upcoming departure on the
  hull still sells, and a departure may not sell more seats than its boat's certificate
  (`boatSeatsRefusal`, `tripDetailsPatch`). **The booking transaction is the ceiling that holds
  whatever the forms missed**: it sells at most the lower of the departure's `capacity` and the
  certificate, read under the trip-row lock (`sellableCapacity`), as do an undo, a no-show undo and
  the wait list's "go and book it"; a copy and a series roll start the new departure at the
  certificate, and "apply to the rest of the series" skips a date on a hull certified for fewer.
  The field reads **passengers only, not crew**, the same people capacity counts: everyone aboard
  but the crew. A boat saved over it before H-107 keeps sailing, its fleet row says so in danger
  ink, and its next save must fix it (`src/lib/boat-safety.ts`).
- **Boat papers** — a boat's three dated documents: when its next safety inspection is due, and
  when its registration and hull insurance expire (`boats.inspection_due_on`,
  `registration_expires_on`, `insurance_expires_on`). Typed over in Settings, Boats when renewed,
  so the paper itself is the history. Each has its own window — 90 days for the inspection, 60 for
  registration and insurance (`BOAT_PAPER_HORIZON_DAYS`) — inside which a departure on that boat
  names the paper above its pre-departure checklist and Today carries a quiet owner errand
  (`boat_papers_due`), escalating once it lapses (`boat_safety_expired`).
- **Safety kit** — the boat's own emergency equipment kept on the **gear register** as units:
  `o2_kit`, `aed`, `first_aid_kit` and `flares` (roadmap N-08). Each may be assigned **aboard** one
  boat (`gear_items.aboard_boat_id`; any other kind is never aboard), and runs **service clocks**
  of its own: an AED's `aed_pads` and `aed_battery`, the printed `expiry` of flares and a first-aid
  kit, and an O2 kit's cylinder `hydro_test` and `visual_inspection` beside its `service`. Every
  clock inside 30 days or past it on kit aboard a departure's boat is one line on that departure's
  Boat tab ("AED: pads expire in 12 days", "Flares: expired 3 days ago"), judged on the
  departure's own date; a unit flagged for service reads "flagged for service. Check before
  sailing.", because the register knows the flag, not where the unit is. An O2 kit and an AED are
  **must-carry**: a shop that keeps one on its register is told, in danger ink, when a hull has
  none in service aboard ("No emergency oxygen aboard"). On a departure sailing today, missing
  oxygen or AED and any oxygen, AED or flare clock due or past is one danger row on Today for
  every role, under that departure (`boat_safety_kit`); everything else that has expired is the
  owner's errand. Safety kit never takes a bench-clock row (`gear_service_due`). Opt-in by
  presence, like the rest of the register, and it **informs, never gates**: roll call and boarding
  go on.
- **Sailed** — how many of a departure's booked divers the boat actually **carried**, as distinct
  from the roster it sold. One rule answers it per seat (`seatSailed`, `src/lib/closeout.ts`),
  reading the shop's statements about that seat strongest first: the crew's own result at the
  `departure` **roll-call** checkpoint, where `boarded` counts and `not_boarded` ("never left the
  dock") does not; then any result standing at an *after-dive* checkpoint, either word of which
  means the person was on the boat; and then — only for a seat the crew said nothing about at all —
  the desk's **no-show** mark. A seat nobody has spoken for counts, because no result is an
  unfinished dock count rather than a statement about a person, and the departure's own status is
  already saying so (`departure_uncounted`). `not_boarded` at an *after-dive* checkpoint is the
  opposite fact and subtracts nothing: that diver sailed, and is the one the day is still looking
  for. The dock still wins where it *spoke*, which is what keeps the ashore-then-boarded-later seat
  out of a count that asks how many the vessel left with; for one slice its *silence* won too, and
  the evening read "0 out, 0 back" over a boat carrying a missing diver (issue #1704). It is **not**
  `booked`, and the two must not be collapsed — every question about seats *sold* still reads the
  roster, because a released seat never came back to the shelf. Its reader is the evening's
  **souls on board** line, whose crew half is the same idea: assigned crew less the ones a human
  recorded ashore at the dock.
- **Souls on board** — the industry's (and the coast guard's) term for how many *people* a vessel
  left with: passengers (divers, snorkelers and riders) plus crew, one number, no distinction
  between who paid and who works. It is
  printed at the top of the paper manifest and nowhere on screen, deliberately. On paper it is a
  **static** fact about the departure — how many the trip carries, how many crew it names — never a
  live roll-call count, because a "Boarded 6" printed at 07:12 is wrong by 07:20 and paper cannot
  correct itself. The screen answers the live question, in the checkpoint panel. **One screen does
  count this way**: the shop home's evening homecoming line, which since 2026-09-05 reads "8
  passengers and 2 crew out, 10 back" (issue #1346). It counted bookings until then, which left the crew out
  of both numbers on the one sentence in the product about who came home — and it says the two
  halves rather than one total, because a shop reading its own evening wants to know which is which.
  **Both halves now count who was carried, not who was rostered** (issue #1689): the diver half is
  **sailed** and the crew half is the assigned crew less the ones recorded ashore at the dock. A
  count that includes a divemaster standing on the dock is the failure "left with" exists to
  prevent, and it was reachable through an ordinary last-minute crew swap, because `changeTripCrew`
  refuses to unassign anybody who has roll-call history.
- **Departure log** (was "incident-ready export" until 2026-08-12) — the print-optimized document a
  shop hands to authorities or insurers after a departure, generated from close-out: the manifest roster with each person's per-checkpoint roll-call state, the
  **pre-departure checklist**'s own answer for each shop-defined item (checked, by whom, when, or
  explicitly not checked), the
  complete append-only roll-call timeline (corrections included), certification evidence as held,
  waiver **status** (state, date, template version — never the medical questionnaire's answers),
  the **buddy pair** staff recorded for the departure — a stable team number, the buddy's name,
  and who recorded the pairing when, since a pairing decided at the dock and one typed in that
  night are different facts (the live manifest's split-team alert is deliberately not restated: it
  is a *reading* of the roll call at one moment, and this document reports recorded facts) — crew
  and crew counts, and generation metadata. It reports
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
- **Emergency reference** — the **shop's** own card of numbers a crew dials *during* an incident:
  its nearest chamber, the dive-accident hotline, the coastguard, the vessel's name, who to raise on
  shore, and the shop's emergency action plan as prose (`src/lib/emergency-reference.ts`, stored
  whole on `shops.emergency_reference`). It is **not** the *emergency contact* above, and the two
  are now read within one scroll of each other on the offline manifest, so the distinction is worth
  holding: an emergency contact belongs to **one diver** and is the person you phone *afterwards*;
  an emergency reference belongs to **the shop** and is who you phone *during*. DiveDay authors
  none of its values and ships no defaults — the nearest chamber differs by dock and the hotline
  differs by country, so a plausible wrong number here costs the minute it takes to find out. Free
  text throughout, including the phone lines: an international dive line is not a `tel:`-shaped
  string until the shop writes it, and nothing on this card links, dials, escalates, or opens an
  incident. It is a laminated card retyped, priced at zero words of DiveDay's own.
- **Roll-call event** — an append-only record that a staff member marked one booking boarded,
  not boarded, or cleared, including the time and who recorded it. **After a dive it may carry a
  short note** (up to `ROLL_CALL_NOTE_MAX`, 300 characters) when the mark raises a "not back
  aboard" or unsays one that stands, so the shop can record *what happened* to a diver who did not
  come back, not only *that* they did not; an ordinary "came back" tap and every mark at the dock
  carry none (`rollCallNoteAllowed` in `src/lib/roll-call.ts`;
  [20260828-a-missing-diver-gets-a-sentence](../../architecture/decisions/20260828-a-missing-diver-gets-a-sentence.md)).
  The printed manifest and the saved offline copy carry the note. Its newest event is the current state;
  older events remain evidence of what the crew recorded. **Cleared** is an undo: staff tapped the
  current status again to correct a mistake, and the diver returns to awaiting. It is stored as its
  own event so the correction stays in the audit trail rather than deleting history. **Cleared is
  emitted offline too**, and it is the reason it has to be: without it the only way to take back a
  mis-tapped "not back aboard" was to tap "aboard" — a positive claim that a person is back on the
  boat, which nobody had made. **On the live manifest neither direction is the cheap one**: since
  the boat manifest became an instrument, both "mark back aboard" and the retraction are recorded
  from the person's own panel, which costs the same two deliberate gestures either way and takes
  both off the row a thumb runs down
  ([20260827-the-departure-is-two-working-surfaces](../../architecture/decisions/20260827-the-departure-is-two-working-surfaces.md),
  decision 3). **A retraction is scoped twice.** A device may only retract a statement
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
  boat cannot turn the loudest row in the product green by bouncing.
- **Held** — a roll-call *mark*, not a roll-call event: the dashed ring a diver's row wears when
  nobody has recorded anything about them **and readiness has not cleared them to board**. It exists
  only at the dock, because readiness gates boarding there and nowhere else — after a dive roll call
  is a physical head count, and a blocked diver counts back aboard like anyone else. One who was
  never counted aboard earlier is boarding at that count (they joined at a later site), so their
  row shows the dock's readiness capsule and blockers — but keeps its tap. A held row
  carries no tap at all: the act that clears it is ashore, on the Trip tab, and offering a tap the
  server would refuse is a control that lies. It is not a state anything is stored as — the row is
  simply *awaiting* with a readiness blocker (see **Readiness**), drawn so a captain can tell at a
  glance which empty circles are theirs to close.
- **Touch guard** — the roll call's refusal of a press made with more than one finger on the glass
  (`src/components/roll-call-touch-guard.ts`). A wet palm or a sheet of spray lands as several
  contacts at once, where a deliberate thumb is one, so a roll-call press made while more than one
  touch was down, at any point in that gesture, does not submit. Touch only: a mouse, a pen or a
  key is never refused. It covers the live roll call's buttons and every mark on the offline
  manifest. It is **not a water lock** (ADR 20261001-logbook cut the lock that once sat in front of
  the aboard mark) and **not part of Boat mode**: it is always on, whatever the palette.
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
  nobody. **The loud one is earned by a recorded fact.** After a dive it reads only when a human has
  recorded a teammate *not back aboard*; a teammate nobody has called yet is "not yet", not a split.
  It used to fire on the merely-uncalled, which meant the first diver counted back painted their
  buddy's row red before anyone had said a word about them — on every row of every surface interval,
  which is how a crew learns to stop reading an alert
  ([20260827-the-departure-is-two-working-surfaces](../../architecture/decisions/20260827-the-departure-is-two-working-surfaces.md),
  decision 4). At the dock the heads-up keeps its old reading: there the crew is *assembling* a
  boat, so anyone not yet aboard is genuinely still to gather. The offline manifest shows teams read-only by name and states that the split-team read
  belongs to the live roll call — a saved snapshot cannot know who came back.
  Buddy teams are **divers only**: a snorkeler or a rider on a departure can be on no team, and a
  booking that is on one cannot be changed away from diving until it leaves the team.
  See [ADR 20260804-buddy-teams](../../architecture/decisions/20260804-buddy-teams.md).
- **Participant type** — what a booked person is doing on a departure: a **diver**, a
  **snorkeler**, or a **rider** (`bookings.participant_type`, codes in
  `src/lib/participant-types.ts`). Every booking has exactly one, and it defaults to diver. All
  three hold a seat, are counted at every roll-call checkpoint, appear on the manifest, and sign
  the shop's waiver and medical form. Only a diver is asked for a certification, may request
  nitrox, goes on a buddy team, is packed tanks for, uses a dive package, or counts against the
  departure's **diver seats**. A course session sells divers only. Staff change a booking's type
  from the roster ("Coming as"): joining the dive runs the card check and needs "Change anyway" (an
  owner, manager or instructor) to pass a missing card, nothing changes once the departure is home,
  and joining is refused from the departure time on. See
  [ADR 20261007-participant-types](../../architecture/decisions/20261007-participant-types.md).
- **Booked as** — the participant type a booking was made with (`bookings.booked_as`), set once by
  every writer and never changed. A seat whose type moved since shows a warning-tone
  note on the roster, the roll call and the offline copy: "Snorkeling, booked as diver" when it
  left the dive, "Diving, booked as snorkeler" when it joined. Leaving the dive clears card checks
  only, never a medical one, and joining a seat already boarded re-asks the boarding gate.
- **Snorkeler** — a participant who is in the water at the surface with no tank. Needs no card,
  rents surface kit only (mask and fins, wetsuit, boots, hood and gloves, camera), and pays the
  departure's snorkeler price (`trips.snorkeler_price_cents`). The public form offers a snorkeler
  seat only where the shop has named that price; zero means free, and no price means not sold.
  The trip prep list counts one snorkel vest per snorkeler seat, the boat's own and never a rental
  (`DivePrepChecklist.snorkelVests`).
- **Rider** — a participant who stays on the boat: a partner, a parent, a photographer. Needs no
  card, rents nothing, and pays the departure's rider price (`trips.rider_price_cents`) under the
  same rule as a snorkeler's. A rider is still a body aboard and is counted at roll call.
- **Diver seats** — an optional cap on how many **divers** a departure carries
  (`trips.diver_capacity`), for a boat whose tanks or guides run out before its deck does. The
  boat's own capacity always counts everyone aboard; the diver cap only refuses a diver, and a cap
  at or above the capacity binds nothing. Both are enforced inside the booking transaction.
- **Per-trip crew role** — what a crew member is rostered to *do on one sailing*
  (`instructor`/`divemaster`/`captain`/`crew`), as opposed to the shop-wide roles they hold. There
  is deliberately no `assistant_instructor` here: that is a rung a person holds, and the job an AI
  does on the day is the one this list already calls `divemaster`. Unset
  means **not specified**, which counts exactly as it always did, by shop-wide inference — never a
  claim that anyone is or is not in the water. It can only ever *narrow* what someone is worth to
  the in-water ratio: the roster says which job they are doing, `person_roles` stays the evidence of
  what they are qualified to do, and the count takes the lesser. A divemaster rostered as this
  trip's captain is therefore not a **certified assistant** for it (see
  [ADR 20260803-per-trip-crew-role](../../architecture/decisions/20260803-per-trip-crew-role.md)).
  Set on the trip's crew section, per person, from the job picker beside their name. Both crew write
  paths refuse to leave a course session with nobody on the ratio, so rostering the session's only
  instructor onto the deck is refused exactly as removing them is — the two say the same thing about
  the session. Unassign-then-reassign does not preserve it: the row and its role go together, and
  the picker is how it is set again. The manifest's crew rows, the departure log and the incident
  export print the professional rating beside a set job when the job does not already say it
  ("Divemaster (Assistant Instructor)", `standingRatingsBesideJob` in `src/lib/crew-roles.ts`), so
  narrowing the job never takes the rating off the record (#1852).
- **In-water certified assistant** — a Divemaster **or an Assistant Instructor** actually
  supervising students in the water on this trip; each one extends the **entry-level in-water
  ratio** by two students per instructor. A person holding both instructor and divemaster roles is
  counted as the instructor, never as their own assistant; an Assistant Instructor is counted here
  and never as an instructor, whatever the roster says. One definition, `countInWaterCrew` in `src/lib/crew-roles.ts`, shared by the
  booking gate, the trip page, the Today queue, and — through Today's own reader — the shift
  roster's crew-gap count.
- **Roll-call checkpoint** — one independent roll call: before departure or after a numbered dive.
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
  ([ADR 20260804-crew-roll-call-is-per-person](../../architecture/decisions/20260804-crew-roll-call-is-per-person.md)).

  A `boarded` result at any checkpoint — the dock, or an after-dive count for a diver who joined
  the boat at a later site (issue #2142) — also changes what Today's departure card says about a
  **blocked** diver, and the split is worth knowing: blocked-and-**aboard** is the more serious of the two — the
  gate is behind them, not in front — and is an **Aboard** row at the top of Needs you (see
  **Aboard blocker kind**); blocked-and-**ashore** keeps the ordinary blocker row; a diver marked **not boarded** stays in the ashore group until an hour past
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
  [20260726-shopwide-offline-manifest-priming](../../architecture/decisions/20260726-shopwide-offline-manifest-priming.md).
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
- **Boat mode** — the high-contrast palette (navy and safety yellow, Atkinson Hyperlegible) for reading a screen on deck (ADR 20261001-logbook, decision 6). By day it is light, white ground and navy ink, because sun washes a dark screen out; with the device in its dark scheme it is Night Dive, navy ground and white ink (H-97). The roll call always wears it; anyone can put the rest of a device in it from the staff identity menu (`src/lib/boat-mode.ts`). A manual switch only: there is no light sensor, water lock or glare skin. The roll call's **touch guard** is separate from it and always on.
- **Boarding** — the fast pre-departure pass: get every ready diver aboard before the boat leaves,
  waiver/cert/payment confirmed at a glance. It is not a separate surface — it is the **Manifest's**
  "Before departure" checkpoint, where readiness pills and a resolve-blockers link show alongside the
  roll call. Boarding a diver there is the same roll-call event as any later checkpoint. Day-of entry
  points (Today's departure card, the command palette's "Boarding" jump) open the manifest on that
  checkpoint. Crew, emergency contacts, after-dive roll call, print, and the offline snapshot are all
  on the same page.
- **Trip phase** — which kind of work a departure is in, for staff only: Prep, Check-in, Aboard or Back, drawn as the stage pill above the departure's four tabs (ADR [20261001-logbook](../../architecture/decisions/20261001-logbook.md), decision 3; `src/lib/trip-phase.ts`). Not a **trip stage**: a stage is a word the crew said and DiveDay publishes, so it is never inferred; a phase is orientation on the crew's own screen, so it falls back to the clock when nobody has tapped. The crew's tap still wins: any stage but `home` reads Aboard until the return day ends, and `home` reads Back. It reads the raw tap rather than `liveStageOf`, because a late boat is exactly when the stepper must not say Back. A cancelled departure has no phase.
- **Trip stage** — where a departure is, in the crew's own word: one of five (`boarding`,
  `underway`, `surface`, `heading_in`, `home`) tapped on the **manifest** and then repeated, with
  the time it was tapped, everywhere DiveDay draws that boat — the shop home's station chip, the
  storefront's live line, the **follow link**, and a diver's own link (ADR
  [20260904-reef-all-the-way-down](../../architecture/decisions/20260904-reef-all-the-way-down.md),
  decision 2; `src/lib/trip-stages.ts`). **Never inferred and never a position.** A clock implies no
  stage: a departure nobody tapped has none, renders nothing, and never renders "Unknown"; and
  DiveDay follows no vessel, because a position is a promise this app cannot keep. Only an active
  staff member of that shop, on a live departure, records one (`recordTripStage`,
  `src/db/trip-stages.ts`), and records rather than edits: `trip_stage_events` is append-only, a
  crew that taps the wrong word taps the right one, and the newest row wins. **A stage goes stale
  rather than wrong** — it stops speaking two late-arrival buffers past the departure's own end
  (`liveStageOf`, `STAGE_STALE_AFTER_MS`), because a crew that tapped *Underway* and then got busy
  would otherwise leave a diver's family reading "out on the reef" at midnight. `home` alone carries
  the roll call's success tone, and `home` alone is withheld from the anonymous surfaces: the diver
  who was aboard reads it on their own link, a storefront panel about tomorrow does not. It was a
  display word until issue #1480 made it load-bearing — the **close-out** reads a live `home` as a
  boat that is in, which is what lets a tap settle a station the clock would leave open. So the
  staleness rule is a safety rule there and not a courtesy: a stage the crew stopped maintaining
  says nothing about whether the day may close.
- **Waiver / release** — the single liability release a shop uses, typically with a **medical
  statement**. DiveDay keeps one versioned release per shop: a *changed* release saves a new immutable
  version and new links snapshot the current one. The exact template version is snapshotted into each
  issued record; a signed record is immutable and a replacement link creates a new record. Some
  answers on the medical form require a physician sign-off — that's a blocking state, not a checkbox,
  ended by a **physician clearance** recorded against that record or, while it stays open, by a clean
  later release (H-98 amended, #2195). The hold is a fact about the diver, not the trip: until one of
  those, it blocks every departure, including one that does not require the release (H-104).

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

  **The release is a customer's release; crew are not in its scope.** It is the agreement between a
  shop and someone paying to be taken diving, so DiveDay never counts a divemaster or an instructor
  in the exposure figures above and never chases one for a signature — a crew member reaches a
  departure through `trip_crew`, not a booking, and `standingWaiverExposure`
  (`src/db/waivers.ts`) joins bookings only. What stands behind staff in the water is the
  employment relationship and the professional liability their agency or the shop carries, not a
  document their employer asks them to sign each season; a release signed by an employee does not
  create employer coverage and asking for one blurs which relationship is which. Answering this by
  joining `trip_crew` "because it was there" is what issue #842 exists to have refused. It is a
  product boundary, not legal advice: a shop whose own counsel wants staff on a release still has
  the paper/in-person path, and if that ever becomes the norm it is a human decision to record
  (H-01/H-03), not a query to widen.
- **Course form** — a form a course asks each student to sign as well as the release, such as an
  agency's course release or a safe-diving-practices statement. The words are the shop's own, written
  beside the release and versioned on every real edit (DiveDay ships none, H-10). Each course
  chooses its forms, in order, on its own page. Unlike the release, a course form is **signed per
  booking**: a signature counts for the enrollment it was signed on, at the **current version** —
  which, once a session has started, also means the version that was current when it started, so an
  edit made mid-course asks the next session to sign — with a guardian's co-signature for a minor,
  and never carries to the next course. A student signs on their prep link's forms page or on the
  **forms-only link** staff send, which opens that page and nothing else; staff can also record a
  paper copy from the Divers tab. An unsigned one is the `course_form_unsigned` blocker (a minor's
  with no guardian, `course_form_guardian_missing`), so the student reads Blocked until it is
  signed. One switch,
  `COURSE_FORMS_BLOCK_BOARDING`, turns that into a warning instead, and buying a seat never waits on
  it (ADR 20261008-course-forms). A course template names its agency's **standard forms** by title.
  Creating or syncing the course sets them up empty, and a form with no text is asked of nobody
  until the shop pastes the agency's wording in.
- **Sign once** — a diver signs the release once, not every trip. A **completed** signature is held
  against the diver (not just the booking it was signed on) and satisfies the waiver gate on any of
  their bookings while it stays **current**: signed against the shop's current release version and
  within a year of signing. A medical-review record carries only once a **physician clearance** is
  recorded against it — until then it never does — and a stale or old-version signature falls back to
  "send a fresh link." See [20260721-waiver-sign-once](../../architecture/decisions/20260721-waiver-sign-once.md).
- **Physician clearance** — the shop recording that a physician evaluated a diver the medical
  questionnaire had **referred**, and cleared them to dive. It is the only thing that clears that
  `medical_review` record itself (a clean later release can stand over it, below), and it is a
  separate act from the paper attestation, whose staff-facing words are the opposite ("no answer
  needs physician sign-off"). DiveDay records the shop's act; it never grants the clearance
  ([20260805-rstc-medical-questionnaire](../../architecture/decisions/20260805-rstc-medical-questionnaire.md)).

  Three properties worth knowing. It is recorded against **one waiver record** — the one carrying
  the answers that were referred — so a later disclosure signs a new record, parks again, and needs
  its own clearance; "cleared for this diver forever" is not a state that exists. It carries the
  **physician's evaluation date**, which is not the day a staffer typed it in: the release then
  stands only while *both* clocks run, a year from the signature and a year from the evaluation,
  and an evaluation predating the answers it would clear is refused. And it records **evidence** —
  the evaluation itself, or the clinician's name — because without one the row says only that a
  member of the shop's own staff pressed a button. Any live staff member may record one, and the
  row names who did. Issue #1252.

  **A recorded answer is final for that waiver record**, cleared or not cleared — confirmed by the
  owner on 2026-09-10 (issue #1366) as the shipped default rather than a first cut. The two stamps
  are mutually exclusive by the `waiver_records_medical_clearance_attributed` check, so recording a
  clearance over a refusal is refused and so is the reverse: a physician's "no" is not erasable by
  whoever is at the desk next. A diver re-evaluated three months later gets back on a boat by
  **signing a fresh release** — a new questionnaire, a new record, which is also the honest thing
  to do with a disclosure that is now months old. The act is **Send a new waiver** on the refused
  diver's roster row: one owner/manager tap (`retireMedicalRefusal` in `src/db/waivers.ts`) that
  marks the refused record superseded and emails a fresh link. The refusal stays on file and
  **keeps outranking every older signature** (`isStandingRefusal` in `src/lib/waivers.ts`), so the
  seat stays blocked as not cleared until the new release is signed. **A clean new release clears
  the diver without a second physician, and says so** (H-98, Aaron 2026-10-07): it boards them,
  and the roster, the manifest (its offline dock copy too, by date only: issue #2163) and the
  diver record warn that a physician did not clear this diver, with a link to the refused record
  on the roster and the diver record (`overriddenRefusal`). Any staffer may record a paper waiver after a refusal (Aaron, 2026-10-07).
  The warning ends only when a physician has since cleared a release
  that flagged every question the refused one did, ordered by when each physician answered.
  A clean later release also stands over a referral no physician has answered (H-98 amended,
  #2195). The diver record, the Divers tab and the live manifest warn with a link to the referral
  (`overriddenReferral`); the offline copy and paper show the date only. A booking whose own
  release is the open referral still waits for a physician.
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
  [20260811-person-scoped-paper-waivers](../../architecture/decisions/20260811-person-scoped-paper-waivers.md).
- **Imported waiver acceptance** — a contact-import row explicitly claiming a diver already accepted a
  waiver (medical clearance included) at a prior shop. DiveDay trusts that claim and writes the same
  immutable completed record any signature produces, marked `signatureMethod: "imported"` so it is
  never confused with a release DiveDay itself watched a diver sign or a staff-attested paper copy.
  Unlike the paper path, **no staff attestation is required** — a deliberate, knowingly-made
  product-owner decision (H-17 in human-decisions/) that reverses the contact importer's original
  fail-closed medical rule. It carries the diver's real acceptance date when the row gives one (still
  subject to the one-year signature-validity window), snapshots the shop's *current* template for
  reference only (the diver never agreed to that text), and is never fabricated from a source
  "verified" flag alone — it requires an explicit `waiver_accepted` claim. See
  [20260724-import-waiver-acceptance](../../architecture/decisions/20260724-import-waiver-acceptance.md).
- **Medical questionnaire** — the versioned diver-medical form a waiver presents, selected by the
  shop's **jurisdiction** (the 2026 UHMS/DMSC RSTC participant form by default). Defined as data
  in `src/lib/medical.ts`; a completed waiver stores the questionnaire id + version and the
  server-side yes/no answers for the questions that **applied**, so a later edit never
  re-interprets signed evidence. An item in a Box the diver was never asked to open is stored
  absent rather than as a no, which is what the paper form does with it (issue #1135). Questions 3,
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
  See [20260719-stripe-connect-orders](../../architecture/decisions/20260719-stripe-connect-orders.md).
- **Order** — a shop-issued bill for a customer: one or more line items (a trip fee, course fee,
  rental, nitrox, deposit, or free-form charge) against a person, optionally tied to a booking. Local
  status (`open`/`paid`/`void`/`uncollectible`/`refunded`) mirrors the Stripe invoice backing it. A trip's
  optional per-diver price pre-fills the trip-fee line item when an order is started from a
  booking's roster row — staff can still edit the amount or add more line items before sending.
  **Raising** one is owner/manager work, like the refund it may later need — every staff role can
  read orders, but billing a diver on the shop's own Stripe account is not deck work
  ([20260803-invoicing-role-gate](../../architecture/decisions/20260803-invoicing-role-gate.md)).
- **Imported payment history** — an unverified payment, refund, receipt, or source Stripe reference
  carried from a prior system. It appears in its own section of Orders and may contribute to the
  clearly labelled source portion of a monthly net-revenue figure only when its date, direction,
  amount, and currency are unambiguous and its currency matches the shop's report. It is never a
  DiveDay order, booking payment, Stripe confirmation, reusable card credential, or readiness fact;
  its stored reference is a reconciliation clue only. See
  [20260816-imported-payment-history-is-evidence](../../architecture/decisions/20260816-imported-payment-history-is-evidence.md).
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
  [20260731-shop-currency](../../architecture/decisions/20260731-shop-currency.md).
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
  no checkout. See [20260721-checkout-at-booking](../../architecture/decisions/20260721-checkout-at-booking.md).
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
  [20260721-deposit-cancellation-policy](../../architecture/decisions/20260721-deposit-cancellation-policy.md).
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
  See [20260721-automated-cancellation-refund](../../architecture/decisions/20260721-automated-cancellation-refund.md).
- **Reminder cadence** — a scheduled pre-trip nudge sent once per booking at a fixed lead time: a
  7-day and a 24-hour reminder, each its own `notification_kind` so it is deduped like any other
  send. The rule for which reminder is due (`src/lib/reminders.ts`) partitions the run-up to
  departure into buckets, so a late booking gets only the accurate reminder, never a stale one. An
  external scheduler drives an idempotent cron endpoint; the app holds no timer. See
  [20260721-scheduled-reminder-cadence](../../architecture/decisions/20260721-scheduled-reminder-cadence.md).
- **Night-before brief** — the 24-hour reminder cadence enriched into a full pre-departure brief:
  the crew's plain-language conditions read, what to bring (the shop's packing list), a concrete
  dock-arrival time, and who to text on the day. It is the same `trip_reminder_24h` send, not a new
  kind — the cheapest cancellation-prevention tool a shop has, since most day-of no-shows are anxiety
  plus logistics confusion. Copy in `src/lib/night-before-brief.ts`; the 7-day reminder stays a light
  nudge.
- **First-timer track** — the night-before brief in a softer, what-happens-on-the-boat voice for a
  diver with no prior non-cancelled booking on a departed trip with the shop. Same data, extra
  reassurance; the signal is derived at send time, not stored.
- **Desk hours** and the **after-hours ping** — when somebody is at the shop's desk: one window every day in the shop's own zone (`shops.desk_opens_minute`, `shops.desk_closes_minute`, 08:00–18:00 until the shop changes it under Settings → Messages). A diver message filed by the inbound email or WhatsApp webhook while the desk is closed sends a `desk_after_hours` email to each staffer who wants it: on by default for an owner or a manager, off for everyone else, and each staffer's own answer (`user_accounts.after_hours_ping`) wins, from their Email settings. At most one per person per half hour (`user_accounts.after_hours_pinged_at`, claimed by one conditional update), naming how many divers (distinct senders) wrote in since the desk closed and are still unanswered, with a link to the Inbox. Never the sender, the subject or a word of the message. Staff operational mail under H-09: no unsubscribe, no postal footer, not queued for retry, and never from a demo shop. Rule in `src/lib/desk-hours.ts`, reads and the send in `src/db/desk-pings.ts`.
- **Monday email** (weekly digest) — the owner's service email about their own shop's week, sent once per person per shop-local week on Monday between 08:00 and 20:00 shop time (`/api/cron/weekly-digest`, hourly). Sections, each a count and a link into the staff app, appear only when they have something to say: last week's bookings made and seats filled against capacity (Reports' own query), this week's departures and seat fill and the divers still owing a waiver (the shared readiness horizon), reviews received and waiting on moderation, date requests still waiting, and Today rows that are past due. A week with none of these sends nothing. Last week's figures and Today's money and platform chores go only to someone Reports' gate admits (`canViewShopReports`, read from live roles); anyone else who opts in gets the rest. On by default for an owner, off for everyone else, and each staffer's own answer (`user_accounts.weekly_digest`) wins; it is turned off from the staffer's Email settings or the email's own one-click link. Transactional under H-09 (staff, about their own operation), so it carries no commercial postal footer. Demo shops never send; any staffer can preview this week's at `/shop/<slug>/settings/email/preview`. Logic in `src/lib/weekly-digest.ts`, reads and the send claim (`weekly_digest_sends`) in `src/db/weekly-digest.ts`.
- **Post-trip recap** — the per-diver-per-trip reading of the day, delivered once per booking as the
  `trip_recap` kind no earlier than four hours after the departure ends. It rides the same
  delivery-row dedup as the reminders, and the dedicated hourly recap scan (`/api/cron/recaps`) keeps
  that floor punctual without weakening it. Since slice 7d it is **not a page of its own**: the link
  (`/recap/[token]`, a purpose-separated signed booking token, distinct from the readiness link)
  renders the **after-state**, and so does the diver's own readiness link once their day is over. No
  redirect between the two, because a recap token may not mint a readiness capability — and no
  share-this-page control on either, because one of the two URLs rendering that surface can also
  cancel the booking and move its refund. **No recap for a diver left at the dock**: a booking whose
  standing departure roll call is `not_boarded` gets neither the email nor the page, unless an
  after-dive `boarded` shows they joined the boat at a later site (`bookingsLeftAtTheDock`,
  `src/db/recap.ts`, issue #2105). A held seat gets none until staff **Confirm identity**. **Held
  while somebody is missing**: while any diver or rostered crew member on the departure has an
  after-dive "not back aboard" standing — exactly while Today raises its missing-diver or
  missing-crew row, read through the same function (`tripsWithSomebodyMissing`,
  `src/db/today.ts`) — every recap on that departure waits: the email, a staff send (which says
  "Recaps are held until the roll call is corrected"), `/recap`, and the after-dive `/ready`. The
  page answers with the **waiting** state, which says only that the recap is not ready yet; the
  four writers on it (photo, tip, review, pulse) refuse while it is closed (`recapClosedReason`).
  And the word pauses the automatic send in the same transaction, so once it is corrected a
  staffer releases the recap from the close-out rather than the cron deciding a near-miss was
  nothing (issue #2123). See
  [20260723-post-trip-recap](../../architecture/decisions/20260723-post-trip-recap.md) and
  [20260827-the-divers-thread](../../architecture/decisions/20260827-the-divers-thread.md).
- **After-state** — the third and last state of the diver's thread, after *prep* and *the dive day*:
  the welcome-home greeting, the **dive record**, the crew's word, one review ask, and the quiet
  doors for photos and a tip. **When it opens is a domain question, not a clock reading.** Where the
  crew kept a departure roll call it follows that: `not_boarded` never sees it unless an after-dive
  `boarded` shows they joined the boat later (the recap's own rule), and `boarded`
  opens it once the boat is scheduled home plus the standing one-hour late-arrival buffer. Where a
  shop recorded no roll call it waits four hours after the scheduled return — the floor the recap
  *send* already uses, because nothing else in the product knows whether this person dived
  (`isAfterTheDive`, `src/lib/thread-steps.ts`). A cancelled booking, a **blow-out**, and a no-show
  are each answered by their own notice before it is ever asked. **Waiting**: while somebody on the
  departure is "not back aboard" after a dive, the after-state is held for everyone aboard and the
  page says only that the recap is not ready yet, on the same link (see **Post-trip recap**). A
  held seat and a diver left at the dock are dead seats, answered before the wait.
- **Dive record** — the card the after-state is built around, headed "Dive log entry", and the one
  thing on the page that prints: everything else is `print:hidden`, and on paper the card gains a
  ruled Notes block and a signature rule. **It states only what the shop wrote down** — the diver,
  the date, the vessel, the crew, the sites, the conditions, and which **dive day** this makes — and
  asserts nothing about the dive itself. There is no bottom time, no depth and no dive count
  anywhere in it, because DiveDay records nothing about dives *performed*: `trips.planned_dives` is
  what a shop typed on the trip row weeks earlier, and `dive_sites.max_depth_meters` is the *site's*
  deepest point (see **Site maximum depth**), not this diver's. Logged counts and depths are what
  divers present for course prerequisites, and a divemaster handed this page to sign must not be
  signing for numbers nobody observed; those are the diver's to write on the ruled lines. Settled
  after a review found all three printing as facts (2026-08-28).
- **Dive day** — the counted unit of a diver's history with one shop: what "Your 3rd dive day with
  Blue Mantis" counts, and what a **milestone stamp** is awarded for. One calendar day in the shop's
  own zone, merged across the diver's own DiveDay bookings and the **prior visit** rows a shop imported
  from wherever it kept them before (`mergeShopHistory`, `src/lib/prior-visits.ts`) — so a two-tank
  morning and an afternoon single on one date are one day, not two. **A day nobody dived is never
  one**: a cancelled booking, a no-show, an imported visit standing `did_not_happen`, and a
  cancelled departure are all excluded, the last of those because a blow-out leaves its bookings
  active by design and the count read them as days until a review caught it (2026-08-28). **A
  `no_show` has no escape in any of the three readers** (issue #1558, settled the other way by a
  `dive-domain-expert` review on 2026-09-11). The fly-safe reader and the counter's name-match
  prompt used to let a standing desk sighting outrank it, to keep a close-of-day sweep from erasing
  the 06:40 tap. No sweep exists and none is coming: `markBookingNoShow` (`src/db/no-show.ts`) is
  the only writer of that status, it is one staffer's deliberate tap on one seat, and check-in
  refuses anything but a `booked` seat — so the sighting is always the older statement, and the
  escape only ever let 06:40 beat 07:15. **The rule is one predicate**, `diveDay()` in
  `src/db/dive-days.ts` (issue #1694, ruled H-84), and every reader applies it; the recap's own count
  (`getRecapPageData`, `src/db/recap.ts`), the counter's name-match prompt
  (`SimilarDiver.lastDiveDayAt`, `src/db/divers.ts`) call `diveDay()` whole, and the fly-safe
  reader (`peopleWhoDivedBefore`, `src/db/executed-dives.ts`) calls its halves apart. **A cancelled departure the crew logged a
  live dive on is a dive day** to all three: a logged dive is affirmative evidence that beats a
  status changed afterwards for a refund or a blow-out called after the first tank, so the count
  that feeds `visitMilestone`'s exact equality can never refuse a day the counter names. **The
  fly-safe reader alone has a second, wider escape: the roll call outranks a later desk word**
  (issue #1836). It calls the rule's two halves apart (`seatCanBeDiveDay`, which nothing outranks,
  and `deskCountsDiveDay`), so a standing roll-call result meaning the person sailed counts the day
  even when the booking or the departure was marked `cancelled` afterwards, logged dives or not,
  because both cancel doors check neither the clock nor the roll call and being wrong there hands a
  two-day diver the single-day flying wait. The name-match prompt and the recap deliberately make
  the opposite trade. Not the **Dive day (north star)**: that one is a shop's day, counted by roll
  call for the founder metrics, and never a diver's history.
- **Milestone stamp** — the drawn double-ring roundel beside the dive record, on the dive days
  `src/lib/visit-milestones.ts` names and no others: the 1st, 10th, 25th, 50th and 100th. Exact
  equality, not "at least", so a miscounted day does not blur a milestone — it skips it permanently.
  Primary ink, never coral (the thread spends its accent three times and this is not one of them),
  and on every other visit the plain ordinal line renders in its place.
- **Review request** — a "Leave a review" section on the post-trip recap page, shown only when the
  shop has set a single, optional outbound link (`shops.review_url`) in Settings — DiveDay never
  integrates with a review platform's API, never tracks whether a diver actually left a review, and
  never gates anything on it. Unconditional whenever a shop has one configured; no sentiment gating
  (asking a private "how did it go?" first) to avoid review-platform ToS risk. See
  [20260726-post-trip-review-request](../../architecture/decisions/20260726-post-trip-review-request.md).
- **Tip** — an optional, diver-initiated payment to the crew from the post-trip recap page: a full
  100%-to-shop Stripe Checkout on the shop's own connected account, same merchant-of-record model as a
  **booking checkout** but tracked in its own `tips` table (never the booking-payment gate). A diver
  picks a preset ($5/$10/$20) or types a bounded custom amount ($1–$500); its own lifecycle is
  `pending` → `paid`/`expired`, reconciled against Stripe the same way a booking checkout is — never
  trusted from a return-URL param alone. See
  [20260726-post-trip-tipping](../../architecture/decisions/20260726-post-trip-tipping.md).
- **Courtesy message** — the short text that rides alongside a trip reminder or post-trip recap, and
  the *only* channel for a diver who gave a phone number but no email. It goes out over exactly one
  of two channels, never both, chosen per shop by `sendCourtesyMessage()`
  (`src/lib/notifications/courtesy.ts`): the shop's **WhatsApp sender** when it has connected one,
  and the **SMS channel** otherwise. Any WhatsApp failure — most often a diver who simply isn't on
  WhatsApp — falls back to SMS immediately rather than being retried, because a reminder that lands
  after the boat leaves is worth nothing.
- **STOP list** — the phone numbers that replied STOP to DiveDay's texting number (`sms_opt_outs`,
  ADR [20261007-sms-stop-and-help](../../architecture/decisions/20261007-sms-stop-and-help.md)). One
  list for the platform, because every shop texts from the one number. A listed number gets no SMS
  from any shop until it replies START; WhatsApp and email are unaffected. Every SMS ends with the
  STOP line, and every phone field a diver fills in for themselves carries the **SMS consent** line
  saying which texts follow.
- **SMS channel** — an optional text channel for notifications, delivered through an AWS SNS seam
  (`SmsProvider.send()`, resolved by `smsProviderFromEnvironment()`). A number is texted only if it is already E.164, and the channel degrades to
  `not_configured` with no SNS credentials configured, exactly like the email seam. The platform-wide
  fallback half of a **courtesy message**. What happened to a sent text arrives later as a **delivery
  receipt**. See [20260802-sns-sms-adapter](../../architecture/decisions/20260802-sns-sms-adapter.md).
- **Delivery receipt** — a provider's after-the-fact report of what became of a message DiveDay sent:
  delivered, failed, bounced. Applied to the `notification_deliveries` row by provider message id,
  guarded so a stale event never overwrites a newer outcome. Every channel reports them differently —
  email by webhook from Resend or SES, WhatsApp by webhook from Meta, and SMS *not* by webhook at all,
  since SNS writes receipts to CloudWatch Logs and an AWS-side forwarder republishes them onto a topic
  the app can verify
  ([20260802-sms-delivery-receipts](../../architecture/decisions/20260802-sms-delivery-receipts.md)).
  A receipt matching no row is routine, not a fault: only a **tracked channel** has one, so a courtesy
  text sent alongside an email has nothing to update.
- **Reply keyword** — the one letter a trip reminder invites back: **C** to cancel a seat, **M** to
  ask about moving it. It is a token in a protocol rather than a word, so it is the same letter in
  every language (the whole words are accepted too, in English and Spanish), and it is only ever read
  out of a *short* reply from an address the channel vouched for — a diver writing a sentence still
  reaches the shop inbox untouched. **C alone cancels nothing.** The reply names the departure in
  full and carries a six-character **confirmation code**, signed rather than stored and good for
  half an hour, and only a reply carrying that code releases the seat — through the same
  `selfCancelBooking` the diver's own `/ready` link uses. **M is a handoff, not a reschedule**:
  moving a seat is the shop's, so the message is marked and left on the inbox worklist for a person.
  See [20260909-reply-keywords](../../architecture/decisions/20260909-reply-keywords.md).
- **WhatsApp sender** — a shop's *own* WhatsApp Business number, connected in Settings → WhatsApp
  through **Meta Embedded Signup**: the shop presses one button and completes Meta's own hosted
  popup, and DiveDay registers the number, subscribes to its delivery events, and submits the
  message template for approval on the shop's behalf. DiveDay is not the sender; the dive shop is, so
  divers see the shop they booked with and a reply reaches that shop's own inbox. WhatsApp requires
  business-initiated messages to use an approved **template**, so the template's name and language
  are stored per shop alongside its access token, which is encrypted at rest and never readable back
  out. Dormant until Meta approves DiveDay's app — the settings page says so, and courtesy messages
  go out as SMS meanwhile. See
  [20260802-whatsapp-embedded-signup](../../architecture/decisions/20260802-whatsapp-embedded-signup.md).
- **Set-up request** — a shop asking to be set up, sent from the public form at `/get-set-up` (every "Get set up" button opens it). One `setup_requests` row with the shop's answers, the contact's details and the funnel tag of the page that sent them; the founder opens the shop by hand from it ([ADR 20261007-setup-request-form](../../architecture/decisions/20261007-setup-request-form.md)). Not a booking inquiry, which is a diver asking a shop.
- **Setup link** — the single-use link that opens the sign-up form at `/onboard` for one shop. Minted for each set-up request and sent only to the founder in that request's onboarding mail; it expires after two weeks and is spent by the shop it creates. Stored as a hash in `shop_setup_links` ([ADR 20261009-single-use-setup-links](../../architecture/decisions/20261009-single-use-setup-links.md)). Not a staff invite, which brings a person into a shop that already exists.
- **Dive day (north star)** — one real shop's local calendar day on which at least one diver was boarded at a departure roll call. Counted per week, it is the north star in [rollout.md](../rollout.md#metrics--the-scoreboard). Two boats out on one Saturday is one dive day ([ADR 20261007-founder-metrics](../../architecture/decisions/20261007-founder-metrics.md)) Not the diver's **Dive day**, the unit of one diver's history with a shop that `diveDay()` counts from bookings.
- **Activation milestone** — a first-time step a real shop has taken: created, first departure, first public booking, first diver-signed waiver, first roll call, and (once billing exists) first paid month. Stored once each in `shop_milestones`. A shop is **stalled** when its newest step is 7 or more days old and the next is missing; the founder digest names a stall once.
- **Demo mode** — a shop flagged `isDemo` gets the Demo Playground banner, its role switcher, and a
  "Reset demo data" affordance scoped to that one tenant. "Try the live demo" **mints a fresh
  `isDemo` shop per visitor** with a generated name/slug, seeded with the full sample schedule; a
  daily reaper clears minted demos after 7 days. The canonical `isDemo` shop (Blue Mantis) is
  bootstrapped in every environment as the fixture the e2e/visual-regression fleet tests against,
  and is never reaped. Onboarding a **trial** at `/onboard` — which only the owner's setup link opens, since every shop is set up by hand (ADR 20260925-shops-are-set-up-by-hand) — creates a real shop that is *not* demo mode and is
  **never seeded** — it starts empty, with no playground banner or destructive reset (ADR
  20260724-per-visitor-demo-shops, superseding 20260718-production-demo-seed). A trial runs
  **3 weeks** from `shops.created_at` (`TRIAL_DURATION_DAYS`, `src/lib/trial.ts`), shown to the
  owner on Settings > Billing as days left / trial ended. Expiry is **soft**: the shop keeps working
  exactly as before past the window, and nothing gates on **billing standing**. Once billing is
  turned on, the owner moves to paid by adding a card on that page (see **Subscription** under
  Money; ADR [20261007-subscription-billing](../../architecture/decisions/20261007-subscription-billing.md)).
- **Owner reporting / monthly report** — the owner's "how's my month" view (`/shop/[slug]/reports`):
  net revenue, bookings, **fill rate**, and **waiver completion** for the trips that departed in a
  chosen month, plus a per-trip breakdown. Trip metrics remain anchored to trip-departure month in
  the shop timezone. Net revenue starts with money actually collected on those trips' bookings
  (`paid` + `deposit_paid` payments), then may include a separately named, unverified imported
  payment/refund slice by source calendar date when its currency matches. Owner/manager only. See
  [20260723-owner-reporting](../../architecture/decisions/20260723-owner-reporting.md) and
  [20260816-imported-payment-history-is-evidence](../../architecture/decisions/20260816-imported-payment-history-is-evidence.md).
- **Fill rate** — seats booked ÷ seats offered. On a report it is the month's active bookings over
  the sum of its trips' capacities; on one trip it is that trip's active bookings over its capacity,
  capped at fully booked. "Active" excludes cancellations and **no-shows**. That is **not** the
  manifest roster, and since the counter could release a seat the two have drifted further apart
  than a filter. The manifest still lists every non-cancelled booking, no-shows included, because a
  name the desk wrote off is a name the crew must account for at roll call (`getTripRoster`,
  `src/db/trips-roster.ts`) — but the seat behind that name may since have been sold to somebody
  else, so one departure can carry two names for one seat and count it once. Fill rate is a
  commercial measure of seats that earned; the manifest is a head count of who may come aboard,
  which is why carrying more bodies than seats is something it *says* (`summary.overCapacity`)
  rather than something it prevents.
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
  refused. See [20260726-staff-invite-accounts](../../architecture/decisions/20260726-staff-invite-accounts.md).
