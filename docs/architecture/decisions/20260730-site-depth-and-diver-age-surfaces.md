# 20260730-site-depth-and-diver-age-surfaces — Numeric site depth as a warning, and age on the crew's list

- **Status:** Accepted
- **Date:** 2026-07-30

## Context

Two product-owner decisions landed together on 2026-07-30 (`docs/product/human-decisions.md`) and
share one data spine — a diver's date of birth — so they ship as one change.

**H-08 (depth ceilings).**
[20260724-course-admission-standards](20260724-course-admission-standards.md) recorded the agency
depth ceilings as *documented reference data, explicitly not enforced*, for a concrete reason: the
only depth DiveDay stored was `dive_sites.depth_range`, deliberately free text ("6–12 m",
"18–40 m"). There was no number to compare a certification against. That ADR named "convert
`depth_range` to a structured min/max" as the follow-up it was declining to do yet.

**H-21 (minor indicators).** The minimum-age gate shipped in
[20260724-gear-fit-fallback](20260724-gear-fit-fallback.md) made age a fact DiveDay holds and
enforces — but it surfaced nowhere a crew reads. A captain looking at the boarding list had no way
to know a booked diver was 12 without opening their profile. The product owner asked for age in
years, a minor indicator, and — separately, as a delight item — a celebratory birthday callout.

A third requirement arrived mid-implementation: **shops must be able to work in feet or metres**,
configured in settings. The launch jurisdiction is Florida (H-01), where crews say "sixty feet",
while every agency standard DiveDay encodes is published in metres.

## Decision

### 1. `dive_sites.max_depth_meters`, alongside `depth_range` rather than replacing it

A nullable `double precision` column. The free-text `depth_range` stays: it carries shape and
nuance ("shallow ledge to 18, wall beyond") that one number cannot, and it is what the
diver-facing site card has always shown. The new column exists for exactly one job — being
comparable to a certification ceiling.

**Floating point, not integer.** A shop working in feet types `60`; that is 18.288 m. Stored as
whole metres it would read back as `59 ft` and look like DiveDay lost their number. The column is
canonical metres at full precision so a feet round-trip is exact.

### 2. Depth is a **warning, never a gate**

`src/lib/depth-ceiling.ts` computes the advisory; `listTripReadiness` returns it as
`depthAdvisory`, a **sibling of `readiness`, never a blocker inside it**. Nothing downstream can
let it flip a `ready` diver to `blocked`.

This is the product owner's decision and it is the correct one: a site's maximum depth is not the
dive plan. An instructor may deliberately keep a student at 15 m on a 30 m wall — an ordinary,
correct day of diving. Refusing that booking would make DiveDay wrong about the very thing it was
being careful about. The roster says so in warning tone, outside the red blocker list, and the
crew decides.

Ceilings encoded, all sourced in
[20260724-course-admission-standards](20260724-course-admission-standards.md): Open Water 18 m,
Advanced Open Water 30 m, Rescue 30 m (a skills course, not a deeper one), Divemaster and
Instructor 40 m. A verified **Deep** specialty lifts an Open Water diver to the 40 m recreational
limit — it can only ever raise a ceiling, never lower one.

**Junior age bands win outright over the card.** Ages 10–11 are capped at 12 m whatever they hold;
12–14 reach 18 m, or 21 m on an Advanced card. Modeled on age rather than a `junior_*` enum member
because that is how the restriction actually works — the same plastic card means different depths
on either side of a 15th birthday, and DiveDay stores one ladder with no junior variants. A
12-year-old with an AOW card is held to 21 m, not AOW's 30 m.

**Two deliberate silences.** No verified card yields *no* advisory rather than a 0 m ceiling — an
uncertified diver is already `certification_missing`'s problem, and a second redundant warning on
every un-carded diver would train the crew to ignore the line. No recorded site depth does the
same. The feature degrades to silence, never to noise or to a refusal.

The trip's depth is the **deepest site it visits**, across the primary site *and* every ordered
`trip_dives` site — a warning that only read the first would go quiet on precisely the two-tank
day where dive two is the deep one.

### 3. `shops.depth_unit` — display and entry only

An enum (`meters` | `feet`), defaulting to `meters` because every standard encoded above is
published in metres. Storage is **always** metres, so flipping the setting reinterprets nothing
and no stored depth moves. `src/lib/depth-units.ts` converts at the boundary and returns numbers
and unit codes, never sentences — the message bundle supplies "m" and "ft".

The server **re-reads the shop** to learn the unit rather than trusting a form field. A hidden
`unit` input would let a crafted post store a depth 3.3× off, which on a safety-adjacent figure is
not an acceptable trust boundary.

### 4. Age, minor status, and birthdays on the roster and manifest

`isMinorOnDate` uses **18, not the diving world's 15**. The flag exists because a minor's
liability waiver may need a guardian signature, which is a question of legal majority in the
shop's jurisdiction — Florida at launch. The *diving* restrictions on under-15s are a separate
rule travelling through the junior depth bands, so the two never have to agree. Florida's 18 is
currently a constant; the day DiveDay opens somewhere that differs, it becomes shop-configured.

All three are measured on **the trip date in the shop's timezone**, not "today" wherever the
server is, and all three render nothing when no date of birth is on file — a boat where nobody has
been asked shows no "unknown age" column at all.

The birthday callout uses a **seven-day window in either direction** (product owner's choice) and
appears in two places: a badge on the roster row and manifest, and a `Celebrations` section above
the roster that renders nothing when there is nothing to celebrate. H-21 described it as "a section
similar to the existing dive-count milestone" — no such milestone section exists in the codebase,
so the shape was confirmed with the product owner rather than guessed.

Looking **back** matters as much as looking ahead: a diver whose birthday was on Tuesday is still
worth a shout-out on Saturday's boat, and the crew has no other way to know. The copy is the icon
and the timing only — "🎂 today", "🎂 in 2d", "🎂 2d ago" — because a roster row is already dense
and the cake carries the meaning. A visually-hidden "Birthday" keeps that legible to a screen
reader, which would otherwise hear "in 2d" with no subject.

## Consequences

- The agency ceilings recorded as reference data in
  [20260724-course-admission-standards](20260724-course-admission-standards.md) are now executable
  code. That ADR's stated follow-up is closed; its enforcement scope (ratios) is unchanged.
- Existing dive sites have no `max_depth_meters` and therefore warn about nothing until a shop
  fills it in. This is the intended migration path — fail quiet, not fail loud, on a field nobody
  has been asked for yet.
- Depth precision beyond a whole unit is discarded at display. A site is a briefing figure; "18.3
  m" implies a precision no dive site has.
- **Solo waiver signature by a minor remains possible.** H-21 accepted this as-is for now,
  explicitly flagged rather than silently left open, to be revisited with the broader H-01–H-03
  waiver legal review. Surfacing the minor badge is what makes the gap *visible* to staff in the
  meantime; it is not a fix for it.

## Alternatives considered

- **Replace `depth_range` with min/max numerics.** Rejected: the prose carries real briefing
  nuance, and rewriting every existing row would have been a lossy migration for no gain — the
  ceiling comparison only ever needs the maximum.
- **Make the depth check a booking gate.** Rejected by the product owner, and correctly: see §2.
- **Store depth in the shop's own unit.** Rejected — two shops' rows would then mean different
  things, and every comparison would need a unit lookup. One canonical unit, converted at the
  edges, is the boring choice.
- **A `junior_open_water` certification level.** Rejected: it would double the ladder enum, and the
  restriction is genuinely age-linked, not card-linked. A junior diver's card does not change on
  their 15th birthday, but their limits do.
