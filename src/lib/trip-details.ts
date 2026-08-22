import { isValidCalendarDate } from "./calendar-date";
import { MAX_PRICE_MINOR_UNITS, majorToMinor, toShopCurrency } from "./money";
import { paymentGateIsUnclearable } from "./readiness";
import { tripMeetingDays } from "./trip-days";
import { parseWallTime, wallTimeToUtc } from "./zoned";

/**
 * Everything that turns the trip-details *form* into the columns a departure
 * stores: the wall-clock window, the meeting days a multi-day trip runs on, the
 * price boxes in the shop's own currency, the free-cancellation policy, and
 * which hull (if any) the departure sails on.
 *
 * **Why this is a module and not two copies.** Two server actions write a
 * departure's details — the board's add panel (`schedule/board/actions.ts`) and
 * the trip edit form (`trips/[id]/actions.ts`) — and they ran the same pipeline
 * twice, kept in step by a comment ("Same ceiling every other price validator
 * applies (trips/[id]/actions.ts)"). They had drifted three ways, each one
 * something a shop could see, and each one in the same direction: the board was
 * right and the edit form was wrong. A departure created coherently on the board
 * could be edited into a state the board refuses to create.
 *
 * This finishes ADR 20260806-one-trip-create-form rather than reopening it. That
 * decision unified the two forms that *created* a departure; the edit path is the
 * second copy that survived, and it is where the drift landed. The two forms stay
 * two forms — they land refusals in different places and that is genuinely their
 * own business. The rules stop being duplicated.
 *
 * Returns a code, never a sentence and never a redirect (AGENTS.md): the board
 * lands on `?builder=`, the trip page on `?notice=`, and neither landing belongs
 * in here.
 */

/** A meeting day as it is stored: which day of the run, and its UTC instants. */
export type TripScheduleDay = { dayNumber: number; startsAt: Date; endsAt: Date };

export type TripDiveMode = "boat" | "shore" | "pool";

/**
 * The already-zod-parsed form values. Deliberately not a zod schema of its own:
 * the two callers' schemas differ in what they *accept* (the board carries a
 * course, a cadence and a privacy flag the edit form has no box for), and the
 * shared part is what they both mean by the fields below.
 */
export type TripDetailsFields = {
  date: string;
  startTime: string;
  endTime: string;
  dayCount: number;
  priceDollars?: number;
  /**
   * Whether the departure's requirement row demands payment. Absent on the
   * create form, which has no requirements section — a trip being created has
   * no gate yet, so the refusal below cannot fire there.
   */
  requiresPayment?: boolean;
  depositDollars?: number;
  cancellationWindowHours?: number;
  minimumBookings?: number;
  minimumDecisionHours?: number;
  /**
   * Absent on the trip edit form, which has no dive-mode select — an edit
   * leaves the departure on whatever hull it already sails on. When absent the
   * patch carries neither `diveMode` nor `boatId`, so a caller cannot silently
   * write a default over a shop's own answer.
   */
  diveMode?: TripDiveMode;
  boatId?: string | null;
  /**
   * The seats this submission asks for, and the capacity of the hull it is
   * assigned to. Both optional: a caller that is not changing capacity, or a
   * departure with no boat, supplies neither and is not checked.
   */
  capacity?: number;
  /**
   * The assigned hull's own capacity. `null` for a shore or pool dive, an
   * unassigned departure, or a boat row whose capacity was never recorded —
   * every case where there is no vessel number to be over.
   */
  boatCapacity?: number | null;
};

export type TripDetailsShop = {
  timezone: string;
  currency: string;
  hasBoatDiving: boolean;
  hasShoreDiving: boolean;
  hasPoolDiving: boolean;
};

/**
 * Why a submission was refused. `end_before_start` is separate because both
 * callers say something specific about it — the board also counts it as an
 * analytics outcome — while everything else lands as one "that didn't parse".
 */
export type TripDetailsRefusal =
  | "invalid"
  | "end_before_start"
  | "capacity_above_boat"
  | "price_required_by_gate";

export type TripDetailsPatch = {
  startsAt: Date;
  /** The whole departure: day one's departure to the last day's return. */
  endsAt: Date;
  scheduleDays: TripScheduleDay[];
  priceCents: number | null;
  depositCents: number | null;
  cancellationWindowHours: number | null;
  minimumBookings: number | null;
  minimumDecisionHours: number | null;
  diveMode?: TripDiveMode;
  boatId?: string | null;
};

export type TripDetailsResult =
  | { ok: true; patch: TripDetailsPatch }
  | { ok: false; reason: "invalid" | "end_before_start" }
  // Carries the hull's number so the notice can say "Reef Runner holds 6"
  // rather than a bare "that didn't work".
  | { ok: false; reason: "capacity_above_boat"; boatCapacity: number }
  // Clearing the price off a departure that demands payment. See
  // `paymentGateIsUnclearable` — the gate would then be one nobody can clear.
  | { ok: false; reason: "price_required_by_gate" };

export function tripDetailsPatch(
  fields: TripDetailsFields,
  shop: TripDetailsShop,
): TripDetailsResult {
  const invalid = { ok: false, reason: "invalid" } as const;

  const startWall = parseWallTime(fields.date, fields.startTime);
  const endWall = parseWallTime(fields.date, fields.endTime);
  // `parseWallTime` accepts a shape; `isValidCalendarDate` accepts a *day* — and
  // a series stores this string as the anchor its whole cadence is counted from,
  // so "2026-02-31" has to die here rather than three months later. The trip
  // edit form checked only the shape until this module existed.
  if (!startWall || !endWall || !isValidCalendarDate(fields.date)) return invalid;

  // The times must be a coherent single day before we shift them across days or
  // weeks; every meeting day and every occurrence inherits this wall-clock
  // start/end.
  const startsAt = wallTimeToUtc(startWall, shop.timezone);
  const firstDayEndsAt = wallTimeToUtc(endWall, shop.timezone);
  if (firstDayEndsAt <= startsAt) return { ok: false, reason: "end_before_start" };

  // Day by day rather than one offset: a multi-day trip can straddle a DST
  // change, and what a shop promises is the wall-clock time — "back at the dock
  // at 12:30" on both days.
  // **The hull is the ceiling, and nothing checked it until now.** A departure
  // and a boat both carry a capacity; the only thing that ever joined them was
  // the add panel's client-side prefill, which is help rather than a rule and
  // loses to anything typed after it. So a shop could sell 24 seats on a boat
  // it had recorded as holding 6 — and every gate downstream would defend that
  // 24 faithfully, through waivers, cert checks and a manifest. On a US
  // uninspected vessel the six-passenger limit is a legal line, and the app had
  // the number that would catch it and was not looking at it.
  //
  // **Refused, never clamped.** Quietly lowering a number a staffer typed
  // leaves a shop with fewer seats than it meant to sell and no way to find out
  // why.
  if (
    fields.capacity !== undefined &&
    fields.boatCapacity != null &&
    fields.capacity > fields.boatCapacity
  ) {
    return { ok: false, reason: "capacity_above_boat", boatCapacity: fields.boatCapacity };
  }

  const meetingDays = tripMeetingDays({ start: startWall, end: endWall }, fields.dayCount);
  if (!meetingDays) return invalid;
  const scheduleDays = meetingDays.map((meeting, index) => ({
    dayNumber: index + 1,
    startsAt: wallTimeToUtc(meeting.start, shop.timezone),
    endsAt: wallTimeToUtc(meeting.end, shop.timezone),
  }));
  const lastDay = scheduleDays.at(-1);
  if (!lastDay) return invalid;

  // The shop's currency decides the multiplier: 5000 in a JPY shop's price box
  // is ¥5,000 and stores 5000, not a hundredfold ¥500,000.
  const currency = toShopCurrency(shop.currency);
  const priceCents =
    fields.priceDollars === undefined ? null : majorToMinor(fields.priceDollars, currency);
  const depositCents =
    fields.depositDollars === undefined ? null : majorToMinor(fields.depositDollars, currency);
  // The ceiling every other price validator applies (course fees, rental
  // pricing, order line items). Checked on the converted minor units, not the
  // typed number, because the form schemas are module-level and parse before the
  // shop's currency is known — so a forged submit could otherwise store a
  // ten-million-dollar trip or overflow the integer column outright.
  if (
    (priceCents !== null && priceCents > MAX_PRICE_MINOR_UNITS) ||
    (depositCents !== null && depositCents > MAX_PRICE_MINOR_UNITS)
  ) {
    return invalid;
  }

  // **The other door onto the same trap.** The requirements form refuses to put
  // a payment gate on an unpriced departure; this refuses to take the price off
  // a gated one. Both produce a departure that asks nobody for money and blocks
  // every diver who books it, forever (issue #692).
  if (paymentGateIsUnclearable(fields.requiresPayment ?? false, priceCents)) {
    return { ok: false, reason: "price_required_by_gate" };
  }

  const minimumBookings = fields.minimumBookings ?? null;
  const patch: TripDetailsPatch = {
    startsAt,
    endsAt: lastDay.endsAt,
    scheduleDays,
    priceCents,
    depositCents,
    cancellationWindowHours: fields.cancellationWindowHours ?? null,
    minimumBookings,
    // A window with no minimum beside it is not a policy — it would sit in the
    // row saying nothing and read as one on the next edit. The board refused to
    // *create* that state; until this module existed the edit form would happily
    // write it.
    minimumDecisionHours: minimumBookings ? (fields.minimumDecisionHours ?? null) : null,
  };

  if (fields.diveMode !== undefined) {
    // **The shop's own answer wins over the form's.** The builder's dive-mode
    // select is populated by an options fetch that resolves *after* first paint,
    // so for the moment before it lands the form carries `boat` — and a
    // shore-and-pool shop submitting in that window would put a departure on a
    // hull it has told us it does not run. Narrowing here rather than disabling
    // the button also covers a hand-crafted post, and costs the common case (a
    // boat shop) nothing.
    const diveMode = shopOffersDiveMode(shop, fields.diveMode)
      ? fields.diveMode
      : firstOfferedDiveMode(shop);
    patch.diveMode = diveMode;
    // A boat is only ever assigned to a boat departure, at a shop that runs one.
    patch.boatId = diveMode === "boat" ? (fields.boatId ?? null) : null;
  }

  return { ok: true, patch };
}

export function shopOffersDiveMode(
  shop: Pick<TripDetailsShop, "hasBoatDiving" | "hasShoreDiving" | "hasPoolDiving">,
  mode: TripDiveMode,
): boolean {
  if (mode === "boat") return shop.hasBoatDiving;
  if (mode === "shore") return shop.hasShoreDiving;
  return shop.hasPoolDiving;
}

/**
 * What to fall back to when the submitted mode is one this shop does not run.
 * Boat first, matching the builder's own order and `trips.dive_mode`'s default;
 * the `shops_offers_some_dive_mode` check guarantees one of the three is true,
 * so the final `boat` is unreachable rather than a guess.
 */
export function firstOfferedDiveMode(
  shop: Pick<TripDetailsShop, "hasBoatDiving" | "hasShoreDiving" | "hasPoolDiving">,
): TripDiveMode {
  if (shop.hasBoatDiving) return "boat";
  if (shop.hasShoreDiving) return "shore";
  if (shop.hasPoolDiving) return "pool";
  return "boat";
}
