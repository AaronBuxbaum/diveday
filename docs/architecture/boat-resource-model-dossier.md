# Boat & buyout-charter model — design dossier (2026-08-04)

Supporting material for the **Proposed** ADR
[20260804-boat-resource-model](decisions/20260804-boat-resource-model.md). This file is the
auditable thinking: the ground-truth inventory, the evaluation criteria (fixed before any design was
read), three independently-worked designs, the judge scores, the synthesis, and the
dive-operations review. The ADR is the conclusion; this is why.

**Nothing here is implementation.** Roadmap §5 and the buyout-charter candidate stay deferred
("until a real operator needs it"); this dossier exists so that when one does, implementation starts
the same morning instead of with a month of modeling arguments.

---

## 1. The parked question

DiveDay has no boat entity — **a trip *is* the boat-day**. Two roadmap items block on that one
missing model:

- [roadmap §5 — Multi-boat / multi-shop configuration](../product/features/roadmap.md#5-multi-boat--multi-shop-configuration):
  a shop running several boats can see all departures, move divers and crew carefully, and avoid
  collisions ([brainstorm: multi-boat day orchestration](../product/features/brainstorm.md#staff-operations)).
- [roadmap — Private / buyout charters](../product/features/roadmap.md#private--buyout-charters):
  quote → contract → deposit → the departure withdrawn from public sale
  ([brainstorm: charter inquiry to quote](../product/features/brainstorm.md#diver-experience-and-growth)).

The roadmap's own instruction: *"design the two together, not separately."* This dossier does that.

One vocabulary note up front: in the glossary and the code, **"charter" already means an ordinary
scheduled trip** (["Trip / charter"](../product/glossary.md), `src/db/seed.ts`). The new concept is
therefore called a **buyout** everywhere below, so the existing vocabulary is not poisoned.

---

## 2. Ground-truth inventory — the migration-cost ledger

Everything that assumes trip-is-the-boat-day, with file references. Any boat model pays its
migration cost against this list.

### Schema (`src/db/schema.ts`)

| Table | The trip-is-the-boat-day assumption |
| --- | --- |
| `trips` | The boat-day itself: `capacity` (integer, checked 1–60) lives **on the trip row**, alongside `starts_at`/`ends_at`, `status` (`scheduled`\|`cancelled`), `conditions_hold` (pauses bookings), `price_cents`/`deposit_cents`, `planned_dives`. No boat column, no visibility column — every scheduled trip is publicly for sale. |
| `trip_series` | Materializes recurring trips; carries no boat, so a series cannot say "the Saturday two-tank runs on *Mantis I*". |
| `trip_schedule_days`, `trip_dives` | Children of a trip; unaffected by any boat model (they describe the outing, not the vessel). |
| `bookings` | FK `trip_id`; capacity is enforced against `trips.capacity` inside the booking transaction. |
| `trip_assignments` | Crew per trip (`trip_role` narrows a shop-wide role, ADR [20260803-per-trip-crew-role](decisions/20260803-per-trip-crew-role.md)). Crew collisions across boats are invisible today because there is only one implicit boat. |
| `staff_shifts` | Dated working windows per shop — no boat dimension. |
| `trip_waitlist_entries`, `trip_last_minute_promos`, `trip_requirements`, `roll_call_events`, `roll_call_crew_events`, `trip_reviews`, `recap_photos` | All per-trip; none needs to know about boats. The manifest/roll-call spine keys on the trip and must stay that way — a buyout must never weaken it. |

### Domain logic (`src/lib`)

| Module | Assumption |
| --- | --- |
| `trips.ts` | `spotsRemaining`/`capacityLabel` read `trip.capacity` as the one stated number. |
| `course-ratios.ts` | **Precedent that capacity already has two sources**: a course session's effective capacity is min(stated `trips.capacity`, crew-derived ratio cap). A boat ceiling would be a third `min()` term — the pattern exists. |
| `readiness.ts` / `trip-admission.ts` | Per-trip requirement composition (`getTripSiteRequirement`). Boat-agnostic; a buyout changes *sale*, never *boarding* — admission/readiness must be untouched by any design. |
| `blockers.ts` / `today.ts` | The Today queue's "by departure" view groups by trip; the departure is the operational unit staff reason in. |
| `offline-manifests.ts` | Snapshot per trip (`listTripIdsInOfflineManifestWindow`, `src/db/trips-queries.ts`). |
| `structured-data.ts` | `tripJsonLd` publishes each public trip as a schema.org Event/Offer. A buyout must not be published. |
| `demand.ts`, `reporting.ts` | Seats sold vs `trips.capacity`; per-boat utilization is unaskable today. |

### DB layer (`src/db`)

| Module | Assumption |
| --- | --- |
| `bookings.ts` (`bookSpot`) | `SELECT … FOR UPDATE` **on the trip row** serializes concurrent bookings; `booked >= trip.capacity → trip_full`, plus `course_ratio_full`. This is the concurrency spine — designs that move the lock to a boat row change the most safety-adjacent transaction in the repo. |
| `trips-schedule.ts` | `moveTrip`/`duplicateTrip`/`deleteTrip` and their refusals — the schedule board's mutations. No boat means no same-boat collision check anywhere. |
| `trips-queries.ts` | Board keyset paging (`pagedUpcomingTripsWithCounts`), calendar feed (`upcomingTripsForCalendar`), staff schedule, offline-manifest window. Public listing has no visibility filter to apply — `status = 'scheduled'` is the only gate. |
| `waitlist.ts`, `check-in.ts`, `trip-promos.ts`, `last-minute-list.ts`, `recap.ts`, `reminders.ts` | Per-trip flows; last-minute broadcast and waitlist must exclude a bought-out departure. |
| `export.ts` / `import.ts` | The trips CSV is part of the **data-portability wedge** (roadmap §1); a boat column changes the export schema the read-API ADR will freeze. Add it early or version it later. |
| `seed-trips.ts`, `seed-more-trips.ts`, `seed-cert-gates.ts`, `seed-bookings.ts`, `seed-cast.ts` | The seeded "boats" *are* trips; tests assert exact fullness per departure ("only the deep wreck may leave six seats"). Any seeded boat data lands as a new `seed-<scenario>.ts` module (ADR [20260803-seed-scenario-modules](decisions/20260803-seed-scenario-modules.md)). |

### Surfaces (`src/app`, `src/features`, `e2e`)

| Surface | Assumption |
| --- | --- |
| `/s/[shopSlug]` public schedule + `/s/[shopSlug]/trips/[id]` booking page | List/sell every scheduled trip; capacity label; waitlist when full; party booking ≤ 6 (`createBookingParty`). |
| `/shop/[shopSlug]/schedule/board` (`ScheduleBuilder.tsx` + `actions.ts`) | Day-grouped stream of departures with no lane/resource dimension; add/move/copy/remove cannot collide because nothing is exclusive. |
| The board's add panel + `/trips/[id]` | One trip form (creation lives in `ScheduleBuilder`'s panel — ADR 20260806-one-trip-create-form) and the trip editor: capacity is a bare number staff retype per trip; crew and roster sections. |
| Today (`/shop/[shopSlug]` `?view=`) | Departure cards; no boat name to anchor "which boat is this pile of problems on". |
| Reports (`/shop/[shopSlug]/reports`) | Utilization against stated capacity; no per-boat cut. |
| `calendar-sync` feature (`src/features/calendar-sync`) | Trips → VEVENT; a boat name would belong in the event title/location for crew phones. |
| Offline manifest viewer (`src/app/offline-manifest/`) | Per-trip snapshot; on a multi-boat morning the crew needs "which boat" on the snapshot header. |
| e2e + visual (`e2e/visual.spec.ts`, `scripts/route-coverage.json`) | Clock-frozen seed; board and public-schedule captures are pixel baselines. Any slice that adds visible boat chrome moves baselines and must say so in its PR (visual-triage rule). |

### What "capacity" means today — three numbers already in tension

1. **Stated capacity** (`trips.capacity`) — what staff typed, checked 1–60.
2. **Crew-derived ratio cap** (`course-ratios.ts`) — for entry-level/DSD sessions.
3. *(missing)* **The vessel's own limit** — the number on the flag or the COI. Today it lives in the
   captain's head, and nothing stops a fat-fingered 40 on a six-pack's trip.

---

## 3. Judging criteria — fixed before any design was read

Each design scored 1–5 per criterion by two independent judges. Criteria, in the order they were
committed:

- **C1 — Migration cost from live data.** Expand/contract compliant per the
  [deploy runbook](../engineering/deploy-and-migrations-runbook.md); existing trips stay valid with
  no backfill drama; rollback = roll code back, leave schema.
- **C2 — Blast radius across existing surfaces.** How many of the inventory rows above change, and
  how deep (the booking transaction and the manifest spine weigh heaviest).
- **C3 — Fit for multi-boat day orchestration** (roadmap §5): see all departures per boat, avoid
  double-scheduling a hull, crew collisions become visible.
- **C4 — Fit for private/buyout charters**: quote → contract → deposit → withdrawn from public
  sale, without weakening waivers/certs/manifest.
- **C5 — Incrementality.** Fit with "deliberately deferred until a real operator needs it": must
  decompose into independently shippable, independently *valuable* slices. A design that must ship
  all-at-once **fails** this criterion by definition.
- **C6 — Seed/e2e/visual impact.** Does the first slice move any existing pixels? Is determinism
  (frozen clock, exact-fullness assertions) preserved?
- **C7 — Domain fidelity.** Six-pack vs cattle boat, COI/passenger ceilings, turnaround between
  runs, split fleets, boats out of service — without forcing fake data entry on the single-boat
  shops that are the actual majority.
- **C8 — Vision fit.** Lifestyle-scale, not a POS, not fleet-maintenance software
  ([vision.md](../product/vision.md#what-kind-of-business-this-is)).

---

## 4. Design A — Minimalist: boats as optional labels

*The smallest thing that could possibly work.*

### Schema sketch

```
boats
  id                uuid PK
  shop_id           uuid FK → shops, not null
  name              text not null            -- "Mantis I"
  description       text                     -- home dock, engine notes; free text
  max_passengers    integer                  -- nullable; the vessel's own ceiling
  default_capacity  integer                  -- nullable; prefills a new trip's capacity
  archived_at       timestamptz              -- CRUD-archive semantics (20260719)
  created_at        timestamptz not null
  unique (shop_id, name)

trips
  + boat_id         uuid FK → boats, nullable   -- label, not reservation
```

Capacity **stays on the trip**, authoritative and enforced exactly as today; `default_capacity`
only prefills the trip form, `max_passengers` only warns when the typed capacity exceeds it.

### Migration path

Pure expand: one new table, one nullable column. No backfill, no contract phase, rollback = roll
the code back. A shop that never names a boat sees zero change anywhere.

### How existing surfaces absorb it

- **Schedule builder**: a boat picker on add/edit; a colored chip per boat on the card; a *soft*
  warning (never a refusal) when two scheduled trips share a boat and overlap in time.
- **Booking transaction**: untouched. The lock stays on the trip row.
- **Today / manifests / calendar**: the boat name rides along as display context.
- **Seed/e2e**: nothing until a slice deliberately names the demo boats (a new `seed-boats.ts`
  scenario); the first slice moves no pixels.

### How a buyout works in it

`trips.visibility` enum (`public` | `private`, default `public`): a private trip disappears from
`/s/[shopSlug]`, structured data, last-minute broadcast, and waitlist promotion, but its booking
page still works by direct link and staff paths still work. The money is a flat-price manual order
(`orders/new`); quote and contract stay human (email/PDF), recorded as internal notes.

### What it deliberately does not solve

No hard exclusivity (two trips *can* be saved on one boat — you get a warning, not a refusal); no
derived capacity; no quote pipeline, no contract object; no per-boat maintenance or out-of-service
windows.

---

## 5. Design B — Resource model: boats as first-class schedulable resources

*Trips reserve boats; capacity derives from the boat; buyout = exclusive reservation.*

### Schema sketch

```
boats
  id, shop_id, name, description
  capacity          integer not null         -- the vessel's number, authoritative
  turnaround_minutes integer not null default 0
  active            boolean not null default true

trips
  + boat_id         uuid FK → boats, not null after migration
  capacity          → becomes an optional *override*, must be ≤ boats.capacity

boat_reservations                            -- or an exclusion constraint on trips
  boat_id, trip_id, tstzrange(starts_at - turnaround, ends_at + turnaround)
  EXCLUDE USING gist (boat_id WITH =, window WITH &&)   -- btree_gist

buyouts
  id, shop_id, boat_id, trip_id, organizer_person_id, flat_price_cents, status
```

### Migration path

Multi-phase expand/contract: (1) expand — create `boats`, backfill **one synthetic boat per shop**
("Boat 1", capacity = max historical trip capacity), nullable `trips.boat_id`; (2) dual-write —
new trips require a boat, old rows backfilled to the synthetic boat; (3) contract — `boat_id` NOT
NULL, capacity override check constraint, exclusion constraint goes live. Every shop now owns a
boat row whether it wanted one or not.

### How existing surfaces absorb it

- **Booking transaction**: effective capacity = min(override, boat capacity, course ratio); the
  oversell lock arguably moves to (or additionally takes) the boat row for buyout claims — the
  concurrency spine changes.
- **Schedule builder**: true lanes per boat; add/move/copy **refused** on collision (the exclusion
  constraint bounces the write); turnaround enforced.
- **Trip editor**: boat is required; capacity field becomes an override with validation.
- **Export/import**: boats become a new CSV entity immediately (portability schema grows).
- **Seed/e2e/visual**: seed must create boats for every scenario; board baselines change wholesale
  (lanes); specs that create "a six-seat boat" now create a boat *and* a trip.

### How a buyout works in it

Cleanly: a buyout is an exclusive reservation of the boat for a window — no other trip can even be
created on that hull, and the reserved trip is off public sale. The strongest semantics of the
three designs.

### What it deliberately does not solve

Quote/contract workflow (same gap as A); maintenance scheduling (explicitly out — but the
`turnaround_minutes`/`active` fields are the top of that slope).

---

## 6. Design C — Charter-first: the buyout workflow is the primary object

*Design the quote/contract pipeline first; let the boat model fall out of what a quote sells.*

### Schema sketch

```
charter_inquiries                            -- mirrors course_inquiries (precedent in schema)
  id, shop_id, name/email/phone, party_size, requested_date, notes, status
  status: new → quoted → accepted → declined/expired

charter_quotes
  id, inquiry_id, boat_id, flat_price_cents, deposit_cents, valid_until, terms_note

boats                                        -- falls out: a quote must name what is sold whole
  id, shop_id, name, max_passengers, buyout_price_hint_cents

trips
  + visibility ('public'|'private') + charter_quote_id nullable
  -- accepting a quote materializes a private trip linked back to it
```

### Migration path

Expand only — three new tables plus two nullable columns on trips. No backfill (the pipeline is
empty until an inquiry arrives). Comparable safety to A.

### How existing surfaces absorb it

- A new staff surface (`/shop/[shopSlug]/charters`) for the pipeline — the biggest single piece.
- Public site gains an inquiry form (rate-limited like other public writes).
- Booking transaction untouched; capacity untouched; board shows the boat label only as a
  by-product.
- Deposits reuse the existing payment-operation rails; the **contract/e-sign step is blocked
  today** — it lands in the same H-01/H-03 legal gate as waivers (an unsigned charter contract is
  a legal instrument DiveDay would be presenting).

### How multi-boat orchestration works in it

Weakly: boats exist as a sales catalog, so the board *can* show labels, but collision visibility is
an afterthought — nothing in the pipeline needs it, so nothing forces it to be good.

### What it deliberately does not solve

Day orchestration (roadmap §5's actual ask); collision warnings; capacity fidelity. It also builds
the most new UI: an inquiry CRM is the closest of the three to a genuinely new subsystem, which is
exactly what the "Not scheduled" section says these candidates must not be built as.

---

## 7. Judge scores

Two independent scoring passes against §3's criteria. Judge 1 weighed operations/engineering
(migration, concurrency, test surface); Judge 2 weighed product/domain (the two use cases, real
charter practice, vision fit). 1–5, higher is better.

| Criterion | A Minimalist | B Resource | C Charter-first |
| --- | --- | --- | --- |
| C1 migration cost | **5 / 5** | 2 / 2 | 4 / 4 |
| C2 blast radius | **5 / 4** | 2 / 2 | 3 / 3 |
| C3 multi-boat orchestration | 3 / 3 | **5 / 5** | 1 / 2 |
| C4 buyout fit | 2 / 3 | 4 / 4 | **4 / 5** |
| C5 incrementality | **5 / 5** | 2 / 1 | 3 / 4 |
| C6 seed/e2e/visual | **5 / 5** | 2 / 2 | 4 / 3 |
| C7 domain fidelity | 3 / 3 | **4 / 4** | 3 / 3 |
| C8 vision fit | **5 / 5** | 3 / 3 | 3 / 2 |
| **Total (J1 + J2)** | **33 + 33 = 66** | 24 + 23 = 47 | 25 + 26 = 51 |

### What the judges split on

- **C4 (buyout)**: Judge 1 gave A a 2 — "visibility flag + manual order is not a workflow"; Judge 2
  gave it a 3 — "for a lifestyle-scale founder cohort, the workflow *is* email plus a flat-price
  order; the product's job is only to take the boat off sale and keep the manifest honest."
  Both agreed C models the workflow best; they split on whether the workflow is the product's job
  *yet* (Judge 2: yes eventually, hence C's 5).
- **C5 (incrementality)**: Judge 2 scored B a 1, harsher than Judge 1's 2 — the synthetic-boat
  backfill means *every* shop's data changes in one release, which reads as exactly the
  all-at-once shape the criterion forbids. Judge 1 allowed that phases 1–2 could pause
  indefinitely, salvaging a 2.
- **C2**: Judge 1 gave A a clean 5; Judge 2 docked one point because even A's slice 2 (board
  chips + warnings) touches the most-asserted visual surface in the repo.

### Verdict

**A wins on totals and on the knockout question** (C5: B's contract phase makes it un-pausable
once started). But the panel's written note: *A as-scored is not decision-ready on C4 or C7 — it
wins only if it grafts B's vessel-ceiling fidelity and C's withdrawal semantics and inquiry
precedent. Ship A's skeleton wearing B's numbers and C's door handle.* That graft is §8 and the
ADR.

---

## 8. Synthesis — the winning design

**Boats are optional labels that can earn authority; a buyout is a private trip on the existing
money rails.** Four slices, each independently shippable and valuable, each pausable indefinitely:

1. **Boats exist** (from A): `boats` table + nullable `trips.boat_id` + trip-form picker with
   capacity prefill and an over-`max_passengers` warning (from B — the vessel's ceiling is recorded
   from day one, warned on from day one, *enforced* only if a later slice earns it). Pure expand;
   zero visible change for boat-less shops; no baseline moves.
2. **The board sees boats** (roadmap §5's actual ask): boat chip on schedule-board cards, Today's
   by-departure header, calendar-feed titles, offline-manifest header; soft same-boat overlap
   warning on add/move/copy. Warning, never refusal — weather-day reshuffles must stay free.
3. **Buyout = withdrawn from sale** (from C): `trips.visibility` (`public`|`private`, default
   `public`), private trips off the public schedule/SEO/waitlist/last-minute rails; a
   "withdraw from public sale" action; flat-price manual order for the money; the manifest, waiver,
   cert, and roll-call spine **completely unchanged**.
4. **Inquiry pipeline** (from C, only on demonstrated operator demand): `charter_inquiries`
   mirroring `course_inquiries`; contract/e-sign stays gated on H-01/H-03 regardless.

Full schema, migration sequence, surface-by-surface impact, and the first shippable slice are in
the [ADR](decisions/20260804-boat-resource-model.md). Why the runners-up lost, in one line each:

- **B lost on its own strength**: deriving capacity from the boat forces every shop to own a boat
  row (synthetic backfill), rewrites the booking transaction's lock, repaints every board baseline,
  and cannot pause once the contract phase starts — it fails "deferred until a real operator needs
  it" structurally, not accidentally. Its vessel-ceiling insight survives as slice 1's warning.
- **C lost on scope**: an inquiry CRM is the most new UI for the least §5 coverage, and its
  centerpiece (the contract) is legally gated anyway. Its withdrawal semantics and its
  `course_inquiries` precedent survive as slices 3 and 4.

---

## 9. Dive-operations review (dive-domain-expert)

The winning model reviewed against real charter and multi-boat operations. Findings and how the
design answers them:

1. **Six-pack vs cattle boat.** A six-pack (USCG uninspected, max six passengers) and a 30-diver
   cattle boat are both "a boat"; the passenger ceiling is a *legal* property of the vessel, not a
   scheduling preference. **Addressed**: `boats.max_passengers` is recorded per boat and warned on
   from slice 1. **Accepted residual**: it warns rather than blocks until a slice earns
   enforcement; the trip's stated capacity remains what the booking transaction enforces, exactly
   as today — the model adds a place for the true number without silently changing any shop's
   sales. The expert's condition: the warning copy must never imply DiveDay verified the COI —
   the ceiling is shop-asserted, like every credential a roster cannot mint
   ([20260803-per-trip-crew-role](decisions/20260803-per-trip-crew-role.md)'s principle).
2. **Turnaround between runs.** An AM two-tank returning at 12:30 cannot depart again at 12:30 —
   fuel, tanks, heads. **Addressed**: the slice-2 overlap warning compares raw windows first; a
   per-boat turnaround buffer is named as the follow-up knob, deliberately not in slice 1 (one more
   nullable column when a real operator states a real number). Surface intervals proper belong to
   *people*, not hulls — repetitive-dive limits for crew working a double are a crew-scheduling
   question (`staff_shifts`), explicitly out of scope here and noted in the ADR's non-goals.
3. **Split fleets / two marinas.** A boat berthed across town changes which trips it can plausibly
   serve. **Addressed as text**: `boats.description` carries the home dock; multi-*location*
   operating views are the other half of roadmap §5 and stay open — this ADR deliberately does not
   spend the location concept.
4. **Boat out of service.** Engine-down weeks are real. **Addressed**: `archived_at` retires a
   hull from pickers (per [20260719-crud-archive-semantics](decisions/20260719-crud-archive-semantics.md));
   dated out-of-service windows are named follow-up, not modeled — a maintenance calendar is
   fleet-management software, which vision.md rules out.
5. **A buyout does not relax safety.** The chartering group's divers still need waivers, cert
   checks, and a named manifest — a private trip that skipped readiness would be the worst
   regression the model could cause. **Addressed structurally**: visibility gates *sale surfaces
   only*; admission, readiness, manifests, and roll call never read it. The expert flags this as
   the one invariant a future implementer must not "simplify": **`visibility` may appear in
   listing/SEO/waitlist/promo queries only, never in `readiness.ts`, `trip-admission.ts`, or the
   roll-call spine.** The ADR states it as a hard rule.
6. **Filling a buyout's roster.** Real groups trickle names in late; the organizer, not the shop,
   chases them. **Addressed**: reuse the existing rails — party booking and the per-booking
   capability links — against the private trip's direct URL; no new mechanism. Named as slice-3
   acceptance criterion rather than new design.
7. **Overlap warnings must tolerate deliberate double-scheduling.** Shops really do board the PM
   group while the AM group is still ashore at lunch, and list two half-day trips on one hull.
   **Addressed**: warnings, never refusals (B's exclusion constraint was rejected for exactly
   this).

No unresolved findings. The expert's summary: *label first, ceiling recorded from day one,
exclusivity by sale-withdrawal rather than by lock, safety spine untouched — this matches how small
operators actually run mixed fleets.*
