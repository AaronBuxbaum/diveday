import { JUNIOR_AGE_END, JUNIOR_MINIMUM_AGE, JUNIOR_YOUNGEST_BAND_END } from "./age";
import { checkDepthCeiling, juniorAgeCeiling } from "./depth-ceiling";
import type { DepthUnit } from "./depth-units";

/**
 * What a parent is told beside a child's age on a boat booking. Codes and
 * numbers only; the words are the diver bundle's (`party.junior*`).
 *
 * The limits come from `juniorAgeCeiling` (the same bands the roster's depth
 * warning reads) and the supervision wording from the course templates, so a
 * boat page and the Open Water page cannot disagree. It informs and never
 * refuses: an age below the minimum is "the shop will be in touch".
 */
export type JuniorRule =
  | { kind: "below_minimum" }
  | {
      kind: "junior";
      supervision: "professional_or_parent" | "certified_adult";
      /** The depth limit, in `unit`, from the agency's published pair. */
      limit: number;
      unit: DepthUnit;
      /** A planned site goes deeper than the limit; the crew plans within it. */
      deeperSites: boolean;
    };

/** Null from the age the junior limits lift: there is nothing to add. */
export function juniorRuleForAge(
  age: number,
  deepestSiteMeters: number | null,
  unit: DepthUnit,
): JuniorRule | null {
  if (age >= JUNIOR_AGE_END) return null;
  if (age < JUNIOR_MINIMUM_AGE) return { kind: "below_minimum" };
  const ceiling = juniorAgeCeiling(age);
  const check = checkDepthCeiling(
    deepestSiteMeters,
    { ceiling, basis: "junior_age", level: null },
    unit,
  );
  return {
    kind: "junior",
    supervision: age < JUNIOR_YOUNGEST_BAND_END ? "professional_or_parent" : "certified_adult",
    limit: unit === "feet" ? ceiling.feet : ceiling.meters,
    unit,
    deeperSites: check.status === "exceeds",
  };
}
