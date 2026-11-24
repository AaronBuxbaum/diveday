import type { TripGuests } from "@/features/trips/trip-guests";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { cachedListFormat } from "@/lib/intl-cache";
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
 * Capped at the open seats and at `BULK_OFFER_LIMIT`, counted in people: an
 * offer holds no seat, so a few more asks than seats cannot oversell, and a
 * short batch leaves the next in line for the next press.
 *
 * Left to their own row's **Offer a seat**, where the staffer is looking at
 * them: anyone already offered this seat (no second email from one press),
 * anyone below the departure's bar, and anyone with no address to write to.
 *
 * Nobody on a departure sold elsewhere (its seats are not sold here) or for
 * a role that may not act on the wait list. Advice for the button only: the
 * held send holds the same gates again when it fires (`offerSeats`).
 */
export function bulkOfferCandidates(input: {
  groups: readonly WhoWantsInGroup[];
  openSeats: number;
  canOffer: boolean;
  soldElsewhere: boolean;
}): WhoWantsInRow[] {
  if (!input.canOffer || input.soldElsewhere) return [];
  const limit = Math.min(BULK_OFFER_LIMIT, input.openSeats);
  const picked: WhoWantsInRow[] = [];
  const seen = new Set<string>();
  for (const group of input.groups) {
    for (const row of [...group.rows, ...(group.more ?? [])]) {
      if (picked.length >= limit) return picked;
      if (seen.has(row.interestId)) continue;
      seen.add(row.interestId);
      if (row.offeredAt || row.belowBar || !row.email) continue;
      picked.push(row);
    }
  }
  return picked;
}

/** What `fillingBulkOffer` reads of a departure's guests. */
export type FillingOfferGuests = Pick<
  TripGuests,
  | "trip"
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
      count,
      names: cachedListFormat(locale, { style: "long", type: "conjunction" }).format(
        rows.map((row) => row.name),
      ),
    }),
    send: t("trips.clock.filling.sendOffers", { count }),
    next: t("trips.clock.filling.offerNext", { count }),
  };
}
