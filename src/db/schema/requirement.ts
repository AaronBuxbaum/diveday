import { boolean, jsonb } from "drizzle-orm/pg-core";
import { certificationLevel, type diveSpecialty } from "./core";

/**
 * The three columns a stored `Requirement` (src/lib/requirement.ts) is kept in.
 * A dive site and a departure's requirements row both spread this, so the
 * column names, types and defaults cannot drift between the two tables, and
 * `parseRequirement` / `serializeRequirement` read and write exactly them.
 *
 * - `minimumCertificationLevel`: null deliberately means no existing C-card is
 *   required, never unknown.
 * - `requiredSpecialties`: specialty cards demanded on top of the level; a
 *   trip's list is unioned with its sites'.
 * - `requiresNitrox`: whether a verified nitrox card is demanded to board.
 *   Evidence lives in nitrox_certifications (also the mix-request gate), so
 *   this is its own flag, not a member of `requiredSpecialties`; a trip's flag
 *   is OR'd with its sites'.
 *
 * A function, so each table gets its own column builders.
 */
export function requirementColumns() {
  return {
    minimumCertificationLevel: certificationLevel("minimum_certification_level"),
    requiredSpecialties: jsonb("required_specialties")
      .$type<(typeof diveSpecialty.enumValues)[number][]>()
      .notNull()
      .default([]),
    requiresNitrox: boolean("requires_nitrox").notNull().default(false),
  };
}
