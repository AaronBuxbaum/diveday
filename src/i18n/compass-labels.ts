import type { CardinalDirection } from "@/lib/marine-forecast";
import type { StaffMessageKey, StaffTranslator } from "./staff-messages";

/**
 * Localized eight-point compass labels for staff bearing readers. Translate
 * the bearing code rather than uppercasing it: Spanish uses O, SO, and NO for
 * west, southwest, and northwest.
 */
const COMPASS_KEYS: Record<CardinalDirection, StaffMessageKey> = {
  n: "shared.compass.n",
  ne: "shared.compass.ne",
  e: "shared.compass.e",
  se: "shared.compass.se",
  s: "shared.compass.s",
  sw: "shared.compass.sw",
  w: "shared.compass.w",
  nw: "shared.compass.nw",
};

/**
 * A bearing code as the letters this reader's compass uses. Missing direction
 * returns an empty string for optional ICU interpolation.
 */
export function compassText(
  t: StaffTranslator,
  code: CardinalDirection | null | undefined,
): string {
  return code ? t(COMPASS_KEYS[code]) : "";
}
