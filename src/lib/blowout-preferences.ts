import { BLOWOUT_MAX_OFFERS } from "./blowout";
import { isUuid } from "./uuid";

/** Malformed input never becomes a different cancellation choice. Stale valid ids are re-scoped later. */
export function parseBlowoutPreferences(values: readonly unknown[]): string[] | null {
  if (!values.every((value): value is string => typeof value === "string" && isUuid(value)))
    return null;
  const ids = [...new Set(values)];
  return ids.length <= BLOWOUT_MAX_OFFERS ? ids : null;
}
