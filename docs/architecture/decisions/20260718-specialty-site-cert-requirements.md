# 20260718-specialty-site-cert-requirements — Model specialties and site-level cert gates

- **Status:** Accepted
- **Date:** 2026-07-18

## Context

M4 shipped a certification gate that was a single recreational **level** on the trip
(`trip_requirements.minimum_certification_level`). The glossary has always said cert requirements
attach to **sites/activities** ("this wreck requires AOW + Deep") and that specialties (Deep,
Wreck, Night, Drysuit) gate specific activities. Those two gaps were the open M4 follow-up. The
invariant that must survive: readiness is a fail-closed safety surface — only explicit verified
evidence produces `ready`, and no new source may become an implicit pass.

## Decision

- **Specialties are a distinct concept, not a ladder rung.** New `dive_specialty` enum
  (`deep`, `wreck`, `night`, `drysuit`) and a `specialty_certifications` table that mirrors the
  `certifications` capture→verify contract (evidence starts `pending`; only a verified, unexpired
  card of the exact specialty clears its gate). A specialty is checked by kind, never by rank, so
  it is modeled apart from the level rank map in `src/lib/readiness.ts`.
- **Nitrox is kept out of the specialty enum/table, but can gate boarding.** Its evidence stays in
  `nitrox_certifications` (which also gates fills, M7) — never folded into `specialty_certifications`
  — so a site or trip requires it via its own `requires_nitrox` boolean, not a member of
  `required_specialties`. This gives nitrox two independent gates: the per-tank fill gate (unchanged)
  and an optional boarding gate (e.g. a nitrox-only charter). A verified nitrox card clears the
  boarding gate; those cards carry no expiry, so there is no expired state.
- **Requirements attach to both the dive site and the trip.** `dive_sites` gains an inherent gate
  (`minimum_certification_level`, `required_specialties`, `requires_nitrox`); `trip_requirements`
  gains the same two. The readiness service **composes** them: the effective gate is the stricter
  minimum level, the union of specialties, and nitrox if either side demands it
  (`combineCertRequirements`). A trip with no configured `trip_requirements` row is still "not
  configured" (blocked) — a site gate never substitutes for the explicit per-trip requirement.

## Alternatives considered

- **One specialty card per diver as columns/flags on `certifications`** — conflates a yes/no gate
  with the ranked ladder that feeds the rank map; rejected.
- **Fold nitrox into the new specialty table** — would rip out the shipped fill-gating for no
  domain gain; nitrox is a fill-time gate, not a site gate. Rejected.
- **Copy site requirements onto the trip requirement at schedule time (snapshot)** — surprises
  staff when a site's gate changes and stale trips silently keep the old gate; composition at read
  time keeps one source of truth. Rejected for now (course-session snapshots remain separate).

## Consequences

- Makes it easy to gate a wreck/deep/night/drysuit trip correctly and to see, on one roster, why
  each diver is or isn't ready — the same shared `calculateReadiness` powers staff rosters, the
  public confirmation, and future manifests with no new pass path.
- Commits us to keeping the `dive_specialty` enum and the rank map in `readiness.ts` in sync when
  either changes (adding a specialty is a schema migration + a label entry).
- **Known constraints (deliberate for this slice):**
  - *Single site.* A trip links one `dive_site_id`, so composition covers only that site. A trip is
    domain-defined as "one or more sites" (glossary); when multi-site itineraries ship, the
    effective gate must fan the same compose rule (stricter level, union of specialties) over
    **every** site on the trip — otherwise a two-tank whose deeper second dive is a separate site
    would under-gate. Until then, put the demanding site's gate on the trip requirement directly.
  - *Conjunctive only.* Composition can express "level X **and** specialty Y", not "level X **or**
    specialty Y". This is fail-closed (never under-gates), but it cannot model an either/or gate; a
    requirement that needs OR semantics must wait for a richer requirement model.
- Escape hatch: if specialties need per-site depth limits, agency equivalence, or expiry policy
  beyond a single card, revisit by promoting `required_specialties` to a join table with
  per-requirement metadata — a mechanical migration off the current jsonb array.

## Amendment, 2026-08-22: the enum stays at four

Issue [689](https://github.com/AaronBuxbaum/diveday/issues/689) asked whether `dive_specialty`
should grow — `cavern` in particular, because the pilot call list targets Florida's spring country
and a springs shop's core product is cavern tours. A `dive-domain-expert` review answered **no**, to
every candidate, and the reasoning is worth more than the list.

**The rule that decides it.** *A word that describes what the dive **is** is not a gate. A word that
describes what the diver had to **train for** is.* Drift, boat, shore, sidemount and photography
describe the dive. Deep, wreck, night and drysuit name a training delta a shop can reasonably demand.

Applied:

- **Cavern — no, and gating on the card would be worse than the gap.** The dive a springs shop
  actually sells is a **guided** tour to Open Water divers who hold no cavern card and never will; a
  shop that ticked a `cavern` requirement would refuse every customer it has. And the card is a
  fraction of what a real cavern operation checks: three lights per diver, a continuous guideline and
  someone who can run it, thirds gas discipline, trim good enough not to silt the room out, the day's
  flow after rain, and the guide's own rating and ratio. DiveDay would check the card, check none of
  the rest, and print **"Ready"** in green under a ceiling. That is this document's existing
  confession about `wreck` — "gating on something coarser than it thinks" — written a second time,
  in a worse place.
- **Cave — no, and not later.** A cave operation is a fill station, a rental desk and a gate; the
  divers arrive as self-organised teams with no captain, no crew and no roll call. It is also
  *tiered* — Cavern → Intro/Apprentice → Full, with hard limits between them — and a boolean tells a
  shop an Apprentice and a Full Cave diver are the same permission. Every other gate here, wrong in
  the permissive direction, produces an uncomfortable dive. This one produces a recovery.
- **Drift — no, emphatically.** The Gulf Stream runs and essentially every east-coast Florida dive is
  a drift; almost nobody holds the card and nobody is asked. A shop configuring its sites would tick
  it on every one — accurately — and fail-closed-block its entire book of business.
- **Sidemount, altitude, ice, DPV, search and recovery, navigation, photography — no.** A gear
  configuration, two wrong markets, a *rental* gate whose honest home is the gear register, and three
  working cards no shop has ever sold a departure against.

**And a caution about the importer's word list**, because it reads like a roadmap and is not:
`DISCIPLINE_QUALIFIER` in `src/lib/import.ts` is a **disambiguation vocabulary** — a word is on it so
that "Advanced Sidemount" is not read as the AOW rung, not because a shop gates on it.

**Three reasons a longer list is actively worse**, none about any individual value:

1. **The enum's length decides what the picker appears to ask.** `SiteFields.tsx` renders it as a
   checkbox grid. At four boxes all obviously cards, a shop reads *"which cards do I demand?"* At
   twenty including cavern, drift and photography, the same grid reads *"what kind of dive is this?"*
   — a taxonomy question, which shops answer accurately, and then the fail-closed gate fires at 06:50
   with the boat loading. Label copy will not save it.
2. **Each value asserts an equivalence class.** Deep, wreck, night and drysuit map cleanly across
   PADI/SSI/NAUI/SDI/RAID. `cavern` does not — NSS-CDS, NACD, PADI, TDI and GUE differ on depth,
   penetration and prerequisites, and GUE Cave 1 *exceeds* cavern with no cavern card to show.
3. **Decorative gates devalue the real ones.** A crew that spends a month overriding a blocker that
   is always wrong is a crew that overrides the Deep blocker on the one morning it is right — the
   mechanism the glossary already states about warnings.

**What the springs case actually wants**, if it is ever built: a **required crew credential on the
departure** ("this trip needs an assigned person holding X") and a **per-departure hard ratio**, the
`INTRO_COURSE_RATIO` shape. A guided cavern tour's safety comes from the professional in the water,
not the customer's wallet, and DiveDay can express neither today. That is a strictly better answer
than a fifth enum value, and it also serves the deep-wreck and night cases.

**Two gaps the review named that are not specialties**, restated here so nobody solves them with
enum values: a **logged dive count** ("AOW *and 25 logged dives*" is the real sentence on a deep-wreck
booking page, and the second clause is the half that catches a newly-minted AOW) — self-reported, so
advisory only, the shape dive recency already has; and the **OR gate** ("AOW *or* Open Water with
Deep"), which the Known constraints above already name and which the field confirms is the single
most common real gate sentence in that market.
