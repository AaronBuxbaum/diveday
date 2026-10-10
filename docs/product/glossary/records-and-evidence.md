# Records and evidence

- **Executed dive** — what a departure *actually* dived, as opposed to what it planned. One
  `executed_dives` row per dive number per trip, carrying the site actually visited, entry and
  exit times, max depth and observed conditions, written by crew at the rail from the manifest's
  `after_dive_N` checkpoint. Distinct from a **trip dive** (`trip_dives`), which is the *plan*.
  It informs and never gates: no readiness, admission or boarding decision reads it. It is,
  however, evidence — `buildIncidentExport` renders it into a SHA-256-sealed document for an
  investigator or a treating physician, which is why a dive nobody logged must read as *not
  recorded* rather than being interpolated from its neighbours.
- **Marine-life catalog** — DiveDay's own list of 148 wider-Caribbean species
  (`src/db/marine-life-catalog.ts`): a slug, a Latin binomial, a category and a photo, and no prose
  at all. Every word a person reads about one is DiveDay's, written once in every language and
  resolved at render (`src/i18n/marine-life-labels.ts`, ADR 20260813-marine-life-is-diveday-copy). A
  shop **picks** from it and never writes into it; a species we do not carry is refused by the picker
  and the ask lands in `marine_life_requests`. The opposite contract to a **site template** or a
  **course template**, whose words are copied onto the shop's row and owned by the shop from then on:
  a dive plan for one reef is the shop's to write, and what a stoplight parrotfish looks like is the
  same sentence for every shop in the Caribbean.
- **Field guide** — the faces a **dive site** is known for: up to eight catalog species a shop picks
  for that site (`dive_site_creatures`, `MAX_SITE_CREATURES`), in the order it chose. A **briefing
  selection**, not an inventory — the point is to tell a diver what to *expect*, so it holds the
  animals a reef shows reliably and not the ones it occasionally produces. A claim about a **place**,
  standing and future-tense, and never evidence that anybody saw anything.
- **Observed species** — one catalog species a crew member recorded on one **executed dive**
  (`executed_dives.observed_species_slug`, issue #1190). A claim about a **moment**: it exists only
  because somebody wrote it down, and is never inferred from the site's field guide — the two draw
  from the same catalog and mean opposite things, which is why they are separate columns. Drawn from
  the **whole catalog** rather than from the site's guide, because a sighting is worth recording
  precisely when it was not the usual: the guide holds the blue tang, and the eagle ray is what a
  diver climbs the ladder talking about. Informs and gates nothing, and it is an ornament rather than
  evidence — an unusable slug is dropped so the dive record still saves. Null means nobody said,
  never "all good".
- **Sighting** — a species the crew tapped after a dive, tallied per **departure** and per **dive
  site** (`trip_sightings`, slice 20r). One live row per species per site per departure carrying a
  count: the first tap writes it at one, a second tap on the same chip counts a second animal. The
  third of the three things that draw from the marine-life catalog, and the only one a diver
  deciding on a Saturday can read as a *frequency* — a **field guide** is the shop's standing claim
  about a place, an **Observed species** is one line on one dive's record, and a sighting is what
  adds up over a month into "seen here this month: southern stingray on 2 of 3 logged dives here".
  Nothing to do with a **Card sighting**, which is a staffer reading a certification card in their
  own hands; the two share only the English word, and neither is ever evidence for the other. The
  species is refused rather than dropped when the catalog does not carry it, which is the opposite
  call from an observed species and for the opposite reason: the slug *is* the record here, so one
  with no words would reach a public page as punctuation. Refused too on a departure that has not
  sailed (`hasSailed`) — a boat still alongside has seen nothing. Informs and gates nothing — it
  sits nowhere near the roll call's commit path or the manifest's head count — and it never
  promises: a site's summary counts *logged* dives in a trailing month, dates itself to the
  departure rather than to the tap, and says what was logged and when, never what a diver will see.
- **Earliest flight** — the instant DiveDay's fixed preflight wait ends, after the day's diving
  (`src/lib/fly-safe.ts`, issue #1425). **Never a clearance, and since #1433 the copy does not
  read as one**: whether a diver may fly is between them, their profile and their physician, and a
  shop knows one interval — so the sentence asks them to wait at least until this instant rather
  than telling them they may go, and attributes both the number and the practice. DiveDay's fixed hours
  (`DEFAULT_FLY_SAFE_HOURS`: 18 single, 24 repetitive, above DAN's published minimums of 12 and 18) counted from
  the **last recorded exit**, or from the **buffered return** — the scheduled return plus the
  one-hour departure buffer — once the boat is home by that buffer. The gate and the anchor are the
  same instant on purpose: a boat that came in late must not read an hour early in a sentence that
  ends by citing DAN. *Repetitive* by any of three routes — the day held more than one dive by the
  record, or by the plan, or **this diver already had a dive day at this shop on one of the two
  local days before the departure** (issue #1439). That third route is DiveDay's *reading* of DAN's
  "multiple days of diving", not a quotation: DAN publishes no window for that clause. It counts
  local calendar days in the shop's own zone rather than a span of hours, because two boats leaving
  at the same time on consecutive days are exactly 24 hours apart — and 25 across a fall-back
  boundary — so an hours window let the tide and the clock change decide the answer. The evidence is
  a live booking on a live departure the shop still says ran, not a dive log row: crews do not
  reliably log, and requiring a row would have let today's boat speak from its plan while
  yesterday's fell silent. The longer wait is the one that costs nothing if wrong, and reaching
  repetitive can never shorten one, because the fixed `repetitive` is longer than the fixed `single`.
  A record that is short of its plan, or missing its last exit, anchors on the return, never on an
  earlier dive. Rendered on the thread's after-state and in the recap email, in the shop's zone. The
  sentence states its reason on the two routes a diver cannot check for themselves — the earlier
  day, which is nowhere on a recap of today, and the multi-dive *plan*, whose figure can be more
  than the diver dived — because neither surface carries a dive count at all: the record card
  dropped "{n} dives logged" on 2026-08-28, and the email is a greeting, the sites, this sentence
  and a link. The recorded-dive route needs no clause, because the diver was in the water for those
  dives. The sentence names the **shop** as the author of the figure and DAN as the practice behind
  it, because DAN publishes 12 and 18 and a shop may sit above them. The lead-in states the interval
  for the same reason. It read "Fly-safe from {when}:" until issue #1433, and DAN's interval is a
  minimum that lowers DCS risk without removing it, so "safe" was the one word in the sentence that
  read as a verdict — in Spanish twice over, where "Puedes volar" is literally *you can fly*. Three
  things it deliberately cannot know: whether a dive took decompression stops, which DAN says needs
  substantially longer than 18 hours; any dive not booked at this shop, so a week with another
  operator is invisible; and that two days belong to one diver when the bookings carry no email — a
  walk-up is a fresh `people` row each time. Informs and gates nothing; never computed from a depth
  profile, which is a dive computer's job.
- **Surface interval** — the time between one dive's exit and the next dive's entry. Only ever
  stated between **consecutively numbered** executed dives that were both recorded and do not
  overlap; anything else is "not recorded". An interval measured across a dive nobody logged
  overstates the diver's rest, which is the one direction this figure must never err.
- **Day profile** — what a shop's published rhythm says a departure will *look* like, laid over that
  departure's own dives and read on the public booking page before anybody has a seat: each dive's
  planned time in the water, the gap on the surface between two of them, and each site's maximum
  depth (`src/lib/day-profile.ts`, rendered in "The day"). Every figure is **planned, never
  observed** — the source is `shops.bottom_time_minutes` / `surface_interval_minutes`, a site's
  `expected_bottom_time_minutes` and a departure's `trip_dives.travel_minutes`, so the copy says
  "usually" and the page states no clock. Its gap is deliberately *not* the **surface interval**
  above, which is measured between two executed dives; and it never crosses a night, so a course
  weekend's day-one close and day-two open are two days rather than one long rest. The arithmetic is
  the dock-day timeline's own (`betweenDivesMinutes`), so the figure a diver reads before booking is
  the figure their thread reads after.
- **Material generation** — a shop's explicit assertion that a new waiver version changes the
  bargain, and therefore that standing signatures no longer cover it
  (`waiver_materiality_decisions`, ADR
  [20260826-waiver-material-generations](../../architecture/decisions/20260826-waiver-material-generations.md)).
  It is **not** the display version number: a typo or a reformat increments the version and leaves
  the generation alone, so nobody is asked to sign again. DiveDay cannot infer legal materiality
  from a text diff and does not try — a human says so. Never reason about re-signing from the
  version number.
- **Staff credential** — a professional qualification a *staff member* holds (instructor rating,
  first-aid, boat licence), with an optional renewal date that raises a Today row as it approaches
  (`staff_credentials`). Distinct from a **certification**, which is always a diver's. Renewal is
  a calendar date, so it is good through the end of its own shop-local day.
- **Supervision claim** — what Today, the staffing week and the trip page tell a staffer about who
  is supervising a departure in the water: the in-water crew count with each rostered
  professional's recorded ratings read (`courseCrewCountsByTrip`, `getTripOverview`). A rung is
  **lapsed** when at least one `instructor_rating` (for the instructor rung) or dive-professional
  rating (for the certified-assistant rung) is on file and every one of them renewed before the
  departure's last shop-local day (`lapsedRungs`, `src/lib/crew-roles.ts`); nothing on file, or no
  date on file, is not a lapse. Distinct from the **roster's claim** — the same count with no
  credential read — which the booking gate, the seat cap and the crew editor's refusals use, because
  H-59 keeps a locally recorded renewal date from ever refusing a sale or an assignment (issue
  #1853). A surface showing a gap the two claims disagree about names who lapsed.
