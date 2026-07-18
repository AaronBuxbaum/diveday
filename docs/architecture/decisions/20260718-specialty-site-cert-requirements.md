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
- **Nitrox is deliberately excluded** from this set. It is gated per-tank at fill time
  (`nitrox_certifications` / `nitrox_fills`, M7), not per-site, and keeps its own table untouched.
- **Requirements attach to both the dive site and the trip.** `dive_sites` gains an inherent gate
  (`minimum_certification_level`, `required_specialties`); `trip_requirements` gains
  `required_specialties`. The readiness service **composes** them: the effective gate is the
  stricter minimum level and the union of specialties (`combineCertRequirements`). A trip with no
  configured `trip_requirements` row is still "not configured" (blocked) — a site gate never
  substitutes for the explicit per-trip requirement.

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
- Escape hatch: if specialties need per-site depth limits, agency equivalence, or expiry policy
  beyond a single card, revisit by promoting `required_specialties` to a join table with
  per-requirement metadata — a mechanical migration off the current jsonb array.
