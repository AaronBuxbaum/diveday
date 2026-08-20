# 20260804-boat-resource-model — Model boats as optional labels that can earn authority; a buyout is a private trip

- **Status:** Proposed
- **Date:** 2026-08-04

**Proposed, deliberately.** Roadmap §4 (multi-boat) and the buyout-charter candidate stay
*deferred until a real operator needs them* — accepting this ADR is a human decision, and the
deferral stands either way. This record exists so that the day an operator does need it,
implementation starts from here instead of from a month of modeling arguments. The full design
process — ground-truth inventory, three independently-worked alternatives, judge scores, and the
dive-operations review — is in the
[boat-resource-model dossier](../boat-resource-model-dossier.md).

## Context

DiveDay has no boat entity: **a trip *is* the boat-day**. Capacity lives on the trip row
(`trips.capacity`, `src/db/schema.ts`), the booking transaction locks and counts against it
(`src/db/bookings.ts`), and every scheduled trip is publicly for sale — there is no visibility
concept. Two deferred roadmap items block on this one gap, and the roadmap instructs that they be
designed together
([roadmap §4](../../product/features/roadmap.md#4-multi-boat--multi-shop-configuration),
[Private / buyout charters](../../product/features/roadmap.md#private--buyout-charters)):
a shop running several boats cannot see or avoid same-hull collisions, and a group cannot buy out
a departure (quote → deposit → withdrawn from public sale).

Constraints a lower-context agent must not miss:

- "Charter" in the glossary and code already means an ordinary scheduled trip; the new concept is
  a **buyout** — do not rename the old one.
- Admission (`src/lib/trip-admission.ts`), readiness (`src/lib/readiness.ts`), manifests, and roll
  call are the safety spine; no boat or buyout concept may weaken or even touch them.
- Capacity already has two sources — stated `trips.capacity` and the crew-derived course ratio
  (`src/lib/course-ratios.ts`, effective = min of both). Precedent, not a blank slate.
- Migrations are expand/contract
  ([deploy runbook](../../engineering/deploy-and-migrations-runbook.md)); the visual baselines and
  the clock-frozen seed make "does slice 1 move pixels?" a real cost.
- Vision bounds the scope: lifestyle-scale, not a POS, not fleet-maintenance software
  ([vision.md](../../product/vision.md#what-kind-of-business-this-is)).

## Decision

**Boats are an optional per-shop label registry that records the vessel's real ceiling from day
one and can earn authority later; a buyout is an ordinary trip withdrawn from public sale on the
existing money rails.** Capacity stays authoritative on the trip; exclusivity is achieved by
sale-withdrawal, never by a resource lock. Four independently shippable slices, each pausable
indefinitely:

### Schema (target shape, all expand-only)

```
boats                                        -- slice 1
  id                uuid PK
  shop_id           uuid FK → shops, not null
  name              text not null                 -- "Mantis I"
  description       text                          -- home dock, notes; free text
  max_passengers    integer                       -- nullable; the vessel's own legal ceiling
  default_capacity  integer                       -- nullable; prefills a new trip's capacity
  archived_at       timestamptz                   -- CRUD-archive semantics (20260719)
  created_at        timestamptz not null default now()
  unique (shop_id, name); checks: max_passengers between 1 and 60,
  default_capacity between 1 and max_passengers (when both set)

trips
  + boat_id     uuid FK → boats, nullable         -- slice 1: a label, never a reservation
  + visibility  trip_visibility not null default 'public'   -- slice 3: 'public' | 'private'

charter_inquiries                            -- slice 4 only, mirrors course_inquiries
  id, shop_id, name/email/phone, party_size, requested_date, notes,
  status: new → quoted → accepted → declined/expired
```

### Migration sequence (expand/contract per the deploy runbook)

Every step is expand-only; there is **no contract phase anywhere** — rollback is always "roll the
code back, leave the schema".

1. Slice 1: `CREATE TABLE boats` + `ALTER TABLE trips ADD COLUMN boat_id uuid REFERENCES boats`
   (nullable, no backfill — null means "the shop hasn't said", exactly like `trip_role`).
2. Slice 3: `CREATE TYPE trip_visibility` + `ADD COLUMN visibility ... NOT NULL DEFAULT 'public'`
   (a default satisfies the runbook's single-deploy rule; every existing row keeps today's
   behavior by definition).
3. Slice 4: new tables only.

### The slices, with surface-by-surface impact

**Slice 1 — boats exist (the first shippable slice).** A settings-level boats list
(add/rename/archive) and a boat picker on the trip form (`trips/new`, `trips/[id]`,
`ScheduleBuilder` add panel) that prefills capacity from `default_capacity` and shows a *warning*
(never a refusal) when typed capacity exceeds `max_passengers`. Impact: `src/db/schema.ts`, one
new `src/db/boats.ts`, trip create/edit actions, new i18n keys in every locale, unit tests, one
settings visual capture. **Nothing else changes**: booking transaction, readiness, Today, public
pages, seed, and all existing baselines untouched. A boat-less shop sees nothing new outside the
optional picker.

**Slice 2 — the board sees boats (roadmap §4's ask).** Boat chip on schedule-board cards
(`ScheduleBuilder.tsx`), Today's by-departure headers (`BlockerGroups.tsx`), calendar-feed event
titles (`src/features/calendar-sync`), offline-manifest header (`src/lib/offline-manifests.ts`),
trips CSV export column (`src/db/export.ts` — added here, *before* the read-API ADR freezes the
export schema). Soft same-boat overlap warning on add/move/copy (`src/db/trips-schedule.ts`
returns a warning code; the board renders it) — warning, never refusal, because deliberate
double-scheduling is real practice. Seeded demo boats land as a new `seed-boats.ts` scenario
module; board/Today baselines move and the PR says why.

**Slice 3 — buyout = withdrawn from sale.** `trips.visibility`: a `private` trip disappears from
the public schedule (`upcomingTripsWithCounts` and friends in `src/db/trips-queries.ts`),
structured data (`src/lib/structured-data.ts`), waitlist promotion (`src/db/waitlist.ts`), and
last-minute rails (`src/db/last-minute-list.ts`, `trip-promos.ts`); its booking page stays
reachable by direct link so the organizer fills the roster through the existing party-booking and
capability-link rails. Staff get a "withdraw from public sale" action on the trip page; money is a
flat-price manual order (`orders/new`). **Hard rule: `visibility` may appear in listing, SEO,
waitlist, and promo queries only — never in `readiness.ts`, `trip-admission.ts`, or the
manifest/roll-call spine.** A buyout's divers still sign waivers, still show cards, still appear
on the manifest. E2e: one buyout flow spec + a public-schedule capture proving the private trip is
absent.

**Slice 4 — inquiry pipeline (only on demonstrated operator demand).** `charter_inquiries`
mirroring the existing `course_inquiries` shape and staff surface. Contract/e-sign remains gated
on H-01/H-03 regardless of this ADR — a quote note and a deposit are the ceiling until legal
clears.

## Alternatives considered

- **Resource model (boats as schedulable resources; capacity derives from the boat; buyout =
  exclusive reservation)** — strongest orchestration and buyout semantics, but structurally
  all-at-once: a synthetic-boat backfill for every shop, the booking transaction's lock moved onto
  the boat row, exclusion constraints refusing real-world double-scheduling, every board baseline
  repainted. Fails the deferral posture; its vessel-ceiling insight survives as slice 1's
  `max_passengers` warning. (Dossier design B, judged 47/80 vs the winner's 66/80.)
- **Charter-first (quote/contract pipeline as the primary object; boats fall out as a sales
  catalog)** — models the buyout workflow best, but is the most new UI for the least §4 coverage,
  its centerpiece contract is legally gated (H-01/H-03) anyway, and orchestration stays an
  afterthought. Its withdrawal semantics and `course_inquiries` precedent survive as slices 3–4.
  (Dossier design C, 51/80.)
- **Keep trip-is-the-boat-day forever (do nothing)** — free until the first two-boat operator or
  buyout request, then every workaround (title prefixes like "Mantis I —", capacity folklore,
  hidden trips by obscurity) becomes data this migration has to clean. Writing the design down now
  is the cheap middle.
- **A `location`/marina dimension alongside boats** — deliberately not spent here; multi-location
  views are the other half of roadmap §4 and deserve their own decision when a real split-site
  operator exists.

## Consequences

- **Easy:** each slice ships alone and pauses indefinitely; slice 1 is a two-migration, zero-pixel
  change; single-boat shops (the majority) are never forced to manage a resource they don't have;
  the safety spine is provably untouched (no safety module ever reads `boat_id` or `visibility`).
- **Hard / deferred:** no hard exclusivity — two trips can share a hull with only a warning; no
  derived capacity — a shop can still overstate a six-pack (warned, not blocked); no contract
  object, no maintenance windows, no crew surface-interval tracking (a people question for
  `staff_shifts`, not a hull question).
- **Commits us to:** "buyout" as the vocabulary (never overloading "charter"); warnings-not-locks
  on the board; the export schema gaining a boat column in slice 2 at the latest.
- **Escape hatch:** if real operators outgrow warnings (chronic double-bookings, oversold
  six-packs), the resource model's pieces bolt onto this schema without unwinding it — enforce
  `max_passengers` as a check in `bookSpot`, add the exclusion constraint, backfill `boat_id` NOT
  NULL — roughly the cost of dossier design B's phases 2–3, paid only when earned. If instead the
  whole area stays unneeded, the cost of leaving is two dormant nullable columns and one small
  table.
- **On acceptance (not before):** glossary entries for **boat** and **buyout**, and roadmap §4 /
  the charter entry move from "design open" to "design settled, implementation unscheduled".
