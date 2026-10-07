import { MAX_PRICE_MINOR_UNITS, majorToMinor } from "@/lib/money";

/**
 * A departure's terms for the people aboard who are not diving (ADR
 * 20261007-participant-types): a snorkeler's price, a rider's price, and an
 * optional limit on how many of the seats may dive.
 *
 * Its own small form on the trip's details, rather than three more fields in
 * the shared details patch (`src/lib/trip-details.ts`), so a shop that never
 * carries a snorkeler never meets them, and the patch every schedule edit
 * travels through does not grow three fields it has to carry.
 */
export type ParticipantTermsPatch = {
  snorkelerPriceCents: number | null;
  riderPriceCents: number | null;
  diverCapacity: number | null;
};

/** The schema's own bound on `trips.diver_capacity`, matching `capacity`'s. */
export const MAX_DIVER_SEATS = 60;

/**
 * Read the three boxes as typed. A blank box is "not stated": a blank price
 * keeps that seat off the public form, a blank diver limit means every seat may
 * dive. Anything else must be a real amount or count, or the whole submission
 * is refused; nothing is quietly rounded into a different policy.
 *
 * The diver limit may not exceed the boat's own capacity. Equal is allowed and
 * binds nothing (`diverSeatLimit`), which is how a shop says "every seat"
 * without clearing the box.
 */
export function parseParticipantTerms(
  fields: { snorkelerPrice: unknown; riderPrice: unknown; diverSeats: unknown },
  context: { currency: string; capacity: number },
): { ok: true; patch: ParticipantTermsPatch } | { ok: false } {
  const snorkeler = parsePrice(fields.snorkelerPrice, context.currency);
  const rider = parsePrice(fields.riderPrice, context.currency);
  const diverSeats = parseSeats(fields.diverSeats);
  if (snorkeler === undefined || rider === undefined || diverSeats === undefined) {
    return { ok: false };
  }
  if (diverSeats !== null && diverSeats > context.capacity) return { ok: false };
  return {
    ok: true,
    patch: { snorkelerPriceCents: snorkeler, riderPriceCents: rider, diverCapacity: diverSeats },
  };
}

function blank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && !value.trim());
}

/** Null for blank, undefined for unreadable, else minor units. */
function parsePrice(value: unknown, currency: string): number | null | undefined {
  if (blank(value)) return null;
  if (typeof value !== "string") return undefined;
  const major = Number(value.trim());
  if (!Number.isFinite(major) || major < 0) return undefined;
  const minor = majorToMinor(major, currency);
  return minor > MAX_PRICE_MINOR_UNITS ? undefined : minor;
}

function parseSeats(value: unknown): number | null | undefined {
  if (blank(value)) return null;
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) return undefined;
  const seats = Number(value.trim());
  return seats >= 1 && seats <= MAX_DIVER_SEATS ? seats : undefined;
}
