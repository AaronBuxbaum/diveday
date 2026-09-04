/**
 * **The certification ladder, on its own, importing nothing** (issue #1354).
 *
 * These live apart from `./readiness.ts` for one reason, and it is a bundle
 * reason rather than a modelling one. `src/i18n/readiness-labels.ts` needs
 * exactly one *value* from that module — `REQUIRABLE_CERTIFICATION_LEVELS` —
 * and everything else it takes is a type, which erases. That single import
 * therefore held the whole of `readiness.ts` in the graph, and behind it the
 * waiver and medical modules: the full RSTC medical questionnaire shipped in
 * the first load of `/s/[shopSlug]` and `/s/[shopSlug]/trips/[id]`, DiveDay's
 * two public, anonymous diver pages, and of `/offline-manifest`.
 *
 * To be plain about what that was and was not: **message-bundle copy, not
 * anybody's answers.** No diver's medical data was involved and nothing leaked.
 * It was 7,111 B raw / 2,631 B gzip of dead weight on precisely the pages a
 * diver opens on a phone, possibly on a boat.
 *
 * The same shape as the four seams PR #1347 closed (`./certification-options.ts`,
 * `./course-limits.ts`): a constant reachable only through a module that drags
 * something much larger behind it. This one survived that sweep because the
 * sweep looked for zod, `node:crypto`, drizzle-orm and the AWS SDK, and never
 * thought to look for copy.
 *
 * `readiness.ts` re-exports everything here, so no existing caller changes.
 * **Keep this file free of imports** — that is the whole of its job. A guard in
 * `src/lib/certification-levels.test.ts` fails if it grows one, because this
 * edge has been cut before (issue #718) and grew back.
 */

/**
 * The five-rung certification ladder. Labels for these live in the message
 * bundles (`src/i18n/readiness-labels.ts` maps each code to a translation key),
 * never here: this states facts about ordering and gates, `src/app` chooses
 * words.
 */
export type CertificationLevel =
  | "open_water"
  | "advanced_open_water"
  | "rescue"
  | "divemaster"
  | "instructor";

/**
 * **What a site or a trip may demand of a diver — the top of it is Rescue.**
 *
 * Deliberately a different set from {@link CertificationLevel}, which is what a
 * person can *hold*. Divemaster and Instructor are working ratings: crew hold
 * them, `src/lib/course-ratios.ts` counts them, and an instructor-led session
 * is gated on one being assigned. None of that is a shop telling a paying
 * diver to hold a professional rating to board a charter, which is the only
 * thing this list is for (issue #630).
 *
 * It stops at Rescue because Rescue is the highest *modelled* recreational
 * rung. Master Scuba Diver is not one: MSD is Rescue plus five specialties
 * plus fifty dives, which a linear ladder cannot express, and the import path
 * deliberately files it under `level_not_gated`
 * (ADR 20260725-imported-card-sighting).
 *
 * The `satisfies` is the same guard `DECLARABLE_CERTIFICATION_LEVELS` carries:
 * a rung spelled wrong here is a compile error rather than a requirement
 * nobody can pick.
 */
export const REQUIRABLE_CERTIFICATION_LEVELS = [
  "open_water",
  "advanced_open_water",
  "rescue",
] as const satisfies readonly CertificationLevel[];

/** A level a site or trip is allowed to demand — see the list above. */
export type RequirableCertificationLevel = (typeof REQUIRABLE_CERTIFICATION_LEVELS)[number];
