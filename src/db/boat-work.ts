import { and, eq, inArray } from "drizzle-orm";
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
  const byTrip = new Map<string, string[]>(
    [...bookingIdsByTrip.entries()].map(([tripId, ids]) => [tripId, [...ids]]),
  );
  const [missingFit, ungatedNitrox, missingContact, openOrders] = await Promise.all([
    missingFitByTrip(db, shopId, byTrip),
    ungatedNitroxByTrip(db, shopId, byTrip),
    missingEmergencyContactByTrip(db, shopId, byTrip),
    countOpenOrdersByTrip(db, shopId, [...byTrip.keys()]),
  ]);
  return new Map(
    [...byTrip.keys()].map((tripId) => [
      tripId,
      {
        missingFit: missingFit.get(tripId) ?? [],
        ungatedNitrox: ungatedNitrox.get(tripId) ?? [],
        missingContact: missingContact.get(tripId) ?? [],
        openOrders: openOrders.get(tripId) ?? 0,
      },
    ]),
  );
}

/** One departure's work, for a caller that holds one trip. */
export function boatWorkFor(work: ReadonlyMap<string, BoatWork>, tripId: string): BoatWork {
  return work.get(tripId) ?? NO_WORK;
}

/**
 * Divers on an upcoming departure whose rental fit can't be packed from yet.
 * The prep list is derived entirely from fit, so a gap in one is a hole in
 * tomorrow's packing that nobody sees until the diver is standing at the
 * counter.
 *
 * "Gap" means what `rentalFitCompleteness` means (src/lib/rentals.ts): any
 * piece the diver takes from the shop with no size recorded against it. This
 * used to ask only whether a fit *row* existed, which let the commoner failure
 * through — a diver who ticked BCD, wetsuit and weights and gave one shoe size
 * had a row, so Today said nothing and the packer found out at the rack.
 *
 * Scoped to the shop's own catalog, so a fit written before the shop stopped
 * renting an item never nags about a size nobody can be handed. The catalog is
 * one bounded read on a row this function already has the id for; it is not
 * worth threading through every `getTodayWork` caller to save.
 */
async function missingFitByTrip(
  db: AppDb,
  shopId: string,
  bookingIdsByTrip: Map<string, string[]>,
) {
  const bookingIds = [...bookingIdsByTrip.values()].flat();
  // Divers, not a bare count: one diver's row leads with their name, like
  // every other single-diver row on Today, and the caller counts from it.
  const missing = new Map<string, { fullName: string }[]>();
  if (bookingIds.length === 0) return missing;
  const [rows, [shop]] = await Promise.all([
    db
      .select({
        bookingId: bookings.id,
        fullName: people.fullName,
        participantType: bookings.participantType,
        fit: rentalFitProfiles,
      })
      .from(bookings)
      .innerJoin(people, eq(people.id, bookings.personId))
      .leftJoin(
        rentalFitProfiles,
        and(
          eq(rentalFitProfiles.personId, bookings.personId),
          eq(rentalFitProfiles.shopId, bookings.shopId),
        ),
      )
      .where(and(eq(bookings.shopId, shopId), inArray(bookings.id, bookingIds))),
    db.select({ rentalItems: shops.rentalItems }).from(shops).where(eq(shops.id, shopId)).limit(1),
  ]);
  const withoutFit = new Map(
    rows
      .filter(
        (row) =>
          rentalFitCompleteness(row.fit, shop?.rentalItems, row.participantType).state !==
          "complete",
      )
      .map((row) => [row.bookingId, row.fullName]),
  );
  for (const [tripId, ids] of bookingIdsByTrip) {
    const divers = ids
      .filter((id) => withoutFit.has(id))
      .map((id) => ({ fullName: withoutFit.get(id) ?? "" }));
    if (divers.length > 0) missing.set(tripId, divers);
  }
  return missing;
}

/**
 * Divers who asked for Nitrox but hold no verified nitrox card right
 * now. A diver may request nitrox before their card is verified (it's flagged,
 * not blocked), and a card can be pulled after a request was accepted — either
 * way the tank has to go back to air unless someone verifies a card before the
 * boat leaves. Reads the card live and fails closed: an archived card counts
 * as no card.
 */
async function ungatedNitroxByTrip(
  db: AppDb,
  shopId: string,
  bookingIdsByTrip: Map<string, string[]>,
) {
  const bookingIds = [...bookingIdsByTrip.values()].flat();
  const ungated = new Map<string, { fullName: string }[]>();
  if (bookingIds.length === 0) return ungated;
  const rows = await db
    .select({
      bookingId: bookings.id,
      fullName: people.fullName,
      cardId: nitroxCertifications.id,
    })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .leftJoin(
      nitroxCertifications,
      and(
        eq(nitroxCertifications.personId, bookings.personId),
        eq(nitroxCertifications.shopId, bookings.shopId),
        // Shared fill-gate predicate: an imported-but-unconfirmed card does not
        // authorize a fill (ADR 20260724-import-verified-cards).
        authorizesNitroxFill,
      ),
    )
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.wantsNitrox, true),
        inArray(bookings.id, bookingIds),
      ),
    );
  const blocked = new Map(
    rows.filter((row) => !row.cardId).map((row) => [row.bookingId, row.fullName]),
  );
  for (const [tripId, ids] of bookingIdsByTrip) {
    const divers = ids
      .filter((id) => blocked.has(id))
      .map((id) => ({ fullName: blocked.get(id) ?? "" }));
    if (divers.length > 0) ungated.set(tripId, divers);
  }
  return ungated;
}

/**
 * Booked divers with no emergency contact name on file, per trip. This is never
 * a boarding blocker — it is a low-priority, dock-settleable nudge — so it is
 * derived here rather than through the readiness engine, and the caller only
 * surfaces it for boats close enough to matter.
 */
async function missingEmergencyContactByTrip(
  db: AppDb,
  shopId: string,
  bookingIdsByTrip: Map<string, string[]>,
) {
  const bookingIds = [...bookingIdsByTrip.values()].flat();
  // Divers, not a bare count: a queue row about one person leads with their
  // name (design/principles.md #10 — the answer, not a door), so the reader
  // carries who is missing a contact, and the caller counts from it.
  const missing = new Map<string, { fullName: string }[]>();
  if (bookingIds.length === 0) return missing;
  const rows = await db
    .select({
      bookingId: bookings.id,
      fullName: people.fullName,
      contactName: people.emergencyContactName,
      contactPhone: people.emergencyContactPhone,
    })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(and(eq(bookings.shopId, shopId), inArray(bookings.id, bookingIds)));
  // A contact is only usable if the crew can dial it: both a name and a phone.
  // A name with no number reads as "on file" but is unreachable in an incident.
  const without = new Map(
    rows
      .filter((row) => !row.contactName || !row.contactPhone)
      .map((row) => [row.bookingId, row.fullName]),
  );
  for (const [tripId, ids] of bookingIdsByTrip) {
    const divers = ids
      .filter((id) => without.has(id))
      .map((id) => ({ fullName: without.get(id) ?? "" }));
    if (divers.length > 0) missing.set(tripId, divers);
  }
  return missing;
}
