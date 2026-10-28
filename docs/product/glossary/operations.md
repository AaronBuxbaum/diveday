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
  Today's work queue, ranked by tone and then by when it is due, and **grouped by boat** (fifth
  loop, item 11): one heading per departure, naming the boat and its time once and linking to the
  trip, with that boat's rows under it in rank order. A boat's group sits where its most pressing
  row ranked. Rows bound to no departure (unanswered messages, found items waiting to go home)
  follow every boat as **The desk** group. A row about the shop that names a boat, such as a blank
  emergency reference, is filed under that boat so it keeps its rank. It sits under the day's
  departures, which carry no rows of their own. A status list, not a page: an empty one is not drawn. Each diver is named
  once under each boat they are on: one row with their name over what is wrong in a few words
  ("Waiver not signed, not sent yet."), or, when several things are open for them, over that sentence and every other
  item ("Priya Sharma · Waiver not signed, not sent yet; also emergency contact"). A readiness
  blocker always leads and keeps its own button and its own words. Counts stay only
  for what cannot name a person, such as a boat's open orders, and for a batch fix: two or more
  divers on a boat sharing a waiver gap get one row above them that sends every waiver at once. A boat with many rows shows its
  first five and folds the rest behind "and N more"; a danger row or a readiness blocker never
  folds. No row carries the
  levels — the roster and the diver record carry the full sentence. Failed emails of one kind and one cause are one row with one resend, however
  many people they missed. **A crew reader's lens** (UX audit 2026-10-07, item 7): for a captain or
  divemaster who crews one of today's boats, the list leads with that boat's rows, every
  danger-tone row about any boat (a diver unaccounted for is everyone's to see), and any row about
  the reader themself, such as their own credential coming due; the rest — other boats' work and
  the desk's — folds into one closed line, "N more for other boats and the desk", never gone. A
  trip page's "Needs you · N" counts that boat's rows through the same lens, so a divemaster and
  the owner can read different numbers for one boat: it is the reader's share, not the boat's list.
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
  manifest, for the same diver. **The offline manifest is a deliberate exception**: it never resolves through those helpers,
  because a snapshot on a boat with no signal cannot know whether a waiver was signed or a card
  sighted since it was taken. Since the 2026-10-24 visual review (B01) the qualifier is said
  **once, at the top of the page**, rather than on every chip: the banner under the title reads
  "Saved {when}. Readiness reflects that moment…" (`shared.offlineManifest.single.freshnessBanner`;
  `unansweredBanner` and `expiredBanner` in their states), and each row's status line then says
  the bare word ("Blocked", `.blockedBadge`) with the blocking reason. Dropping that banner would
  be the one lie a roll-call surface must not tell — a stale copy reading as current
  (design/principles.md #4, "safety surfaces keep their precision"); a future change that removes
  or hides it must put the qualifier back on every readiness word under `/offline-manifest`. The
  **refusal** keeps its own past tense: the sentence a turned-down boarding tap shows
  (`shared.offlineManifest.single.record.notAllowed`) reads "wasn't ready to board when this
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
  aboard. One exception runs the other way: an after-dive count started and still open reads
  `still_out` ("Dive 2 count open, 2 people and 1 crew member to mark"), a count in progress rather
  than one never closed, only before she is due back, on a trip within today's shop day, when every
  open count on the boat, diver and crew, is at the latest checkpoint anybody marked with no later
  dive logged, while somebody was marked there within the last 20 minutes (`OPEN_COUNT_QUIET_MS`;
  a missing mark time reads loud, issue #2925), and never on a past day's record; a person recorded not back
  aboard, diver or crew, reads `unreconciled` wherever the boat is. There is **no act of closing the day**: a "Close the day" button that recorded who closed
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
- **Walk-in** — a person who turns up at the counter for a boat that has not left, seated from the
  departure door in walk-in mode (`walkIn=true`, entry `walk_in`, activity `seat_added_walk_in`).
  The mode is a claim from the client and holds only while the boat's **counter window** is open;
  in it a name is enough (the email is optional) and the seat is told as a walk-in. Every gate is
  the departure door's own: readiness, admission, waiver and capacity. The old
  `/trips/[id]/walk-in` page is gone and redirects to the door.
- **Counter window** — when the counter may still seat a walk-in on a departure
  (`walkInDoorOpen`, `src/lib/operational-window.ts`): it starts inside the arrivals window and has
  not sailed (the one departure buffer). The staffer's door and the seat action both ask it, so a
  typed URL or a stale page cannot seat someone on a boat that has gone.
- **Counter payment hold** — Cash or Card machine tapped on an open order's Record payment row: a
  **held send** of kind `counter_payment` (`src/db/counter-payment-hold.ts`) that records the
  order's balance only when its eight seconds run out, or as soon as the screen leaves (closed,
  hidden, or a navigation inside the app), with the hourly sweep as the fallback. Every path
  records the tap's own time as `paid_at`. The row reads "Recording $340.00 cash" with Undo; Undo
  records nothing, an Undo the hold outran says "Too late to undo", and a second tap inside the
  hold is the same hold. A hold that finds the order no longer open records nothing and writes a
  line in the shop's log (issue #3030, H-159).
- **Walk-in party** — several people seated in one counter submission: the first person's own
  fields plus further rows (`member-<n>-…`, `src/lib/walk-in-party.ts`), each seated by the
  walk-in door with every gate its own. A name that reads like someone on file is settled row by
  row (the record, or a new person) before anyone is seated. Staff can open the party's waiver
  queue after seating or from the roster. Each person scans only their own code and signs on their
  own phone; a minor's release also asks for a parent or guardian, and a held identity must be
  confirmed before a code is issued. The queue reports waiver and medical status without answers;
  a signed waiver alone does not establish boarding readiness.
- **Coming as** — a walk-in's participant type (diver, snorkeler or rider) on its row. The first
  person's posts as `participantType`; a blank reads as a diver, the stricter default.
- **Under 18** — the booker's tick on a walk-in row that this person is a minor. It asks for a
  date of birth beside it and feeds the guardian rule alone; a ticked row routes the whole form
  to the party seating.
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
  until the diver checks in, which clears it. The boat manifest says it too, live and on the
  **offline copy**, so the rail does not call missing a diver who said they are on the way: at the
  departure checkpoint only, and hidden on a row already boarded, checked in or released
  (`runningLateOnManifest`, #2319); after a dive the question is who came back, and the word is
  gone. A row the crew recorded as not boarded keeps it. **It gates nothing** and it is not a **no-show**: the
  diver still has to arrive, and a diver who said it and never came is still the desk's call.
- **No-show** — one staffer's recorded statement that a booked diver did not come. The status is
  `bookings.status = "no_show"`, written by `markBookingNoShow` (`src/db/no-show.ts`), behind
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
  a **dive day**, in any of the four readers that count them. The same status, with a reason, is
  also how a seat is **turned away**.
- **Turned away** — the desk saw a diver readiness would not board and sent them home (H-135). Its
  writer, `turnBookingAway` (`src/db/turn-away.ts`), sets `bookings.status = "no_show"`,
  `bookings.turned_away_at` (the fact) and `bookings.turned_away_reason` (the category), so the seat
  is released exactly as a **no-show**'s is, and every reader that leaves a no-show out (capacity,
  recap, tips, dive days) leaves this seat out too. What differs is the statement: seen and refused,
  not "did not come", and every surface that names a released seat says which (the desk's own group
  and line, the manifest pill, the dock copy's badge, the diver's story, `bookings.csv`, the trail's
  `booking_turned_away`, the departure log's seat line, and the crew's catch-up strip when Remove
  takes the seat off), reading `turned_away_at`. **Any active staff member, on a blocked row
  only**: the reason is one category from that row's own readiness blockers (`turnAwayReasons`,
  `src/lib/turn-away.ts`: medical, waiver, card, age, identity, payment), re-read under the seat's
  lock, and never the evidence: no medical answer or card detail is stored. The desk's door and the
  writer read one predicate (`turnAwayOffer` / `turnAwayGate`). Open before the boat leaves, unlike
  "Not here", inside the **arrivals window**; **an arrived (checked-in) diver cannot be turned away
  from the boat's scheduled start** (`sailed`; the boundary "Not here" opens on, not `hasSailed`'s
  buffered hour), while a booked row after the start keeps the door. On a
  **held seat** only "identity" (and "payment" when the seat owes) is offered or accepted, the trail
  names the booked-as name (`seatName`, as "Not here" does), the matched diver's story says nothing
  about the seat, and a split clears the category. A turned-away seat **cannot be paid** from the
  diver's page (checkout and `canPay` take a held seat only); before the day ends that page says
  only "The shop released your seat on this departure. Talk to the desk."; reminders skip it. Its
  next day is **the same booking moved** (`moveBooking` books it on the new departure and clears
  the turn-away; payment and package coverage ride on the row), never a new seat, and **only before
  the departure's scheduled start**: from it, and always for a party's lead (`leads_party`), the
  door is Remove (default for dde-3 #4/#5). Releasing the seat (turned away or "Not here")
  **withdraws any pending checkout** on it, so a late payment lands as paid after close, and checkout
  recovery skips a seat no longer held. A lead's page keeps the party claim panel. **Removed
  afterwards** it reads "turned away, then removed": no cancellation window applies, nothing is
  refunded on its own (`manual`, `turned_away`), and `turned_away_at` stays. **Erasure** clears the
  category and keeps `turned_away_at`. "Put back on the list" (only before the scheduled start,
  `turned_away_departed` after it), the rail's reclaim and a move clear both, and a seat back on the
  boat never carries either (`bookings_turned_away_is_released`). The rail's reclaim is refused for
  capacity **at the departure checkpoint only** ("Boat full. See the desk.", `boat_full`; default
  for dde-3 #6); an after-dive head count is never refused, and a boat over shows as the manifest's
  over-capacity count.
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
  departure**, and beside each day carries a one-tap **direct invitation** to it
  (`offerDepartureToDiver`, `src/db/trip-invitations.ts`): the diver books the seat themselves from
  the link, and a diver who turned off shop email is not emailed. Only a day that diver could book
  is named or sent: open, not private, not yet left, with a sellable seat, and one their cards admit
  them to (`departureOpenToDiver`). The third is said plainly, because a surface that invents an
  offer here is worse than one that says nobody is waiting. No branch seats anyone or moves money;
  the money is one sentence and a link to that diver's orders.
- **Crew schedule** — whether a shop plans its crew in DiveDay (`shops.crew_schedule_enabled`, Settings
  → Features, **on for a new shop** since 2026-10-23). On, the shop has the Crew view of Schedule (working shifts, days
  away, crew asking for a departure), the crew line on the week, and the nudges measured against
  its **Target diver:divemaster ratio**. Off, all of that is gone. Every departure keeps its crew
  editor either way, because who is aboard is manifest data (the crew roll call, the souls-on-board
  count) and a course session's agency ratio gates enrolment from it (`src/lib/crew-schedule.ts`,
  ADR 20261005-crew-schedule-is-a-setting).
- **Optional feature** — a feature a shop can switch off on the **Features** page of Settings (`/settings/features`, which also holds the crew schedule, Stripe Tax and the kinds of diving a shop runs): diver reviews, date
  requests, the last-minute list, tips, "Our year", the **PADI checks**, Claude suggestions,
  recap highlights without a tap, lost and found, gear servicing (work orders), promo codes, dive
  packages, **Hotel pickup**, checkout reminders (abandoned-checkout emails), bring a buddy,
  marine-life sightings, recap photos, counter sign-up (QR self-registration), the wait list,
  past-diver invites, help requests, partner links, the week-out reminder, public conditions and
  the field guide
  (`src/lib/shop-features.ts`, one `shops` column each, every one on for a new shop). Off hides the feature on every surface that offers it, redirects
  its staff pages and deletes nothing (ADR 20261005-optional-shop-features).
- **Feature coverage** — the one answer, per staff destination and per boolean on `shops`, to "is
  this something a shop could run without?": its Features switch, or `core` with the reason it
  is not (`src/lib/feature-coverage.ts`). A new destination or column cannot ship unclassified,
  and a destination tied to a switch that is off leaves the nav, the section tabs and ⌘K.
- **Hotel pickup** — whether the shop collects divers from where they are staying
  (`shops.offers_hotel_pickup`, Settings › Features, on for a new shop and every seeded one
  since 2026-10-23; a shop that runs none turns it off). Off withdraws the offer only: no diver is
  asked and the roster has no pickup form, while a pickup a seat already holds still shows to the
  crew and the diver. Only when it is on does a diver's `/ready` ask "Want a pickup?" and where they are
  staying (`bookings.hotel_pickup_location`, refused by the server otherwise). Staff then set the
  seat's pickup time (`bookings.pickup_time`), and the night-before brief gives that
  time and place instead of the dock arrival time. A **seat move** clears the pickup time.
- **Lunch aboard** — `trips.lunch_aboard`, set on a departure's Details ("Lunch served aboard").
  Only on such a departure does the diver's Day-of form ask for a lunch preference and the desk's
  roster row offer a lunch note. Prep (and the paper day, which prints it) says "Lunch for 14" (every
  seat and the crew aboard), each **dietary note** by name and "N of M left a lunch note" (seats
  only: crew have no note); the manifest row and the offline copy show only each person's own note,
  with no count. Gates nothing.
- **Dietary note** — `bookings.dietary_note`: a seat's meal preference for that day's galley
  (vegetarian, halal, no pork), 160 characters, from the diver's Day-of form or the desk. **A galley
  note, not an allergy record**: a food allergy is medical, belongs on the person and on every
  departure with whether they carry an auto-injector, and is not modeled yet (dive-domain review
  B1). So the form never invites one and sends an allergy to the **medical alert for the crew** (the
  waiver's "For the crew, in an emergency" box, H-153), and an empty list is never
  read as "nobody has a restriction". It is in the diver's own export, cleared by erasure, and
  nulled 30 days after the boat sailed (`DIETARY_NOTE_RETENTION_DAYS`).
- **Working shift** — a dated availability window for a staff member. It is not a crew assignment:
  the shift says who is available, while the trip assignment says who is actually on that
  manifest. Overlapping shifts for one person are rejected.
- **Days away** — a crew member's own range of calendar dates they told the shop they are away
  (`crew_availability_blocks`, ADR 20260902-crew-requests-and-blackouts). Informs, never gates. Its
  optional note is read only by the person and by owners and managers (issue #2673); everyone else
  sees the dates. A rostered crew member away on a day a departure meets raises Today's `crew_away`
  row and reads "to be confirmed" on the diver pages (`crewAwayByTrip`, `src/db/crew-away.ts`).
- **Working it anyway** — a staffer saying an away crew member is working one departure all the
  same (`crew_away_acknowledgements`, issue #2678), tapped on Today's `crew_away` row. Per crew
  assignment, and only while the person is away on a day the departure meets; never said by the
  person about themself. It clears that row and the diver-side mark for that departure only, never
  edits the person's days away, does not cover a day away told after it, and goes when they come
  off the crew, when the departure's dates move, or on "No longer working it" under the trip's
  crew panel, which records who took it back. The departure log and
  `crew_away_acknowledgements.csv` keep the trail.
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
- **Tight turnaround** — the near miss beside a clash (issue #2141): a move that leaves less than the
  shop's **minimum turnaround** (`shops.min_turnaround_minutes`, default 30, set on the dock-day
  settings page; 0 turns it off) between one departure due back and the next leaving, on the same
  hull or for a crew member leaving from a different meeting point. Said on the Move panel only, as
  one muted line naming the other departure and the minutes, under any clash line
  (`moveTurnarounds` in `src/db/move-preflight.ts`). Advice, never a refusal; nose to tail stays no
  clash under H-80's predicate, and a crew hand-off on the same dock stays quiet.
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
  `invalid` means staff must stop and investigate. The signed records' **Can’t be checked** view
  lists the `unsealed` ones. A release that asked **shop questions** seals the diver's answers too:
  the snapshot joins the sealed set only when it is there, so a release signed before shops could
  ask anything keeps the digest it was sealed with, and an erasure's re-seal leaves the answers out
  (ADR 20260729-staffing-waiver-audit-and-localized-copy, amendment of 2026-10-23). A **medical
  alert for the crew** joins the sealed set the same way, only when there is one; the version 2
  (erased) seal leaves it out, so a version 2 record carrying an alert reads `invalid`.

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
  never runs out. The public schedule's last month says so for each open-ended public run, in its
  cadence words, with the date request beneath.
- **Standing crew** — the crew a repeating trip sails with on every date, kept on the run itself
  (`trip_series_crew`: who, and the job each does; a run with no rows has none). Set by "Apply this
  date's details" with its crew switch on, which records this date's crew as the run's, crews every
  upcoming date like it, and makes the horizon roll seat that same crew on each new date. The roll
  reads the run's crew, never the furthest-out date's, so a date left short does not shorten the
  dates after it. Every date is still asked on its own: a person already on an overlapping
  scheduled departure, or no longer on the staff, is left off that date; a course session the rest
  would leave without an instructor gets nobody; and ratio gaps are read per date as for any
  departure. A crew member's own blackout does not keep them off a rolled date: it informs, as
  everywhere, and the staffing week shows the clash. Not a lock: every date's crew stays editable
  on its own (ADR
  [20260810-open-ended-recurring-trips](../../architecture/decisions/20260810-open-ended-recurring-trips.md),
  addendum 2026-10-12).
- **Back on the water** — the date a shop types beside its season start for when it reopens
  (`shops.reopens_on`). The public schedule's off-season card names it while the board is quiet
  and the date is still ahead, unless a departure is scheduled sooner: the card names whichever
  comes first.
- **Skipped occurrence** — a date staff deleted outright from a repeating trip. Recorded so the
  horizon never puts it back (`trip_series_skips`); cancelling a date, by contrast, keeps the trip
  and can be reinstated.
- **Seat claim** — a party member taking over one seat of a party booking as their own identity,
  through a bearer `/claim/[token]` link the organizer shares (a `claim`-purpose
  `booking_capabilities` row; [20260804-seat-claim-links](../../architecture/decisions/20260804-seat-claim-links.md)).
  Claiming re-points the seat's existing booking at the claimant's own person record and starts
  their own waiver and trip prep; the organizer's surfaces show which seats are claimed. It never
  creates or frees a seat, never moves money, and is never required — an unclaimed seat boards
  under the organizer's party exactly as before claiming existed. When the organizer cancels their
  own seat from `/ready` or with a reply confirm code, their unclaimed `booked` seats on the same
  departure are cancelled with it and refunded under the same policy; a claimed seat (or one
  already checked in) stays, and the `/ready` confirm lists both before the tap. A cancelled seat
  with an address of its own gets its own cancellation notice (`cancelUnclaimedPartySeats`,
  `settleReleasedPartySeats`, batch 6 item 10).
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
- **Interest** — a person who asked for a seat, one row in `interests` with a **scope**: `departure`
  (asked for this boat: the wait list, a cold invitation, an offer), `date` (asked for a day that is
  not on the board: a date request, which may live on a name and email alone, H-13) or `anytime`
  (the last-minute list: "I'm around, tell me if something opens"). It runs asked, offered, closed
  (`booked`, `done` or `unsubscribed`). An interest reserves nothing and never reaches a manifest;
  "booked" is derived from the bookings for a departure interest. Named so it never meets a
  **party lead** (a booking's organizer, money.md); staff never see the word, they see **Who wants
  in** (ADR 20261017-one-interest-with-a-scope, H-145).
- **Who wants in** — the one panel on a departure's Divers tab that lists every interest that could fill
  it, in three groups that keep the order people asked in and are never ranked by fit: asked for this
  departure, asked for this date, and around these dates. It renders only when a group has someone.
- **Offer a seat** — the one staff act on an interest: tick people in Who wants in and send, always held
  8 s with Undo. It writes a departure interest for each person (copied from a date or anytime interest,
  with `parent_interest_id`), sends one email, and may carry a **last-minute deal**. It reserves
  nothing: the diver books like anyone else. A ticked row below the bar may be offered with a
  warning; "everyone who fits" sends only to rows that fit; the counter's "Email them this date"
  stays immediate and refuses what `departureOpenToDiver` refuses.
- **Wait list** — the diver-facing name of a departure **interest**: divers who asked to hear if a full trip frees a seat. It is not a
  booking, does not consume capacity, and never appears on a manifest. It is also **not a queue**:
  joining buys no standing, and staff invite whoever fits the departure. The join date is kept and
  shown to staff, so the longest wait is visible without being owed anything
  (ADR 20260813-wait-list-is-a-lead-list).
- **Wait-list party** — the people one wait-list entry waits for: the joiner and whoever dives with
  them, held as a count on the entry (`interests.party_size`, 1 to 20 and never more than the departure's seats), with only the
  joiner's own details. A party waits until the whole party fits: the join is refused as
  "go and book" only when that many diver seats are free, an invitation is sent only when that many
  seats are free, and an invitation out counts that many seats against the next. A person-less
  date-request offer stops counting after 48 hours; a resend starts that interval again (#2914).
  This is advice about further offers, not a reservation: booking still checks capacity. A couple is never
  split across dates. Staff read "Party of 2" on the row; the demand count adds parties, not rows
  (ADR 20260719-trip-waitlist, amended 2026-10-15).
- **Wait-list roll** — the wait list following the divers rather than staying on a day that is gone or full. Nightly, beside the series roll, a series date that sailed hands every interest nobody invited to the next public date of the run that takes a seat (a date on a conditions hold or made private is passed over). The existing wait-list invite then goes out to that date's whole queue in the order people asked, while it has seats nobody has been invited to, measured as a sale would measure them (sellable seats, the divers-only limit, a course's instructor and ratio); a **wait-list party** is invited only when its whole party fits, and a smaller interest behind it may still be. The rolled invite says so in its own sentence ("Sat, Oct 17 has sailed. Sat, Oct 24 has room": a date can sail with a seat free), never as though the diver had asked for the new date. An interest staff already invited stays where they left it. From a full departure's demand banner, or under the wait list of a full departure with even one interest, "Carry the wait list" hands every interest to a departure staff choose (each offered with the seats it has left), with no message until staff invite. Entries are copied, keep the time the diver first asked and their party, skip anyone already seated there, and never rank anybody. `src/db/interest-roll.ts`.
- **Last-minute list** — the diver-facing name of an `anytime` **interest**: a shop-wide (not per-trip) opt-in of divers who want to hear about
  last-minute deals, each with an optional date range they said they're around. Distinct from the
  **wait list**: the wait list is per-trip interest in a charter that's already *full*; the
  last-minute list is a general "I'm around, tell me if something opens at a discount" signal used
  to fill a trip that is *under* capacity. See
  [20260727-last-minute-fill-promos](../../architecture/decisions/20260727-last-minute-fill-promos.md).
- **Last-minute deal** — an **offer** that carries a discount: a staff-sent, time-boxed discount on one under-capacity trip: a real Stripe
  `Coupon` + `PromotionCode` created on the shop's connected account (percent off, expiring at the
  trip's departure, capped at the trip's open-seat count), emailed to every last-minute-list entry
  whose date range covers the trip. The diver redeems it by typing the code on the booking form; it
  is validated against that specific trip before being handed to Stripe Checkout, so a code issued
  for one trip cannot discount a different one. See
  [20260727-last-minute-fill-promos](../../architecture/decisions/20260727-last-minute-fill-promos.md).
- **Thin boat** — a departure in the next 14 days (`THIN_BOATS_HORIZON_DAYS`) that could use
  divers: short of the minimum it must reach to run while that call is still ahead, or, with no
  minimum, less than half of its sellable seats sold (`thinBoatNeed`, `src/lib/thin-boats.ts`).
  Listed on a quiet Today. A boat short of its minimum says it cancels itself and has a door to the
  minimum; the deal door shows only inside three days of sailing; a fun dive offers its **invite
  suggestions** and a course session points at the **course ladder** instead.
- **Invite suggestion** — a past diver a departure's Invite section names ("Dived the Wall with you
  before"), for a one-to-one invite (H-130). Only a diver's seat on a departure that was not an
  intro session counts as having dived the site, everyone listed passes the departure's own
  admission gate (`tripAdmissionFor`), and a course session suggests nobody. Leaves out anyone
  aboard, already invited to it, inside the **30-day invite cooldown**, opted out, erased or merged,
  and anyone whose release waits on a physician's referral (the course ladder's `physicianReferrals`;
  the send re-checks it under the cooldown lock).
- **30-day invite cooldown** — no second one-to-one invite to the same person inside 30 days
  (`INVITE_COOLDOWN_DAYS`, H-130), counted from when the invite was recorded. Its scope is the
  invite suggestions and the course ladder, which leave such people out and re-check under a lock
  on (shop, person) at the send. The trip page's manual "Invite a person" does not apply it; whether
  it should is a filed decision.
- **Dock call time** — how many minutes before departure a shop asks divers to arrive, for gear
  setup, cert checks, and the briefing (`shops.dock_call_minutes`, default 30). Configurable per
  shop in settings because real muster times vary; it drives the arrival copy on booking
  confirmations, the diver's dock-day rhythm, and every pre-trip reminder, so no surface hardcodes
  "30 minutes".
- **Crew dock time** — when a crew member should be at the dock for a departure (`crewCallAt`,
  `src/lib/dock-call.ts`): the shop's crew lead ("Crew arrive N minutes before divers",
  `shops.crew_lead_minutes`, default 30, H-149) before the divers' dock call time, or with none set
  the divers' dock call time, which the line names as the divers'. A shift of their own that starts
  before the departure and is still running at that call wins only when it starts earlier, so the
  line never names a time later than their own shift, and a shift never makes it later.
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
- **Snorkel-suitable** — the shop's yes, no or not-said about whether a **dive site** is any good
  for a snorkeler (`dive_sites.snorkel_suitable`, issue #2214), set beside difficulty and copied
  from a common-site template where the template knows; an import sets it only from an explicit
  yes or no. Null is not said and never reads as no. It only ever raises a warning-tone line on a
  departure's "Snorkelers and riders" row when snorkeler seats are open or a snorkeler is booked,
  and every planned site says no (`snorkelersOnUnsuitableSites`); it
  never refuses a snorkeler's seat, because the captain picks the site on the day.
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
  course and environment. A course session can plan up to five dives; an ordinary departure
  can plan up to four. The count is a plan, not a record of underwater groups or completed dives.
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
- **Meeting point** — where a diver goes for one departure: the trip's own label and address
  (`trips.meeting_point_label`, `trips.meeting_point_address`, free text and never geocoded, since
  "the gravel lot past the ranger station" is exactly what it exists to name), or the shop's own
  address under the shop's name when the trip sets none. One shape, `meetingPointOf` in
  `src/lib/meeting-point.ts`, feeds every diver surface (the public trip page, `/ready`, the
  confirmation, both reminders, the paper pass), and staff read the same fact as "Where we meet" on
  the trip's Details tab and first in the manifest's plan (`meetingPointLine`, label then
  address). A change to it is a `meeting_point` line on the catch-up strip, and a reschedule notice
  repeats it only when it moved in the same save. Not the dock call, which is when to be there.
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
  own list on the `/safety-checklist` register. Distinct from **roll call** in every way that matters: it happens once per
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
  certificate, and "apply to the rest of the series" gives a date on a smaller hull the details
  with its seats capped at the certificate; only a date holding more seats than that, or with a
  roll call past the new dive count, is left alone.
  The field reads **passengers only, not crew**, the same people capacity counts: everyone aboard
  but the crew. A boat saved over it before H-107 keeps sailing, its fleet row says so in danger
  ink, and its next save must fix it (`src/lib/boat-safety.ts`).
- **Certificate total-persons limit** — the second number some certificates print: everyone
  aboard, **crew included** (`boats.certified_total_persons`, issue 2302). Optional, and independent
  of the **certificate passenger limit**: some flag states (Spain among them) print only this one,
  and a certificate with only a passenger figure is never asked for it. Checked at the manifest
  beside the passenger line and never at the point of sale: when the people booked plus the crew
  named for the departure pass it, the Boat tab says so in danger ink, and once the crew roll call
  has counted more people and crew aboard than it allows, the line counts them instead, and the
  head count goes danger. Passengers or seats above persons is refused at save as a typo
  (`passengers_above_total_persons`, `seats_above_total_persons`). The booking
  transaction counts seats exactly as before (Aaron, 2026-10-13).
- **Boat papers** — a boat's four dated documents: when its certificate itself expires (a
  Certificate of Inspection runs for years, apart from the annual inspection, issue 2302), when its
  next safety inspection is due, and when its registration and hull insurance expire
  (`boats.coi_expires_on`, `inspection_due_on`, `registration_expires_on`,
  `insurance_expires_on`). Typed over in Settings, Boats when renewed,
  so the paper itself is the history. Each has its own window — 90 days for the certificate and the
  inspection, 60 for registration and insurance (`BOAT_PAPER_HORIZON_DAYS`) — inside which a departure on that boat
  names the paper above its pre-departure checklist and Today carries a quiet owner errand
  (`boat_papers_due`). Once a paper lapses it reads in danger ink with the boat and the date
  ("Hull insurance ended Oct 8."), and Today shows it as its own danger row, `boat_papers_lapsed`,
  labelled "Papers lapsed", to owners and managers only. Hull insurance lapses on its expiry date
  itself, since the policy's cover ends that day. A paper still good today that lapses before a
  later departure reads "ends {date}, before this departure" on that departure. A lapsed paper
  never blocks a departure (H-136). `boat_safety_expired` is the safety kit's row, not the papers'.
- **Boat at departure** — the boat's papers and its papers-and-kit notices as they stood when the
  boat left, kept for the departure log (`departure_boat_safety_snapshots`, issue 2300). Written by
  each departure roll-call tap, diver or crew, live or synced, as of the tap. The record carries its
  scheduled departure instant. With known-unsailed provenance, a departure roll-call tap or boat
  change can refresh the record; an unsailed reschedule rebinds that instant under the trip lock.
  Unknown departure-time provenance keeps the existing evidence unchanged rather than guessing it
  may be rewritten. Once the saved departure instant has sailed, a kept record is never rewritten,
  including by a delayed offline tap; the first late sync may fill an absent record when its tap
  was before sailing. Later time edits and hull changes cannot reopen sailed evidence. An older
  tap never overwrites a newer record. Judged on the departure's own
  local day; a deleted hull supplies no fresh evidence and does not remove kept history.
  The log prints the pre-departure checklist's answer as of the same tap beside the notices (the
  lines on the list at that tap and each one not checked, issue 2725). It is read from the
  append-only checklist taps by when they happened, not stored, so a tap an offline tablet syncs
  after the count still counts if it was made before it.
  Head-count lines are left out because the roll call records them. The log says when
  nothing was kept or the departure names no boat, and when the departure has moved to another
  boat since.
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
  for, and a diver's story says "not counted back aboard" over that seat, never an ordinary
  "sailed". The dock still wins where it *spoke*, which is what keeps the ashore-then-boarded-later seat
  out of a count that asks how many the vessel left with; for one slice its *silence* won too, and
  the evening read "0 out, 0 back" over a boat carrying a missing diver (issue #1704). It is **not**
  `booked`, and the two must not be collapsed — every question about seats *sold* still reads the
  roster, because a released seat never came back to the shelf. Its reader is the evening's
  **souls on board** line, whose crew half is the same idea: assigned crew less the ones a human
  recorded ashore at the dock. A finished departure's Divers tab files its record by the same rule,
  seat by seat, so the record and the evening count never disagree about one diver: a diver picked
  up at the second site with a standing after-dive result is under "Sailed". Silence there is not
  counted as sailing: a seat nobody spoke for is **Not counted at the dock** or **No roll call
  taken**, never "Sailed" and never **Didn't sail**.
  A **crew sailing** is one crew member on one departure that is home, unless the crew marked
  them ashore at the dock; the Safety page reads each against the crew member's credentials as they
  stand today, on the departure's last day.
- **The record** — a home departure's Divers tab: each seat filed under **Sailed**, **Didn't
  sail**, **Not counted at the dock** or **No roll call taken** (`recordGroups`,
  `src/app/shop/[shopSlug]/trips/[id]/_components/roster-model.ts`), built from the crew's
  roll-call results and the desk's no-show marks. It says who the crew counted aboard. It does
  **not** say whether those divers were ready to board at the time: `roll_call_events` stores no
  readiness snapshot, so a diver under "Sailed" may have boarded with a blocker the crew overrode
  or never saw, and any readiness shown beside the record is today's, not the day's.
- **Didn't sail** — a finished departure's record band for the seats somebody *said* did not go:
  the crew's `not_boarded` at the `departure` roll-call checkpoint, or a released seat (`no_show`)
  nobody counted aboard at any checkpoint. Only a statement files a seat here (`seatSailed`,
  `src/lib/closeout.ts`; `recordGroups` in the trip's `roster-model.ts`). It used to take every seat
  without a dock `boarded` once one seat boarded, which filed a diver picked up at a later site, and
  a seat nobody counted, as not having sailed (dive-domain review of UX batch 1). Spanish: "No
  zarparon".
- **Not counted at the dock** — a finished departure's record band for a seat with no dock result,
  no standing after-dive result and no `no_show`, on a departure whose dock roll call *was* taken.
  It names a gap in the count, not a fact about the diver: nobody said they sailed and nobody said
  they stayed. Spanish: "Sin contar en el muelle".
- **No roll call taken** — the same silence on a departure with no dock roll call at all, under a
  band that says so rather than a guess. Whether a roll call was taken is read from the events
  themselves (`departureRollCallTakenTripIds`, `src/db/manifests.ts`: any `departure` checkpoint
  event recording `boarded` or `not_boarded`), never from whether a seat reads boarded now, so a
  departure whose whole roster stayed ashore, or whose boarded seats were later cancelled, never
  reads it. Spanish: "Sin pase de lista".
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
  complete append-only roll-call timeline (corrections included), certification evidence captured
  for each live departure boarding request, labeled with its read interval separately from cards held now
  (the read may follow the tap and may wait while a card changes; an older or offline boarding has
  no captured card evidence and says unavailable; an empty capture says no cards were on file),
  waiver **status** (state, date, template version — never the medical questionnaire's answers),
  the **buddy pair** staff recorded for the departure — a stable team number, the buddy's name,
  and who recorded the pairing when, since a pairing decided at the dock and one typed in that
  night are different facts (the live manifest's split-team alert is deliberately not restated: it
  is a *reading* of the roll call at one moment, and this document reports recorded facts) — crew
  and crew counts, and generation metadata. Its timeline also carries:
  - each **seat or crew change** made once the boat was due out (the scheduled start, or the first
    departure roll-call mark if earlier), named by the trail and only when it names its subject by
    record, a **turned away** seat among them, with its category;
  - a line erased at a person's request, which names nobody.

  It ends with the departure's **incident reports**, as a list (kind, severity, filed or draft, by
  whom, deleted drafts too), never their contents. It reports recorded facts with timestamps and
  computes no safety judgment; every absence is stated ("Awaiting", "No certification evidence on
  file") rather than left blank. Evidence that lapses with time, such as a waiver, is stated as it
  stood when the boat was due out, not when the log was printed. A SHA-256 **integrity code** over
  the printed facts sits in the footer with its **version**. It is tamper-evidence, not a
  signature: regenerating the export from unchanged records reproduces the code, so two copies can
  be checked against each other. Version 2 prints, but does not seal, when the log was made and for
  whom; version 3 seals the boarding snapshot but excludes the separately labeled current cards.
  Earlier codes cannot seal a captured boarding snapshot. Version 1 is refused for a log holding anything version 2 added (a late seat or crew line,
  an incident report) or a line later than the log says it was made (ADR
  20261016-departure-log-code-v2). Owner only, one tap from
  the manifest (`/shop/<slug>/trips/<id>/log`).
- **Incident report** — the shop's own written account of something that went wrong on a
  departure, for an insurer or an authority: when (in the shop's zone) and where, what happened,
  first aid, oxygen (and for how many minutes), whether emergency services were called, the
  **handover** (nobody — they stayed with the crew — or EMS, a hospital, a chamber, the person
  themselves released on scene, or someone else, and when), and follow-up notes. It names the
  people involved — a diver by their seat, a staffer by their record, anyone else by name — as
  affected, witness or gave aid. A **draft** is edited; filing needs the time, the place, what
  happened, the three yes/no answers, and the handover once emergency services or oxygen were
  involved, and a **filed** report is never
  edited again: what comes later is an **addendum**, dated and attributed. An unfiled draft can be
  **deleted** (softly; the departure log still lists it), and a second start reopens only an
  untouched draft, or for a **missing diver** the one report, draft or filed, naming that person
  as affected since they were last marked back aboard (ADR 20261016-incident-drafts). The
  departure's crew
  start one and read their own; owners and managers read all of them, on the trip's Details tab
  and the Reports **Safety** tab. Nothing a diver sees, and never a gate. It is not the
  **departure log**, which prints recorded facts and judges nothing; the report is the shop's
  narrative beside it. Filing a report of kind **missing diver** is also an alarm: it emails every
  active owner and pushes the manifest's followers at once, naming no one (H-142,
  `sendMissingDiverAlerts`), and the filed report says when the owners were alerted or that they
  were not reached yet. The roll-call row's **"Missing diver, alert owners now"** sends the same
  alert before the report is written, raising its draft, which is then never deleted, and says
  "Not reached yet. Call the owners now." unless the alert reached someone. **Found**, on the
  report or on the row once the roll call has them back aboard (any of the departure's crew), is
  refused while the roll call still says not back aboard; it sends the owners one all-clear by
  email that counts, without names, anyone else on the departure still reported missing (issue
  #2694). Marked not aboard again after Found, a raise opens a new report and alerts again. Kept seven years from the incident; erasing a diver removes their identity
  from it and keeps the report
  ([20261012-incident-reports](../../architecture/decisions/20261012-incident-reports.md)).
- **Legal hold** (on an **incident report**) — an owner-set flag that keeps a report past its
  seven-year window while a claim is open. The retention prune skips a held report until an owner
  releases the hold, and a held report cannot be deleted. Only an owner sets or releases it
  ([20261012-incident-reports](../../architecture/decisions/20261012-incident-reports.md)).
- **Discarded draft** — an **incident report** draft an owner deleted because it should never have
  been started. Soft-deleted: gone from every working list, still listed on the departure log with
  who deleted it; a filed report can never be discarded.
- **Incident kind** / **incident severity** — the two closed answers an **incident report** files
  with: its kind (injury or illness, near miss, equipment, missing diver, fatality, other) and how
  serious the writer judged it (minor, moderate, serious). Shown on the report and the Safety page;
  read by nothing that gates, with one exception: a filed report of kind missing diver tells the
  owners at once (H-142). This is the written account's "missing diver"; the roll call's is the
  first kind under **Unaccounted for**, below, and filing the one does not mark the other. A severity is the crew's judgment, never a medical classification
  ([20261014-incident-kind-severity](../../architecture/decisions/20261014-incident-kind-severity.md)).
- **Shore alert contact** — the one person outside the shop's accounts who hears a **stale roll
  call**: an email address on the emergency reference page, beside the free-text shore contact a
  crew reads, saved only with the box that records they agreed (who ticked it, and when), and sent
  nothing until the address itself confirms by the link DiveDay mails it. Changing the address asks
  for both again; clearing it clears them. Their copy names the shop and its phone, the departure,
  the dive and the counts, in the shop's language, with no names and one link, the one that takes
  the address off the shop (H-118, `src/lib/shore-alert-contact.ts`, `src/db/shore-alert-tokens.ts`).
- **Stale roll call** — an after-dive roll call still open after its departure was due back. The
  hourly crew-notices pass asks from 30 minutes past the end; a count nobody started is open only
  once the boat is due home (the end plus the one-hour return buffer), so it alerts at the first
  hourly pass after that, while a started count or a person recorded not back aboard can alert at
  the first pass past the half hour. Once per departure the owners are emailed ("after the boat was
  due back at 4:00 PM EDT") and every device following the manifest is pushed
  (`sendStaleRollCallAlerts`), and the Today row says when. A confirmed **shore alert contact** is
  emailed too, under a claim of its own (H-118). It informs and never closes or changes the count.
- **Unaccounted for** — the six ways a head count can be open, in descending severity. A person is
  accounted for at an after-dive checkpoint **only if their latest live result there is
  "boarded"**; nothing else closes that count, and the rule is the same whether they hold a booking
  or a roster line.
  1. **Missing diver** — a crew member explicitly marked someone *not back aboard* at an after-dive
     checkpoint. A human said a diver did not return to the boat: the loudest row the app has. (A
     filed **incident report** of kind missing diver is a separate act with its own alert, H-142;
     neither sets the other.)
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
  **Roll-call closure** is the same rule read once per departure that is home, on the Reports
  **Safety** tab (`rollCallClosure`, `src/lib/safety-report.ts`; the population predicate is
  `src/lib/roll-call-population.ts`): **closed** when every seat has a dock result and everybody in
  each after-dive count, divers and crew alike, is recorded back aboard; **open** when any of that
  is missing; **none** when the departure has no roll-call event of either kind. A date nobody
  booked and nobody counted is an empty occurrence and is left out.
- **Emergency contact** — a name *and* a reachable phone number the crew can call for a diver in
  an incident. It is captured from the diver (the waiver flow, and the `/ready` page), never
  invented, and it is **only "on file" when both the name and the phone are present** — a name with
  no number is unreachable when it matters, so it counts as missing on the manifest and in the
  Today nudge. It is never a boarding blocker: a missing contact is an administrative gap, not a
  fitness-to-dive gap, so it surfaces only as a low-priority, dock-settleable nudge on boats within
  three days. It also comes in at the dock door: a **dock rider** added from the Boat tab carries
  the contact the captain asks for on the spot, written onto the new person.
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
  incident. Its free-text shore contact is never messaged; the address DiveDay may email lives
  beside it as the **shore alert contact**. It is a laminated card retyped, priced at zero words of DiveDay's own. While it has no
  phone line, the owner and manager see a Today row, filed under the first boat sailing in the
  next 48 hours ("Your emergency reference has no numbers"), and a new shop's first-run checklist
  carries "Fill in your emergency reference" as a step (fifth loop, item 3).
- **Radio identity** — what a **boat** answers to on the radio: its name, its **call sign** and its
  nine-digit **MMSI** (`boats.call_sign`, `boats.mmsi`, fourth review item 11). Held per hull, so
  the emergency card and the printed packet name the departure's own boat
  (`emergencyReferenceForDeparture`), and the shop's free-text vessel line on the **emergency
  reference** is printed only for a departure with no boat, or under a boat whose row holds
  neither fact yet (review B1: the two fields arrived empty on every existing boat, and the shop
  line is where the MMSI was typed; the Settings hub's Boats door names how many are left). A call sign is stored trimmed and upper
  case, and an MMSI as exactly nine digits, refused at the form and at the column. A departure on a
  hull the shop has since deleted still prints that hull, because the paper describes the boat that
  sailed.
- **Working channel** — the VHF channel a **boat** works on besides 16, which every boat monitors
  (`boats.working_channel`, issue #2672). One or a few VHF channels from 1 to 88 ("68", "68/72",
  "72 or 69"); 16 and 70, the distress and calling channels, are refused. Printed as "Working
  channel (VHF): 68" with the fixed line "Distress and calling: VHF 16, not this channel" on the
  emergency card of each departure on that boat, and kept in the **boat at departure** snapshot.
  It is not part of the **radio identity**: a boat with only a channel still prints the shop's
  vessel line.
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
  decision 4), and its words say so: "Buddy not back aboard" (es "Compañero sin regresar a bordo"),
  never "unaccounted for", which undersold a statement a human made. At the dock the heads-up reads
  "Buddy not aboard yet" (es "Compañero aún no a bordo"): there the crew is *assembling* a boat, so a
  teammate with no result yet is genuinely still to gather, and a teammate the crew recorded staying
  ashore (`isRecordedAshore`) prompts the remaining team to re-pair, including when that absence is
  carried to a later checkpoint. It is an informational heads-up, never the missing-person alarm;
  an actual recorded non-return always takes priority. All-ashore teams have no re-pairing prompt.
  The offline manifest shows teams read-only by name and states that the split-team read
  belongs to the live roll call — a saved snapshot cannot know who came back.
  Buddy teams are **divers only**: a snorkeler or a rider on a departure can be on no team, and a
  booking that is on one cannot be changed away from diving until it leaves the team.
  See [ADR 20260804-buddy-teams](../../architecture/decisions/20260804-buddy-teams.md).
- **Party / Came together** — the diver seats that booked together, one of them leading
  (`bookings.party_lead_booking_id`). On the manifest's buddy panel the divers not yet teamed read
  "Came together: …" and "Came alone: …", and "Team up each party" makes each party of two or
  three a **buddy team** in one tap (`planPartyTeams`, `formPartyTeams` in
  `src/db/buddy-pairs.ts`). **One tap never guesses about who may dive with whom** (dive-domain
  review of layer r5-4): it leaves for the divemaster, saying why on a "Left for you" line, every
  party on an intro or a course departure, one with a diver under 12, one whose "Under 18" box
  disagrees with a date of birth, one with a minor whose date of birth is not on file, one with a
  diver under 15 and no diver of 18 or more by a date of birth on file holding a verified card the
  shop has not deleted in the same party, and a party of more than three. Every age reason is said
  before the size one, so whoever splits a family of four by hand is told there is a child in it.
  A party it would team where someone has neither a date of birth nor the "Under 18" box gets a
  tick box, "… are all 18 or over", and is teamed only when the staffer ticks it; the tick names
  that party's exact seats (`partyConfirmKey`), and the sale still asks no age (issue 2808, H-113,
  H-22). Ages are taken on the departure's own local date; the bands are PADI's and SSI's, kept once in
  `src/lib/age.ts` (`partyLeftReason` in `src/lib/party-teams.ts`, read against **Junior
  certification**). Only booked and checked-in diver seats that are not held count, and every line
  on the panel and the button's number are drawn from that one plan. A team built by hand carries
  the same age and course reason as a caution, including when crew are deliberately accompanying
  a child or student; crew membership alone proves neither the adult's age nor a verified card.
  A team with a diver not cleared to board also carries an informational warning from the roster's
  readiness result, without repeating private medical details. Neither warning refuses a team,
  changes readiness, or prevents recording what happened.
- **Participant type** — what a booked person is doing on a departure: a **diver**, a
  **snorkeler**, or a **rider** (`bookings.participant_type`, codes in
  `src/lib/participant-types.ts`). Every booking has exactly one, and it defaults to diver. All
  three hold a seat, are counted at every roll-call checkpoint, appear on the manifest, and sign
  the shop's waiver; a diver and a snorkeler are held to its medical, a rider never (H-109). Only a
  diver is asked for a certification, may request
  nitrox, goes on a buddy team, is packed tanks for, uses a dive package, or counts against the
  departure's **diver seats**. On a course session the divers are the enrolled students; a
  snorkeler or rider seat sits beside them only where the shop has priced it, is asked none of the
  course's gates or forms, and is never in training (issue #2226). Staff change a booking's type
  from the roster ("Coming as"): joining the dive runs the card check and needs "Change anyway" (an
  owner, manager or instructor) to pass a missing card before departure. Out on the water after
  departure (issue #2225) the seat may join the dive only if it is cleared to board, with no
  override; nothing changes once the departure is home, and on a course session a student
  never stops diving and a passenger never starts. See
  [ADR 20261007-participant-types](../../architecture/decisions/20261007-participant-types.md).
- **Booked as** — the participant type a booking was made with (`bookings.booked_as`), set once by
  every writer and never changed. A seat whose type moved since shows a warning-tone
  note on the roster, the roll call and the offline copy: "Snorkeling, booked as diver" when it
  left the dive, "Diving, booked as snorkeler" when it joined. Leaving the dive for snorkeling clears
  card checks only, never a medical one. Leaving it for riding also lifts a medical referral or a
  physician's "no" as a boarding hold (H-109), and the crew still sees it at the rail as a
  "riding only" warning. Joining a seat already boarded re-asks the boarding gate.
- **Snorkeler** — a participant who is in the water at the surface with no tank. Needs no card,
  rents surface kit only (mask and fins, wetsuit, boots, hood and gloves, camera), and pays the
  departure's snorkeler price (`trips.snorkeler_price_cents`). The public form offers a snorkeler
  seat only where the shop has named that price; zero means free, and no price means not sold.
  The trip prep list counts one snorkel vest per snorkeler seat, the boat's own and never a rental
  (`DivePrepChecklist.snorkelVests`).
- **Rider** — a participant who stays on the boat: a partner, a parent, a photographer. Needs no
  card, rents nothing, and pays the departure's rider price (`trips.rider_price_cents`) under the
  same rule as a snorkeler's. A rider is still a body aboard and is counted at roll call, and is
  never held at boarding on a medical referral or refusal (H-109); the roll call, its printed
  sheet and the offline copy show it instead as "Riding only: MD said no" or
  "Riding only: referred", with the date.
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
- **Trip phase** — which kind of work a departure is in, for staff only: Prep, Check-in, Aboard or Back (ADR [20261001-logbook](../../architecture/decisions/20261001-logbook.md), decision 3; `src/lib/trip-phase.ts`). Never printed: every chip that names where a boat is shows the **trip stage** through `boatStageOf`, so Today's card, the departure header and the manifest strip say one word (UX review 2026-10-10, item 1). A phase is orientation a surface lays itself out by (a departure that is Back shows its Divers tab as the record of who sailed) and falls back to the clock when nobody has tapped. The crew's tap still wins while it speaks, and the chip and the phase read one rule (`readTap`): any stage but `home` reads Aboard until the return day is over *and* the hour past the scheduled return (`hasReturned`) has gone, whichever is later, and a `home` from the departure's last day reads Back. **A tap never finishes a departure sooner than silence would**: a word that has stopped speaking hands the question back to the clock, so a 20:00 to 23:30 night boat tapped Underway still reads Aboard, and its chip Underway, at 00:15. On a multi-day course (`starts_at`/`ends_at` bound the whole run) a word from an earlier day, `home` included, speaks only on the day it was said and finishes nothing: day two never reads "Underway since 10:30" with yesterday's time. Today's boats-out list (`outTripIds`) and its blocked-aboard reader both read the phase, so one rule gives one answer. It reads the raw tap rather than `liveStageOf`, because a late boat is exactly when it must not turn Back. A cancelled departure has no phase. Whether the boat has left the dock is its own reading, **At sea**, which does reach the screen.
- **At sea** — a departure that has left the dock (`departureSailed`, `src/lib/trip-phase.ts`; fourth review item 16). From then on nothing on its pages is for sale or still to pack: the header stops counting seats and prep's sizes and pick prompts go, on the trip header, prep, the Divers tab and the Boat tab alike. Back is at sea's end and counts as sailed. Before that the crew's word answers: `underway`, `surface` and `heading_in` are at sea; a course's `home` from an earlier day is tied up for the night. With no word, a single sailing is at sea once its hour and the departure buffer have passed (`hasSailed`); **Boarding yields to the clock the same way**, because the tap a busy dock forgets is Underway and a tap never holds a boat at the dock longer than silence would (review F3). Never by the clock for a multi-day course, whose later days still need their kit. Unlike the **Trip phase**, this reading is drawn on screen (it hides the seats chip), so the clock does reach a word here. **Left aboard** opens later, at `heading_in` or `home`, or once the departure is Back (`leftAboardOpen`): a form for what was found after the trip is no question while the boat is still diving (see **Lost item**, [day-of-the-dive.md](day-of-the-dive.md)).
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
  rather than wrong** — on the anonymous surfaces (the storefront, the follow link, the diver link)
  it stops speaking two late-arrival buffers past the departure's own end (`liveStageOf`,
  `STAGE_STALE_AFTER_MS`), because a crew that tapped *Underway* and then got busy would otherwise
  leave a diver's family reading "out on the reef" at midnight. The staff surfaces (the departure
  header, the shop home's station chip) read `boatStageOf` instead, whose staleness is the end of
  the return shop day, as the **trip phase** entry says: a crew is told its own boat is still out
  until someone taps *Home*. `home` alone carries
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
  those, it blocks every departure, including one that does not require the release (H-104). A
  version can also carry the shop's own **shop questions**, which are part of the version: a changed
  list is a new version, chosen as a correction or a material change like any other edit.

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
- **Shop question** — one of up to fifteen questions a shop adds to its release ("How did you hear
  about us?", "Do you carry dive insurance?"): yes or no, short text, a whole number, a date, or one
  of a list. A diver answers them after the medical questionnaire and the emergency contact, in
  their own section and their own step, before signing. They **inform and never gate**: no answer
  holds anyone back from a departure, and *required* means answered, never answered a particular
  way. The questions belong to the release version the record was issued on; at signing the server
  writes a snapshot of each prompt and its answer onto the record, inside the **integrity seal**, so
  a later edit or deletion never changes what a diver was asked. A version that asked nothing leaves
  no snapshot. An answer is what the diver wrote and nothing more: never evidence of fitness, age,
  emergency contact or certification, which DiveDay asks for itself, and not where diving currency
  lives (that is asked on each booking). A prompt or option with a health word gets a warning in
  the editor, because health questions belong to the standard questionnaire, which refers a diver
  to a doctor, and what the crew should know in an emergency belongs in the **medical alert for the
  crew** every release already asks for; an answer here is never shown to the crew as a medical
  alert, and the diver is told to answer health questions on the questionnaire instead. The signed record shows the sealed
  answers exactly as sealed, and, under its own heading, the shop's current questions that the
  record's own version did not ask (decided from the two versions, never from a missing answer). A
  paper, imported or erased release records no answers, and the signed record says so. The answers
  travel in the shop's export, not in the diver's own bundle, as medical answers do.
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
  until the shop pastes the agency's wording in. A course may bound a form to an **age**
  (`course_form_requirements.max_age_years`, issue #2265): it is then asked only of a student that
  age or younger on the session's first day in the shop's zone, and of one whose birthday the shop
  does not know. Open Water's template bounds PADI's Youth Diving acknowledgment (10615) at 11. A form the shop ticks as a **medical
  statement** (signature only; no answers are screened, unlike the **Medical questionnaire**
  below) keeps blocking even with that switch at warn-only.
- **Training mark** — a staff mark on a seat on an ordinary departure saying its dive is a training
  dive for one of the diver's course seats (the **enrollment**), such as an Advanced adventure dive
  on a fun-dive charter (issue #2275, ADR 20261012-course-forms-on-charters-and-counter). The seat
  is then asked that course's **Course forms**, and they are signed once, on the enrollment: a
  signature given from the charter seat's link is recorded against the course seat, so both seats
  read it. Never inferred from an open enrollment or a card level; only an owner, manager or
  instructor sets it, from the departure's Divers tab, and only on the same diver's live,
  confirmed course seat whose session ends no earlier than the boat leaves. One enrollment per seat.
  Checked again at every read: a mark whose enrollment is canceled, held or moved is the
  `training_mark_invalid` blocker until staff clear it. Clearing one with forms still owed takes a
  manager or the enrollment's own instructor, and the manifest names who did. **A training mark is
  not In training**: it changes boarding only, and buying a seat never reads it. A mark that
  stands may lower a site's level to the course's minimum, and only when the course
  certifies that level. A seat-level mark does not identify one of several planned dives, so
  multi-dive departures and one-dive departures with conflicting site records retain their site
  requirements; the roster and manifest explain why. An explicit
  departure requirement always stands. A course with no minimum
  (Open Water) asks no card for a site level it
  certifies; never past it, never for an intro session or a course that certifies none (issue
  #2731). It needs the course's own instructor aboard, rostered by somebody else and not counted
  off at the dock, and the seat within the course's ratio: marked seats are counted per instructor
  across every session on the departure, a certified assistant raising the cap as on the session.
  Today that lowers exactly one case: a PADI Open Water student on a one-dive charter whose site
  asks Open Water, because continuing-education courses have no ratio rule yet and so never lower a level.
  An instructor's load is also held to the tightest ratio of every seat already on them: an
  Open Water seat marked after a Discover Scuba seat cannot take the instructor past the intro
  ratio.
  A course with no known ratio never lowers a level, so the departure's level stands and the row
  warns. The sale, which cannot see a mark not yet made, sells on the same course seat under the
  same rule.
  A counter advisory can name overlapping intro and entry-level sessions with a possible shared
  instructor. It does not establish a group or clearance: different session windows can still
  have training marks on the same separate departure, so an absent advisory does not establish
  available instructor capacity.
- **Counter hand-off** — staff show one student's forms-only QR at a time, and the student signs
  their **Course forms** on their own phone (ADR 20261012-course-forms-on-charters-and-counter,
  decision 2, amended 2026-10-22). The existing live capability is reusable until expiry or
  revocation. Scanning does not sign a form or clear the other boarding requirements.
- **Sign once** — a diver signs the release once, not every trip. A **completed** signature is held
  against the diver (not just the booking it was signed on) and satisfies the waiver gate on any of
  their bookings while it stays **current**: signed against the shop's current release version and
  within a year of signing. A medical-review record carries only once a **physician clearance** is
  recorded against it — until then it never does. A signature that stops being current has
  **lapsed**: aged past its year (or a physician clearance's own year), or signed against terms the
  shop has since changed. The seat is blocked as surely as one with no release, under its own code,
  `waiver_lapsed` ("Signed waiver lapsed"), never `waiver_not_sent` ("Not sent yet") or
  `waiver_expired` (a link that expired unsigned), and the fix is a fresh link the diver signs again
  (`releaseLapsedForBooking`). **A seat's release is measured at the end of its trip while the
  trip has not started** (issue #2611, decided 2026-10-16; `waiverClockInstant`): the later of now
  and the trip's `endsAt`, both clocks (the signature's year and a physician clearance's year), for
  every trip however short. Once the trip is under way it is read at now, so a liveaboard guest on
  day two of seven is not blocked by a release that stands today. A release that stands today and
  runs out before the trip ends blocks the seat under its own code, `waiver_runs_out` ("Waiver runs
  out before the trip"), not "lapsed", and the same instant answers every door and reader: the
  roster, Today, the reminder, a fresh link (`issueWaiverRequest`), a paper copy
  (`recordInPersonWaiver`), a party panel's "signed" and the diver record ("Runs out <date>, before
  the trip"), so the diver can sign again the day the roster blocks them. Cards, payment and age
  keep their own instants, and admission still never refuses a seat for it. See [20260721-waiver-sign-once](../../architecture/decisions/20260721-waiver-sign-once.md).
- **Medical hold** — a signed release the medical questionnaire **referred** to a physician and no
  physician has cleared: an open referral, or one the physician refused. It is the record's status
  (`medical_review`), never the stored answers, because a paper or status-only hold stores none and
  still refuses boarding (`isUnresolvedMedicalHold`, `isStandingRefusal` in `src/lib/waivers.ts`).
  Only a **physician clearance** ends it, or a clean later release standing over it (below).
  **Superseding never ends a hold**: a fresh link on its seat, a seat claim or retiring a refusal
  moves the hold off that seat and answers nothing, so it still outranks every signature older than
  it on every seat the diver has. `isUnresolvedMedicalHold` asks of a seat's own live record;
  `isUnclearedReferral` asks of the diver's evidence, superseded or not. The one record that does
  not count is one given on a seat that has since passed to somebody else (a split or a claim):
  those answers were never the record's person's, and the seat's new holder signs their own. A
  cleared record keeps its status, so the signed records' **Medical holds** view lists every
  referral, and each row says where it stands: Waiting on physician, Cleared by physician, or Not
  cleared. A diver a captain boarded over the hold keeps it named on their manifest row after a
  dive: in the row's capsule, or in the person panel when a louder fact takes the capsule.
- **Doctor's page** — `/waivers/[token]/doctor`, the page a diver on a **medical hold** takes to
  their physician, opened from the held waiver page's "Take this to your doctor" (ADR
  20261016-doctor-referral-page, H-127). It names the official form and the page the examiner
  signs (page 3 of the UHMS/DMSC participant questionnaire, linked rather than restyled), prints the
  diver's name, and takes the signed form back as a **diver-sent doctor's form**, the shop's email
  or counter as the fallback. The
  answers that called for a physician sit behind the diver's **date of birth**, re-entered on the
  page and never printed by it: each one's published prompt (never free-text detail) and the form
  version answered. Twenty wrong dates on one release (`waiver_records.doctor_unlock_failures`)
  lock the answers for the rest of the hold. With no date of birth on file, or nothing to show, it says to go through the
  whole questionnaire. It opens only while the release waits on a physician (`awaitsPhysician`)
  on a held seat whose departure has not ended plus a day, and prints without the browser's
  URL header and footer. DiveDay decides nothing from it; staff record the **physician clearance**.
- **Diver-sent doctor's form** — the signed physician's form a referred diver sends from the
  **doctor's page** (`waiver_records.diver_medical_form_url`, issue #2797, ADR
  20261024-diver-sent-doctors-form): one photo or PDF per release, stored privately like the
  evaluation, never replaced from the link. Not a clearance and not evidence until a staffer who
  opened it records the physician's answer, types the physician's name from it and ticks to use it:
  it becomes the evaluation, marked "Sent by the diver". Otherwise recording the answer deletes it,
  and so does "Can't use this form", which lets the diver send another. Every live staff role may open it until then, each open on the diver's trail
  (`diver_medical_form_opened`). Erased with the diver; the day it arrived survives.
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
  and an evaluation predating the answers it would clear is refused, with one exception (issue
  #2616, decided 2026-10-16): when the diver re-signed the same "yes" before the letter was recorded,
  a letter dated on or after the **earliest earlier referral still unanswered** whose flagged
  prompts include every prompt the open record flags, and still inside its own year, clears the open
  record, and only that record. A newly flagged prompt, a letter before that referral, one older than
  a year, an earlier referral a physician already answered, or one whose seat has since passed to
  somebody else, each keep the refusal. **The prompts match by text, not by condition**, so the
  recording form asks for a staff confirmation on this path alone, naming the earlier referral's
  date: that the physician evaluated the diver's *current* condition, not only that referral. Without
  the tick the letter is refused, a clearance or a refusal alike. The act is audited as
  `medical_answered_by_earlier_letter` on the diver's trail (the letter's date, the earlier referral's
  id and signing day, the answered record's id). It answers the open record only, so a live seat
  still held by the earlier referral stays blocked and the desk is told so plainly; recording the
  same letter against that referral is the ordinary path and clears it. And it records **evidence** —
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
  (`overriddenReferral`); the offline copy and paper show the date only. That warning ends, as
  the refusal's does, once a physician has cleared a record flagging every question the referral
  did, evaluated no earlier than the day it was signed. A booking whose own release is the open
  referral still waits for a physician, and a referral a seat's fresh link superseded can still be
  cleared: superseding moves a hold off a seat and answers nothing.
- **Paper / in-person signature** — a non-diver (staff) recording that a diver signed the release on
  paper — a copy on the boat or on shore — that the app never saw signed. It creates the same
  immutable completed record, marked as staff-attested and stamped with the staff member who recorded
  it, and carries forward like any other signature. The app captures **no medical questionnaire** for
  these records, so recording one requires an explicit staff attestation that the paper medical form
  was reviewed and no answer needs physician sign-off. A flagged medical must instead go through the
  diver-facing link, which captures the questionnaire and routes to review — the medical block is
  never a checkbox. It records no answers to the shop's **shop questions** either: nobody attested
  to them, so the signed record says they were not recorded rather than that they are on the paper.
  Recorded from a **seat** (a trip's roster, the check-in queue) or from the
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
  On a signed release every staff role sees the prompts that flagged; the **full answers** are
  owner/manager-only, behind "Show answers", and each read writes `medical_answers_read` to the
  diver's activity trail before the answers are returned (issue #2157). A read that cannot be
  logged shows nothing, and a page render logs nothing.
- **Medical alert for the crew** — one optional box on the release, after the **medical
  questionnaire**, where a diver writes what the crew should know in an emergency ("Bee-sting
  allergy. EpiPen in the blue dry bag."): plain text, at most 500 characters, sealed with the
  signature. Tabs become spaces, invisible format characters are stripped, and a bare "nothing"
  answer ("N/A", "none", "ninguna") is stored as none, so the chip always means there is something
  to read. It **informs and never gates**: it changes no status, referral, readiness, admission,
  roll call or count, nobody reviews it, and it is never evidence of fitness to dive or a
  replacement for the questionnaire; the diver page and every staff surface that shows the words
  say so. The alert that counts is the one on the diver's current standing release; signing again
  replaces it. A new link never shows an earlier release's words (the link is a bearer capability):
  when the same person's latest signed release at the shop carried an alert, the box starts empty
  and the page says so and asks them to write it again if it still applies; an alert the diver
  cleared on purpose stays cleared. A paper or imported release carries
  none, and erasure clears it. Every staffer who opens the manifest or roll call sees a "Medical
  alert" chip on the row (the fact). The words are read by an owner or manager, and by crew **a
  manager put on** the departure the diver is booked on: the assignment counts only while the
  person who made it is a live owner or manager of the shop, so a crew member who rostered
  themselves, or whom another instructor rostered, does not count, and a manager demoted or
  removed stops vouching for what they assigned, and only through "Show the alert", whose action writes `medical_alert_read` to the
  diver's trail (at most one per reader, diver and departure in ten minutes) before it returns the
  text. No page carries the words in its render or payload. Anyone else is told who can read it and
  to ask one of them. The **offline copy** carries the fact for everyone; the words reach a device
  only when a permitted reader taps "Save the medical alerts for offline" on that departure, which
  writes `medical_alert_saved_offline` per diver on the server. The copy records who saved them,
  signing out or another person signing in on the device wipes them, and a crew member taken off
  the boat later keeps that copy until it expires. Opening the copy at sea writes nothing. On the
  signed record the words are owner and manager only; a held seat shows neither. The default print
  carries the fact only. **"Print with medical alerts"**, beside "Print packet" for an owner or a
  manager on a departure with an alert, prints the packet under its own title with each diver's
  words under their row, the not-reviewed line once above them, the row numbers and names that
  carry an alert, who printed it and when in the shop's zone with a line that it is a snapshot from
  then, and a line to keep the sheet with the crew and destroy it after the trip, repeated under
  every alert; the server reads the words and writes `medical_alert_printed` per printed diver when
  it produces the sheet, every print its own line, and refuses another site's navigation with a
  404 first. Never the day's paper, the dispute sheet or any other print. A staffer the crew rule
  refuses (not on the crew, or added late) sees **"Emergency: show the alert"** in the sheet on
  **the days of the trip**, and nowhere else: never a bearer page, never offline. The days of the
  trip run from the start of the departure's start date in the shop's zone until the later of the
  end of the date it is due back and the moment it is marked returned (`hasReturned`), so a night
  boat past midnight and day two of a course are covered (`emergencyReadWindow`). The button stays
  from the day before, and the server decides: too early, it says the read opens on the day of the
  trip; over, to ask the owner or a manager. A confirm step says it is for emergencies, that it
  goes on the diver's record and the owner will see it; it gives up after 15 seconds on weak signal
  and points to the printed sheet. The server checks again and writes `medical_alert_emergency_read`,
  naming the reader, on every confirm (no ten-minute window), and the owner's **Monday email**
  counts last week's (issues #2960 and #2990, H-153).
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
- **Reschedule notice** — the message sent to booked seats when a staffer moves a departure, on the board (Move) or by changing the start on the trip page. Notification kind `trip_rescheduled`: it gives the current date and time, the meeting point when it moved in the same save, and the diver's own trip-prep link. Delivery history is not tracked per seat, so it does not state a prior time or claim that the recipient already knows the current one. A save that moves only the meeting point says where to meet and gives the current schedule (#2443), by the diver's usual channel (email with a courtesy text, or the text alone for a phone-only diver). The move *holds* it as a **held send** (`held_sends`, the eight seconds and Undo every staff send takes, ADR 20260906-before-you-ask); a second move inside the hold folds into the first, and a move back to the recorded time sends nothing unless the meeting point moved. A move also re-arms the seat's trip reminders for the new date (#2444). Addressed only to each seat's own person record (`booked` or `checked_in`, never a seat whose identity is still held), read off the trip when the hold drains. Rule in `src/lib/held-sends.ts`, the send in `src/db/trip-rescheduled.ts`.
- **Seat move** — a staffer moving one booked seat to another departure from its roster row ("Move to another departure"). The same booking row changes trip, so its order, payment, waiver, `/ready` link and notes go with it; nothing is charged or refunded, and a paid seat that now lists higher is said back as owed. What was said about the old day (the conditions briefing, the "Anything changed?" answer, a pickup time, running late) is cleared, and a standing **Ask to move** is answered, so the new date's page may be asked about afresh. The new seat is measured as a new staff seat (capacity, divers-only limit, course ratio, a course's card and age on the new session's date, and the certification gate, which refuses), only between departures of the same kind, and never for a seat at roll call, on a buddy team or leading a party. The diver gets a **reschedule notice** worded for a seat ("we moved your seat to…"), sent at once rather than held. `moveBooking` in `src/db/bookings.ts`, consequences in `moveSeat` (`src/db/seat-diver.ts`); see [20261013-staff-move-a-seat](../../architecture/decisions/20261013-staff-move-a-seat.md).
- **Inbox seat** (the seat an Inbox message is about) — the open seats a staff Inbox row names for a diver's message. Inside the **running late** window it is the one seat about to sail, and only there may the row offer "Mark running late". Outside it, every seat the sender held when they wrote (booked, on a scheduled departure that has not sailed), soonest first; with more than one, each is named and each gets its own "Move" naming its departure, because only the desk can tell which seat the words are about. A seat booked after the message, a canceled seat and a stranger's message name nothing. Naming a seat opens its roster row; nothing on the Inbox moves a seat (**seat move** does). `inboxSeats` in `src/db/inbox-seats.ts`.
- **Night-before brief** — the 24-hour reminder's text: the crew's plain-language conditions, a
  concrete dock-arrival time and who to text on the day, read from `src/lib/night-before-brief.ts`
  and sent by SMS or WhatsApp. The 24-hour *email* is not the brief: since issue #2660 it is the
  `tonight` **diver state message**, one sentence and the thread link, and the thread holds the
  forecast, what to bring, who to text and the first-timer note. The 7-day text stays a light nudge.
- **Diver state message** — every reminder email takes one shape: a subject that names the state,
  one sentence, the one link and the shop's name as its line (issue #2660, decided by Aaron
  2026-10-17). A state is a notification kind, so the once-per-booking dedup rows stay exact:
  `trip_reminder_7d` is `week_out`, `trip_reminder_24h` is `tonight` and `trip_recap` is `home`.
  Booking sends one message, `booking_confirmation`, the `booked` state: the waiver link rides in it
  (UX review 2026-10-11, item 7), so there is no second booking-time email. The sentence says how many things the diver still has to finish
  when there are any, and the recap's sentence is the fly-safe sentence when one exists. The one
  exception is `tonight` before a diver's last boat with the shop: a second paragraph under the
  dock time says the fly-safe rule in hours (H-150, see **Earliest flight**). The 7-day
  and 24-hour cadences and the recap's four-hour floor are unchanged. Renderer in
  `src/lib/notifications/diver-state-email.ts`. The booked message still carries the waiver link,
  the course's materials and the terms the diver agreed to, which no thread page has to repeat
  before the diver has opened it, so it keeps its own renderer.
- **Desk hours** and the **after-hours ping** — when somebody is at the shop's desk: one window every day in the shop's own zone (`shops.desk_opens_minute`, `shops.desk_closes_minute`, 08:00–18:00 until the shop changes it under Settings → Messages; once saved, `shops.desk_hours_confirmed_at` lets the public footer print them). A diver message filed by the inbound email or WhatsApp webhook while the desk is closed sends a `desk_after_hours` email to each staffer who wants it: on by default for an owner or a manager, off for everyone else, and each staffer's own answer (`user_accounts.after_hours_ping`) wins, from their Email settings. At most one per person per half hour (`user_accounts.after_hours_pinged_at`, claimed by one conditional update), naming how many divers (distinct senders) wrote in since the desk closed and are still unanswered, with a link to the Inbox. Only a message whose sender the channel vouched for (`inbound_messages.sender_authenticated`) and that SES did not flag as spam (`inbound_messages.spam_flagged`) pings or is counted. A message batched behind a ping gets one trailing catch-up from the hourly `/api/cron/desk-pings` sweep once that staffer's half hour has run out, if it is still unanswered and the desk is still closed. The webhooks run the ping after they have answered (`after()`). Never the sender, the subject or a word of the message. Staff operational mail under H-09: no unsubscribe, no postal footer, not queued for retry, and never from a demo shop. Rule in `src/lib/desk-hours.ts`, reads and the send in `src/db/desk-pings.ts`.
- **Monday email** (weekly digest) — the owner's service email about their own shop's week, sent once per person per shop-local week on Monday between 08:00 and 20:00 shop time (`/api/cron/weekly-digest`, hourly). Sections, each a count and a link into the staff app (but one, below), appear only when they have something to say: last week's bookings made and seats filled against capacity (Reports' own query), this week's departures and seat fill and the divers still owing a waiver (the shared readiness horizon), reviews received and waiting on moderation, date requests still waiting, and Today rows that are past due. For someone Reports' gate admits, one more section is names rather than a count: **medical alerts opened in an emergency** last week (issue #2990, H-153), with the total, how many each reader opened, up to 50 lines of who opened whose alert on which departure and when, and how many more; a blank name is said as "a diver", "a staffer" or "a departure", never failing the email, and the section stays out of the `monday` assist's opening sentences. An emergency read by itself is reason enough to send. A week with none of these sends nothing. Last week's figures and Today's money and platform chores go only to someone Reports' gate admits (`canViewShopReports`, read from live roles); anyone else who opts in gets the rest. On by default for an owner, off for everyone else, and each staffer's own answer (`user_accounts.weekly_digest`) wins; it is turned off from the staffer's Email settings or the email's own one-click link. Transactional under H-09 (staff, about their own operation), so it carries no commercial postal footer. Demo shops never send; any staffer can preview this week's at `/shop/<slug>/settings/email/preview`. Logic in `src/lib/weekly-digest.ts`, reads and the send claim (`weekly_digest_sends`) in `src/db/weekly-digest.ts`.
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
  morning and an afternoon single on one date are one day, not two. A diver's numbered days (the
  recap's count, the **milestone** and **Your days**) count only their **diver** seats that are not
  held (`numberedDiveDay`): a day they rode along is not one of theirs.
  **A day nobody dived is never one**: a cancelled booking, a no-show, an imported visit standing `did_not_happen`, and a
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
  the opposite trade. **A rehearsal's seat is a day to the fly-safe reader** (a rehearsal in the
  water is real nitrogen), and a deleted departure is not, so the nightly delete leaves a
  **Rehearsal** until the fly-safe look-back plus a day has passed (`rehearsalMayClear`). Not the
  **Dive day (north star)**: that one is a shop's day, counted by roll call for the founder
  metrics, and never a diver's history.
- **Milestone stamp** — the drawn double-ring roundel beside the dive record, on the dive days
  `src/lib/visit-milestones.ts` names and no others: the 1st, 10th, 25th, 50th and 100th. Exact
  equality, not "at least", so a miscounted day does not blur a milestone — it skips it permanently.
  Primary ink, never coral (the thread spends its accent three times and this is not one of them),
  and on every other visit the plain ordinal line renders in its place.
- **Milestone** — a regular's 10th, 25th, 50th or 100th **dive day** with the shop, said once on
  each side as a count with no badge (H-128): "25th dive day with us" under the name on the roster
  and the manifest, and "Say hello to Bjorn: 25th dive day with us." on Today, for a diver who
  said the crew may know (the welcome cue's consent); "Your 25th dive day with Blue Mantis
  Divers." on the diver's booked moment, and only on a link mailed to the contact on file, never a
  booking redirect. One number for every reader: the distinct days in the shop's zone, merged
  across the diver's own diver seats that are not held (`numberedDiveDay` in
  `src/db/dive-days.ts`) and imported visits (`mergeShopHistory`), up to and including this
  departure's own local day (`diveDayOrdinal` in `src/lib/prior-visits.ts`), so an afternoon boat
  after a morning one is the same day, two future boats on different dates are two different
  counts, and a day they rode along or snorkeled is not counted. The recap's ordinal and the rows
  of **Your days** count the same days. Silent on every other count, and on a snorkeler's or a
  rider's seat. Not the **Milestone stamp**, which is the recap's roundel and also marks the first
  day.
- **Standing line** — the one line under a diver's name on their record that says what they are to
  the shop: "23 dive days since Mar 2024 · last out Sep 30 · $2,140 spent · brought 2 friends"
  (`diverStanding` in `src/lib/diver-standing.ts`). It counts **dive days**, the milestone's and
  the recap's unit (issue 2809): the distinct days in the shop's zone, merged across the diver's
  seats that are numbered dive days (`numberedDiveDay`, asked of each seat by `getDiverProfile`)
  and no longer ahead, and the imported visits not standing `did_not_happen`
  (`mergeShopHistory`). A morning and an afternoon boat on one date are one day, a no-show is
  none, and an imported visit on a day with a seat is not counted twice. Since is the first of
  those days on the shop's calendar. Last out is the last day the person was out with the shop in
  any seat known to be theirs, a ride-along or a snorkel included, so a rider regular with no dive
  days still reads it. Spent is drawn only for a reader who may manage
  orders, in the shop's currency, net of refunds; friends brought counts the distinct other people
  whose live seats name one of this diver's seats as the one that brought them
  (`booking_referrals`), at this shop only (`friendsBroughtBy`, `src/db/buddy-referrals.ts`).
- **Shared photo** — a recap photo its diver ticked "Share with everyone on this boat" for at
  upload (`recap_photos.shared_with_boat_at`, H-129, ADR 20261016-shared-boat-photos). Off by
  default and per photo. The tick is offered, and honored, only on an upload made through the
  diver's own readiness link (`uploadRecapPhotoFromReadyAction`); a photo added through a bare
  `/recap` link stays on that recap alone, because a recap link proves less than a mailed
  readiness link does. It shows under "From the boat" on the recap of every other seat on the same
  departure, with the sharer's first name, and leaves when the sharer's seat is cancelled, marked
  a no-show, left at the dock, held (**Held seat**), or its person deleted. Staff take it down
  with the gallery's ordinary delete. Not a crew photo (`trip_recap_photos`), which staff add and
  which reaches every diver without a name.
- **Rehearsal** — a departure staff add from the schedule builder for training day, to seat test
  divers and practice the boat side: check-in, roll call, close-out. Set when it is created and
  never changed (`trips.is_rehearsal`). It is always private, never priced, never part of a series,
  and only staff seat anyone on it. Nothing about it is sent by any channel, shown in public,
  charged (a seat spends no prepaid dive), exported or counted in Reports; a signed release, a
  course form and the roll call are exported as evidence with their trip and seat ids blanked.
  The nightly cron deletes it once it was due home before yesterday began in the shop's zone
  **and** the fly-safe look-back plus a day has passed, so a later boat still counts its divers'
  **Dive day** (`rehearsalMayClear`), giving back prepaid dives and unclaimed gear. **Never one
  with evidence**: a diver or crew boarding, any after-dive count, a logged dive, or an incident
  report keeps it live, and its
  banner says so. A warning panel says it is a rehearsal above every trip surface, and the paper
  manifest prints "Rehearsal" beside souls on board. See
  [20261012-rehearsal-departures](../../architecture/decisions/20261012-rehearsal-departures.md).
- **Review reply** — the shop's one public answer under a published review with words, written,
  edited or deleted by an owner or manager on the staff Reviews page and signed with the shop's
  name ("Reply from Blue Reef Divers"). Plain text, at most 400 characters
  (`MAX_REVIEW_REPLY_LENGTH`), shown wherever the review is: the public reviews page, the
  storefront's reviews and the reviews embed. It goes dark with its review if the review is
  hidden, and is blanked when the reviewer is erased (`review_replies`, `src/db/review-replies.ts`).
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
- **Ask to write back** — the WhatsApp message a staffer sends from a diver's conversation once
  the diver's last WhatsApp is more than 24 hours old, when WhatsApp no longer carries a typed
  reply (Meta's customer-service window). One of three fixed sentences from the diver bundle
  (`notifications.whatsappReopen.*`: an answer is ready, a question, picking up where we left off),
  in the diver's language, carried by the shop's approved **courtesy message** template. Recorded
  on `staff_replies` without answering the message, and one per silence: a WhatsApp reply sent a
  full window after the diver last wrote can only be one, so `whatsAppReopenSentAt`
  (`src/lib/inbox.ts`) finds it without a column. The diver's answer opens a fresh window and
  the composer is back. Send path `sendWhatsAppReopen` in `src/db/staff-reply.ts`.
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
- **Set-up receipt** — fixed DiveDay acknowledgment to the saved requester address, in its saved language. One admitted claim per exact normalized address per 24 hours, at most 30 per rolling hour globally; best-effort, never automatically retried. The request row keeps its claim, accepted SES MessageId or fixed failure code through the same erasure and retention ([ADR 20261021-setup-request-receipts](../../architecture/decisions/20261021-setup-request-receipts.md)).
- **Setup link** — the single-use link that opens the sign-up form at `/onboard` for one shop. Minted for each set-up request and sent only to the founder in that request's onboarding mail; it expires after two weeks and is spent by the shop it creates. Stored as a hash in `shop_setup_links` ([ADR 20261009-single-use-setup-links](../../architecture/decisions/20261009-single-use-setup-links.md)). Not a staff invite, which brings a person into a shop that already exists.
- **Dive day (north star)** — one real shop's local calendar day on which at least one diver was boarded at a departure roll call. Counted per week, it is the north star in [rollout.md](../rollout.md#metrics--the-scoreboard). Two boats out on one Saturday is one dive day ([ADR 20261007-founder-metrics](../../architecture/decisions/20261007-founder-metrics.md)) Not the diver's **Dive day**, the unit of one diver's history with a shop that `diveDay()` counts from bookings.
- **Activation milestone** — a first-time step a real shop has taken: created, first departure, first public booking, first diver-signed waiver, first roll call, and (once billing exists) first paid month. Stored once each in `shop_milestones`. A shop is **stalled** when its newest step is 7 or more days old and the next is missing; the founder digest names a stall once.
- **Bounce record** — one address SES bounced, or drew a spam complaint for, kept in `email_bounces` with the reason, which email it was, the shop it was for and the staff member whose action sent it. DiveDay's own debugging record, listed in the founder digest and kept 90 days; not the email issue a shop sees on its dashboard, which is the outcome on the delivery row of mail it tracked.
- **Demo mode** — a shop flagged `isDemo` gets the Demo Playground banner, its role switcher, and a
  "Reset demo data" affordance scoped to that one tenant. "Try the live demo" **mints a fresh
  `isDemo` shop per visitor** with a generated name/slug, seeded with the full sample schedule; a
  daily reaper clears minted demos after 7 days. The canonical `isDemo` shop (Blue Mantis) is
  bootstrapped in every environment as the fixture the e2e/visual-regression fleet tests against,
  and is never reaped. AI suggestions run in a minted demo under a $1 cap and the demo AI
  allowance, $10 a month across every minted demo, kept in `claude_demo_spend` so a reaped
  demo's spend still counts; Blue Mantis keeps a real shop's cap (Aaron, 2026-10-23). Onboarding a **trial** at `/onboard` — which only the owner's setup link opens, since every shop is set up by hand (ADR 20260925-shops-are-set-up-by-hand) — creates a real shop that is *not* demo mode and is
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
- **Your days** — a diver's other bookings with the shop, listed on one booking's page as "Your
  days with {shop}": upcoming seats, and the six newest past dive days numbered as the recap
  stamps them (`diveDayOrdinal`, so two boats on one date carry one number). A row is a send,
  never a door: "Email me the link" mails that day's own page (a fresh readiness link, or a recap
  link for a past day) to the address on file, so one link still opens one booking (H-132).
  **Drawn only on a delivered link** (security review of layer r5-4, F1): a readiness link DiveDay
  mailed to the contact on file (`booking_capabilities.delivered`), never the one a booking or a
  seat claim redirects its browser to, because that browser proved only that it typed a name and
  an address. Never on a held seat; a held seat is never one of its rows and never counted in
  their numbers. Read in `src/db/your-days.ts`; see
  [20261016-fresh-link-per-booking-row](../../architecture/decisions/20261016-fresh-link-per-booking-row.md).
- **Your week** — a crew member's next three departures, on their Today below the day: the boat
  and departure, when, their job on it (`trip_assignments.trip_role`, "On the crew" when the
  roster did not say), and the one crew gap the staffing week would draw on it, from the same pass
  (`getStaffingView`'s `gapTrips`). When reads "At the dock 6:00 AM · leaves 7:00 AM" from the
  crew dock time (the shop's crew lead, or an earlier shift of their own still running at it); with
  no crew lead set and no earlier shift it reads "Divers at the dock 6:30 AM · leaves 7:00 AM",
  because the divers' call is not the crew's (`crewCallAt` in `src/lib/dock-call.ts`). A call on
  an earlier day than the departure names its own weekday. The window is tomorrow and the six days after it in the shop's zone;
  today's boat is already badged on the spine, including one that has already sailed. Shown to any
  reader with a crew assignment, whatever their role, at a shop that plans its crew
  (`shops.crew_schedule_enabled`), less the sessions "Your sessions" already lists (fourth review
  item 14); absent for a reader rostered on nothing. Read in `src/db/crew-week.ts`, drawn by
  `_components/today/YourWeek.tsx`.
- **Crew month line** — a crew member's month on their Today, under the tips line: "October: 14
  boats · 26 dives run · 31 hours on the water" (`crewMonth`, `src/db/crew-tips.ts`). It counts
  the departures they crewed that are back within this shop month and that ran: scheduled, or with
  a live logged dive, never a departure called off with nothing logged. Dives are the departure's
  live logged dives, else its planned ones, and they are dives *run*, not dives this person made:
  a captain who stayed aboard is credited with the boat, not the water. Hours are the departure's
  scheduled days (`trip_schedule_days`) when it has them, else its span.
- **Week totals** — "6 days · 8 boats · 34 h" under each name on the Crew schedule grid
  (`personWeekTotals`, `src/lib/staffing-week.ts`). Days are the week's columns with a shift or a
  crewed departure; boats are distinct departures; hours are the union of shifts and crewed
  meeting windows, each a departure's own scheduled day, so a shift covering the boat it works
  counts once and a liveaboard counts its days, not its nights.
- **Crew warning** — a line above the staffing week that informs and never blocks. Four checks: a
  departure whose rostered crew holds no current oxygen-provider credential; separately, one whose
  crew holds no current first aid / CPR credential; a person whose **crewed departures** run past
  12 hours in one shop-local day (a shift is availability, not duty, and never counts); and
  somebody crewing this week whose credential has expired, except a dive-professional rating, whose
  lapse the crew editor's supervision claim already shows on the departure. A credential with no
  renewal date counts as current, a renewal date is good through the end of that day, and a kind
  the shop has never recorded for anybody raises nothing. Pure logic in
  `src/lib/staffing-warnings.ts`; words in `src/i18n/staffing-warning-labels.ts`.
- **Decompression card reminder** — one line per departure, on the staff roster, the roll call at the dock checkpoint, the printed packet and the offline copy, telling crew to check each diver's and guide's decompression card because DiveDay records no technical card ([H-144](../human-decisions/H-144-decompression-departure-reminds-crew-to-check-cards.md)). Shown when the departure is marked `exceeds_no_deco_limits` and someone aboard dives; never on a finished departure's record. It informs and never gates: `needsDecompressionCardReminder` in `src/lib/decompression-reminder.ts`, read by none of readiness, trip admission or the roll-call readiness.
- **Seat** — the one word for what a diver buys and what a boat holds, said by staff and divers alike ([H-122](../human-decisions/H-122-seat-is-the-word.md)): "3 seats left", "Book 2 seats", "Cancel my seat". Never "spot" for capacity. `scripts/check-seat-word.mjs` reads the staff bundles and `diver.json` both; its allowlist keeps words that are not the thing bought (a marine-life "spot", "on the spot").
- **Ask to move** — a diver's request, from their own `/ready`, that the shop move their seat to another date ([H-126](../human-decisions/H-126-ask-to-move.md)). Offered on a paid seat the diver may still release where cancelling would return nothing right away: past the free-cancellation window, or on a trip with none. It is a request, not a move: it files one Inbox row per booking and departure on the `page` channel, naming the booking (`inbound_messages.booking_id`, `recordMoveAsk` in `src/db/inbound-messages.ts`), and the page then says it was asked while that row stands. Staff decide, and a move is a **seat move**, which answers the ask; one staff answered or deleted no longer stands, and asking again files it anew.
- **Reply notes** — what AI should know when it drafts a reply to a diver, in the shop's own words: where to park, which wetsuits it rents, what to bring. One box under the AI switch in Settings → Features ("Notes for AI"), drawn only while the shop's AI suggestions are lit, and an owner or manager changes it with the page’s one Save (Aaron, 2026-10-23; it began at the foot of the Inbox); and the `inbox-draft` assist reads it beside the schedule, prices and desk hours, so a time or price written there is one a draft may quote. Never a diver's details. Replaced saved answers and their `{name}`/`{trip}` markers (Aaron, 2026-10-22); the retired `inbox_saved_answers` table is dropped in a later release. Column `shops.reply_notes`, read by `replyFacts` (`src/db/inbox-assists.ts`).
- **Weather day** — on Reports, a shop-local day with at least one departure the weather called
  off and that stayed called off (`weatherCallsInWindow`, `src/db/blowouts.ts`; fifth loop, item
  27). A departure reinstated after the call and sailed is not counted (dive-domain review F2). One
  afternoon boat called while three others ran still makes it a day, so the words are "days with a
  weather call", never "days lost" (N4). "Moved to another date" counts a diver from a called-off
  departure who holds a live seat on another departure booked within 30 days of the call (N3).
- **Days at sea** — on a teammate's card under Settings → Team, the shop-local days in the year
  they were on the crew of a boat departure that sailed (`crewYearFacts`, `src/db/reporting.ts`;
  fifth loop, item 32). Boats only: a shore day or a pool session is a day on the schedule, not at
  sea (dive-domain review N1). It reads the crew list, not crew roll call, so a crew member listed
  but recorded ashore still counts.
- **Assist** — a suggestion Claude makes to staff (a drafted reply, a sorted message, a value read
  off a card or a website), which a person accepts, edits or ignores (ADR 20261018-claude-assists).
  An assist never clears anything, and it never sends, publishes or saves on its own, with one
  exception: while "Recap highlights" is on (`shops.recap_assist_auto_approve`, on for a new shop
  since 2026-10-23) the recap send fills a highlight the crew left blank, never over the crew's
  own words and never on a departure with an incident report (the ADR's 2026-10-22 amendment). One
  assist is the diver's: the card photo on the public register page fills the boxes they would
  type, rate limited per address and per shop. An assist is **dark** (offers nothing, says
  nothing) when there is no API key, external HTTP is off, the shop switched "Claude suggestions"
  off in Features, the shop is a demo, or the shop reached its monthly cap. Every feature with an
  assist works the same without it. Code: `runAssist` in `src/db/assists.ts`; on screen, the
  controls in `src/components/assists/` (`AssistDraftButton` and its siblings). Not "AI": the copy
  names Claude.
