import { parseWallTime, toDateInputValue, utcToWallTime, wallTimeToUtc } from "@/lib/zoned";

/** The providers that take sale events; Shopify takes a catalog and has nothing to backfill. */
export const BACKFILL_PROVIDERS = ["quickbooks", "xero", "zapier"] as const;

/**
 * A day typed into the date box, read as the start of that day in the shop's
 * own zone (a date names its zone). Null for anything that is not a real
 * calendar day: `2026-02-31` would otherwise roll into March without a word.
 */
export function backfillSince(day: unknown, timeZone: string): Date | null {
  if (typeof day !== "string") return null;
  const wall = parseWallTime(day, "00:00");
  if (!wall) return null;
  const instant = wallTimeToUtc(wall, timeZone);
  return toDateInputValue(utcToWallTime(instant, timeZone)) === day ? instant : null;
}
