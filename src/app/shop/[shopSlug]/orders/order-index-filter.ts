import { ORDER_DEFAULT_RANGE_DAYS, type ShopOrderFilter } from "@/db/orders";
import { orderStatus } from "@/db/schema";
import { uuidParam } from "@/lib/uuid";
import { wallTimeToUtc } from "@/lib/zoned";

/** The Orders index's own URL parameters, as the toolbar and the links into it write them. */
export type OrderIndexParams = {
  status?: string;
  personId?: string;
  /** The toolbar's one search box — diver name, departure title, order note. */
  q?: string;
  /** One departure's orders — the trip pulse's awaiting-payment fact links here. */
  tripId?: string;
  /** `cancelled` lists the orders left on released seats; anything else is the boat's live seats. */
  seats?: string;
  from?: string;
  to?: string;
  range?: string;
};

const DATE_INPUT = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * An `?from=`/`?to=` day (shop-local, `<input type="date">` value) to a UTC
 * instant — the day's start for `from`, the *next* day's start for `to` so
 * the whole end day is included in a `[from, to)` range. Malformed or absent
 * input is simply not a filter, never a thrown error over a stray query param.
 */
function dayBoundary(
  value: string | undefined,
  timeZone: string,
  addDays: number,
): Date | undefined {
  const match = value ? DATE_INPUT.exec(value) : null;
  if (!match) return undefined;
  const [, year, month, day] = match;
  return wallTimeToUtc(
    { year: Number(year), month: Number(month), day: Number(day) + addDays, hour: 0, minute: 0 },
    timeZone,
  );
}

/**
 * **One reading of the Orders index's URL**, for the page and for "Download
 * orders (CSV)" alike (third UX review, item 34): the file holds the orders the
 * page is showing, so the two read the same parameters the same way.
 *
 * Every id is validated the way `?status=` is validated against its enum:
 * `trips.id` and `orders.person_id` are `uuid` columns, so a stray
 * `?tripId=nope` reaching the query is not an empty list, it is a thrown
 * `invalid input syntax for type uuid` and a 500. A malformed value is simply
 * not a filter.
 *
 * The index is windowed unless it is told otherwise: without one it loaded
 * every invoice a shop has ever raised. `?range=all` is the stated way out,
 * and an explicit `?from=`/`?to=` replaces the window rather than nesting
 * inside it. `range` is authoritative when present: Custom with no bounds yet
 * filters nothing and is what puts the two date inputs on screen.
 */
export function orderIndexFilter(params: OrderIndexParams, timeZone: string, now: Date) {
  const status = orderStatus.enumValues.find((value) => value === params.status);
  const query = params.q?.trim() || undefined;
  const tripId = uuidParam(params.tripId);
  const personId = uuidParam(params.personId);
  // One departure's orders read the boat's live seats unless the cancelled
  // seats are asked for by name (issue #2550): the pulse's count and the list
  // it opens then agree, and the rest stays one link away.
  const seats: "live" | "cancelled" | undefined = tripId
    ? params.seats === "cancelled"
      ? "cancelled"
      : "live"
    : undefined;
  const fromBoundary = dayBoundary(params.from, timeZone, 0);
  const toBoundary = dayBoundary(params.to, timeZone, 1);
  const hasDateBounds = Boolean(fromBoundary || toBoundary);
  const range: "all" | "recent" | "custom" =
    params.range === "all"
      ? "all"
      : params.range === "recent"
        ? "recent"
        : params.range === "custom" || hasDateBounds
          ? "custom"
          : "recent";
  const custom = range === "custom";
  const filter: ShopOrderFilter = {
    status,
    personId,
    // The search **combines** with a pinned diver rather than yielding to it.
    q: query,
    tripId,
    seats,
    from: custom
      ? fromBoundary
      : range === "recent"
        ? new Date(now.getTime() - ORDER_DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000)
        : undefined,
    to: custom ? toBoundary : undefined,
  };
  return { filter, range, status, query, tripId, personId, seats };
}
