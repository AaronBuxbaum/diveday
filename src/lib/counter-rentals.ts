import { type CalendarDate, calendarDaysBetween, isValidCalendarDate } from "./calendar-date";
import type { GearItemKind } from "./gear";
import type { RentableItemKind, RentalPricing } from "./rentals";

/**
 * **A counter rental** — units from the register lent to a person who is not
 * on a boat that day, for a window of shop-local dates they chose at the
 * counter (ADR 20260815-minimal-gear-register, amended 2026-10-08). The rules
 * here are the ones that need no database: how long a window is, which windows
 * the counter may write, and what the shop's own price list suggests a unit
 * costs for it. Whether a unit is free is never decided here — the
 * `gear_reservations_no_overlap` exclusion constraint decides that.
 */

/**
 * The longest window a counter rental may hold, in days. A month covers a
 * liveaboard week or a long holiday with room to spare; past it, the likeliest
 * story is a mistyped year, and that would hold a unit off every picker until
 * somebody noticed.
 */
export const COUNTER_RENTAL_MAX_DAYS = 31;

/** Days in an inclusive window: a unit out and back the same day is one day. */
export function counterRentalDays(from: CalendarDate, until: CalendarDate): number {
  return calendarDaysBetween(from, until) + 1;
}

export type CounterRentalWindowRefusal = "invalid_window" | "starts_in_past" | "window_too_long";

/**
 * Whether the counter may write this window, as a refusal code or null.
 *
 * **A window may not start before today.** A rental is written when the unit
 * is handed over or booked ahead; one that started yesterday would land on the
 * register already lapsed, and the register would call a unit overdue that the
 * shop never lent on those days.
 */
export function checkCounterRentalWindow(input: {
  from: string;
  until: string;
  todayLocal: CalendarDate;
}): CounterRentalWindowRefusal | null {
  const { from, until, todayLocal } = input;
  if (!isValidCalendarDate(from) || !isValidCalendarDate(until) || until < from) {
    return "invalid_window";
  }
  if (from < todayLocal) return "starts_in_past";
  if (counterRentalDays(from, until) > COUNTER_RENTAL_MAX_DAYS) return "window_too_long";
  return null;
}

/**
 * The price-list entry a register unit is billed under, where there is one.
 *
 * The price list speaks rental-fit words (`RentableItemKind`), the register
 * speaks inventory words, and the two only partly overlap. **Fins carry the
 * mask-and-fins price and a mask carries none**: the list prices the pair as
 * one line, the same convention `sizedRentalKindOfGearKind` keeps, so a pair
 * handed over together is billed once. Every kind with no entry (a tank, a
 * reel, boots) is left for the staffer to price.
 */
function priceListKind(kind: GearItemKind): RentableItemKind | null {
  switch (kind) {
    case "bcd":
    case "regulator":
    case "wetsuit":
    case "weights":
    case "dive_computer":
    case "gopro":
    case "drysuit":
    case "hood":
    case "gloves":
    case "torch":
    case "smb":
      return kind;
    case "fins":
      return "mask_fins";
    default:
      return null;
  }
}

/** The shop's per-day price for a unit of this kind, or null when it has none. */
export function counterRentalDayRateCents(
  pricing: RentalPricing,
  kind: GearItemKind,
): number | null {
  const listKind = priceListKind(kind);
  if (!listKind) return null;
  return pricing.perItemCents[listKind] ?? null;
}

/**
 * The line a unit's price box opens with: the day rate times the days in the
 * window. A suggestion, never a charge — the staffer edits it before anything
 * is billed, and an unpriced kind stays null rather than reading as free.
 */
export function counterRentalLineCents(
  pricing: RentalPricing,
  kind: GearItemKind,
  days: number,
): number | null {
  const rate = counterRentalDayRateCents(pricing, kind);
  return rate === null ? null : rate * days;
}
