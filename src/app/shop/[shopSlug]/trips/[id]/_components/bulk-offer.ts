import type { TripGuests } from "@/features/trips/trip-guests";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { cachedListFormat } from "@/lib/intl-cache";
import { requirementDemandsNothing } from "@/lib/requirement";
import { seatsOnSale, spotsRemaining } from "@/lib/trips";
import type { BulkOfferBatch } from "./BulkOffer";
import type { WhoWantsInGroup } from "./FillSeatsCard";
import { type WhoWantsInRow, whoWantsInGroupsOf } from "./who-wants-in-rows";

/** The most people one "Offer seats" writes to. */
export const BULK_OFFER_LIMIT = 3;

/**
 * **Who "Offer seats" writes to**: the first few people in the fill card's
 * own order (asked for this departure, then for this date, then the
 * last-minute list), each group as the card draws it. Nobody is ranked by fit
 * (ADR 20260813-wait-list-is-a-lead-list): this is the same line, read from
 * the top.
 *
 * **At most `BULK_OFFER_LIMIT` asks, and no more asks than open seats.** An
 * ask is counted once whatever its party size, so a party of four is one ask
 * for four seats: the cap bounds how many emails leave, not how many seats
 * are asked for. An offer holds no seat, so this cannot oversell.
 *
 * **One person, one ask.** A diver with a date ask and a last-minute ask is
 * one candidate: the first row that names them, by person, else by address.
 *
 * Left to their own row's **Offer a seat**, where the staffer is looking at
 * them: anyone already offered this seat (no second email from one press),
 * anyone below the departure's bar, anyone with no address to write to, and,
 * on a departure whose bar asks for a card (`barNeedsCard`), anyone with no
 * verified card on file. Never anyone who already holds a seat here
 * (`seated`): `offerSeats` would drop them silently and the sentence naming
 * the batch would lie.
 *
 * Nobody on a departure sold elsewhere (its seats are not sold here) or for
 * a role that may not act on the wait list. Advice for the button only: the
 * held send holds its own gates again when it fires (`offerSeats`), and the
 * panel reports what that answered.
 */
export function bulkOfferCandidates(input: {
  groups: readonly WhoWantsInGroup[];
  openSeats: number;
  canOffer: boolean;
  soldElsewhere: boolean;
  /** The people holding a seat on this departure. */
  seated?: ReadonlySet<string>;
  /** The departure asks for a certification: only a checked card is picked. */
  barNeedsCard?: boolean;
}): WhoWantsInRow[] {
  if (!input.canOffer || input.soldElsewhere) return [];
  const limit = Math.min(BULK_OFFER_LIMIT, input.openSeats);
  const picked: WhoWantsInRow[] = [];
  const seen = new Set<string>();
  // Seen by interest, by person and by address: whichever names them first.
  const firstSight = (row: WhoWantsInRow) => {
    const keys = [
      `interest:${row.interestId}`,
      row.personId ? `person:${row.personId}` : null,
      row.email ? `email:${row.email.trim().toLowerCase()}` : null,
    ].filter((key): key is string => key !== null);
    const fresh = keys.every((key) => !seen.has(key));
    for (const key of keys) seen.add(key);
    return fresh;
  };
  for (const group of input.groups) {
    for (const row of [...group.rows, ...(group.more ?? [])]) {
      if (picked.length >= limit) return picked;
      if (!firstSight(row)) continue;
      if (row.personId && input.seated?.has(row.personId)) continue;
      if (row.offeredAt || row.belowBar || !row.email) continue;
      if (input.barNeedsCard && (!row.certification || row.certification.unchecked)) continue;
      picked.push(row);
    }
  }
  return picked;
}

/** What `fillingBulkOffer` reads of a departure's guests. */
export type FillingOfferGuests = Pick<
  TripGuests,
  | "trip"
  | "roster"
  | "cancelled"
  | "interests"
  | "dateInterests"
  | "lastMinute"
  | "certificationSummaries"
  | "dealRequirement"
>;

/**
 * Filling's batch for one departure, from what `getTripGuests` read: the page's
 * primary and the fill card both ask here, so the button is drawn exactly
 * when the card has a batch to open. Empty on a cancelled departure, and while
 * the trip takes no guest.
 */
export function fillingBulkOffer(input: {
  guests: FillingOfferGuests;
  canOffer: boolean;
  soldElsewhere: boolean;
  t: StaffTranslator;
  locale: string;
  timezone: string;
}): WhoWantsInRow[] {
  const { guests, t, locale, timezone } = input;
  if (guests.cancelled) return [];
  return bulkOfferCandidates({
    groups: whoWantsInGroupsOf({ guests, t, locale, timezone }),
    openSeats: spotsRemaining(seatsOnSale(guests.trip)),
    seated: new Set(
      guests.roster
        .filter(({ booking }) => booking.status !== "cancelled")
        .map(({ booking }) => booking.personId),
    ),
    barNeedsCard: !requirementDemandsNothing(guests.dealRequirement),
    canOffer: input.canOffer,
    soldElsewhere: input.soldElsewhere,
  });
}

/** The batch in the words that name it: who gets the email, and the press. */
export function bulkOfferBatch(
  rows: readonly WhoWantsInRow[],
  t: StaffTranslator,
  locale: string,
): BulkOfferBatch {
  const count = rows.length;
  return {
    interests: rows.map(({ interestId, name, email }) => ({ interestId, name, email })),
    names: t("trips.clock.filling.offerNames", {
      names: cachedListFormat(locale, { style: "long", type: "conjunction" }).format(
        rows.map((row) => row.name),
      ),
    }),
    send: t("trips.clock.filling.sendOffers", { count }),
    next: t("trips.clock.filling.offerNext", { count }),
  };
}
