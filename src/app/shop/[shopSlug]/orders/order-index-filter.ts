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

/** Convert shop-local date inputs to UTC boundaries; `to` is the exclusive start of the next day. */
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
 * Shared page/export URL filtering (UX review 3, item 34). Malformed UUIDs
 * are ignored before querying. `all` and `recent` override date bounds;
 * `custom` applies them. Without a recognized range, bounds select `custom`,
 * otherwise the bounded recent window applies. Empty custom bounds impose no
 * date constraint.
 */
export function orderIndexFilter(params: OrderIndexParams, timeZone: string, now: Date) {
  const status = orderStatus.enumValues.find((value) => value === params.status);
  const query = params.q?.trim() || undefined;
  const tripId = uuidParam(params.tripId);
  const personId = uuidParam(params.personId);
  // A trip filter defaults to live seats; cancelled seats remain an explicit alternate.
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

/** The filters the Orders index is showing, as the links out of it keep them. */
export type OrdersIndexView = {
  status?: string;
  personId?: string;
  q?: string;
  tripId?: string;
  seats?: "live" | "cancelled";
  from?: string;
  to?: string;
  range?: string;
};

/** What a link out of the index swaps; everything else it keeps. */
export type OrdersHrefOverrides = {
  page?: number;
  importedPage?: number;
  range?: string | null;
  seats?: "live" | "cancelled";
};

/** Keep current filters while links change paging, range, or seat selection. */
export function ordersIndexHref(
  shopSlug: string,
  view: OrdersIndexView,
  overrides: OrdersHrefOverrides,
  path = "orders",
): string {
  const query = new URLSearchParams();
  if (view.status) query.set("status", view.status);
  if (view.personId) query.set("personId", view.personId);
  if (view.q) query.set("q", view.q);
  if (view.tripId) query.set("tripId", view.tripId);
  if ((overrides.seats ?? view.seats) === "cancelled") query.set("seats", "cancelled");
  if (view.from) query.set("from", view.from);
  if (view.to) query.set("to", view.to);
  // Only the three ranges the page names are kept; anything else is no range.
  const kept = view.range === "all" || view.range === "recent" || view.range === "custom";
  const nextRange = overrides.range === undefined ? (kept ? view.range : null) : overrides.range;
  if (nextRange) query.set("range", nextRange);
  if (overrides.page !== undefined && overrides.page > 1) {
    query.set("page", String(overrides.page));
  }
  if (overrides.importedPage !== undefined && overrides.importedPage > 1) {
    query.set("importedPage", String(overrides.importedPage));
  }
  const search = query.toString();
  return search ? `/shop/${shopSlug}/${path}?${search}` : `/shop/${shopSlug}/${path}`;
}
