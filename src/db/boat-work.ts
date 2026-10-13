import { and, eq, inArray, sql } from "drizzle-orm";
import { rentalFitCompleteness } from "@/lib/rentals";
import type { AppDb } from "./client";
import { authorizesNitroxFill } from "./nitrox";
import { countOpenOrdersByTrip } from "./orders";
import { bookings, nitroxCertifications, people, rentalFitProfiles, shops } from "./schema";

/**
 * **One reader of a boat's work** (third review, item 4). The jobs a
 * departure carries that are not hazards: sizes the packer cannot pack from,
 * nitrox asked for with no verified card, divers with no emergency contact,
 * and orders still awaiting payment. Today's rows for each boat and the
 * boat's own band on the Divers tab both read this, through
 * `boatWorkItems` (`src/lib/boat-work.ts`), so the two can never tell the
 * desk the same boat's state twice and differently.
 *
 * Keyed by the seats the caller already holds per trip (the readiness rows'
 * bookings, the same roster both surfaces count), so a seat cannot be on one
 * and not the other.
 */
export type BoatWorkDiver = { fullName: string };

export type BoatWork = {
  missingFit: BoatWorkDiver[];
  ungatedNitrox: BoatWorkDiver[];
  missingContact: BoatWorkDiver[];
  openOrders: number;
};

const NO_WORK: BoatWork = { missingFit: [], ungatedNitrox: [], missingContact: [], openOrders: 0 };

export async function readBoatWork(
  db: AppDb,
  shopId: string,
  bookingIdsByTrip: ReadonlyMap<string, readonly string[]>,
): Promise<Map<string, BoatWork>> {
  const tripIds = [...bookingIdsByTrip.keys()];
  const [seats, openOrders] = await Promise.all([
    readSeatWork(db, shopId, [...bookingIdsByTrip.values()].flat()),
    countOpenOrdersByTrip(db, shopId, tripIds),
  ]);
  const divers = (ids: readonly string[], gap: (seat: SeatWork) => boolean) =>
    ids.flatMap((id) => {
      const seat = seats.get(id);
      return seat && gap(seat) ? [{ fullName: seat.fullName }] : [];
    });
  return new Map(
    tripIds.map((tripId) => {
      const ids = bookingIdsByTrip.get(tripId) ?? [];
      return [
        tripId,
        {
          missingFit: divers(ids, (seat) => seat.missingFit),
          ungatedNitrox: divers(ids, (seat) => seat.ungatedNitrox),
          missingContact: divers(ids, (seat) => seat.missingContact),
          openOrders: openOrders.get(tripId) ?? 0,
        },
      ];
    }),
  );
}

/** One departure's work, for a caller that holds one trip. */
export function boatWorkFor(work: ReadonlyMap<string, BoatWork>, tripId: string): BoatWork {
  return work.get(tripId) ?? NO_WORK;
}

type SeatWork = {
  fullName: string;
  missingFit: boolean;
  ungatedNitrox: boolean;
  missingContact: boolean;
};

/**
 * Each seat's three per-diver questions, in **one statement**: a boat's work is
 * read on every Today and every trip page, and the render-cost ceilings in
 * `staff-render-cost.test.ts` count statements.
 *
 * - **Sizes.** "Gap" means what `rentalFitCompleteness` means
 *   (src/lib/rentals.ts): any piece the diver takes from the shop with no size
 *   recorded against it. A diver who ticked BCD, wetsuit and weights and gave
 *   one shoe size has a fit row and still a gap; the packer finds out at the
 *   rack otherwise. Scoped to the shop's own catalog (joined, not re-read), so
 *   a fit written before the shop stopped renting an item never nags about a
 *   size nobody can be handed.
 * - **Nitrox.** Asked for, with no card that authorizes a fill right now. A
 *   diver may request nitrox before their card is verified (flagged, not
 *   blocked), and a card can be pulled after a request was accepted; either way
 *   the tank goes back to air unless someone verifies a card before the boat
 *   leaves. Read live through the fill gate's own predicate
 *   (`authorizesNitroxFill`), failing closed: an archived or unconfirmed
 *   imported card counts as no card. An `exists`, so a diver with two cards is
 *   still one seat.
 * - **Contact.** Never a boarding blocker, a dock-settleable nudge, so it is
 *   derived here rather than through the readiness engine. Usable only if the
 *   crew can dial it: a name with no phone reads as "on file" and is
 *   unreachable in an incident.
 */
async function readSeatWork(
  db: AppDb,
  shopId: string,
  bookingIds: readonly string[],
): Promise<Map<string, SeatWork>> {
  const seats = new Map<string, SeatWork>();
  if (bookingIds.length === 0) return seats;
  const rows = await db
    .select({
      bookingId: bookings.id,
      fullName: people.fullName,
      participantType: bookings.participantType,
      wantsNitrox: bookings.wantsNitrox,
      fit: rentalFitProfiles,
      rentalItems: shops.rentalItems,
      contactName: people.emergencyContactName,
      contactPhone: people.emergencyContactPhone,
      nitroxCard: sql<boolean>`exists (${db
        .select({ one: sql`1` })
        .from(nitroxCertifications)
        .where(
          and(
            eq(nitroxCertifications.personId, bookings.personId),
            eq(nitroxCertifications.shopId, bookings.shopId),
            // Shared fill-gate predicate: an imported-but-unconfirmed card does
            // not authorize a fill (ADR 20260724-import-verified-cards).
            authorizesNitroxFill,
          ),
        )})`.mapWith(Boolean),
    })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(shops, eq(shops.id, bookings.shopId))
    .leftJoin(
      rentalFitProfiles,
      and(
        eq(rentalFitProfiles.personId, bookings.personId),
        eq(rentalFitProfiles.shopId, bookings.shopId),
      ),
    )
    .where(and(eq(bookings.shopId, shopId), inArray(bookings.id, [...bookingIds])));
  for (const row of rows) {
    seats.set(row.bookingId, {
      fullName: row.fullName,
      missingFit:
        rentalFitCompleteness(row.fit, row.rentalItems, row.participantType).state !== "complete",
      ungatedNitrox: row.wantsNitrox && !row.nitroxCard,
      missingContact: !row.contactName || !row.contactPhone,
    });
  }
  return seats;
}
