import { and, asc, eq, ne } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { PrepDiver } from "@/lib/dive-prep";
import type { AppDb } from "./client";
import { verifiedNitroxPersonIds } from "./nitrox";
import { bookings, people, rentalFitProfiles } from "./schema";

export type RentalFitInput = {
  shopId: string;
  personId: string;
  rentsBcd: boolean;
  rentsRegulator: boolean;
  rentsWetsuit: boolean;
  rentsMaskFins: boolean;
  rentsWeights: boolean;
  rentsDiveComputer: boolean;
  rentsGopro: boolean;
  bcdSize?: string;
  wetsuitSize?: string;
  bootSize?: string;
  finSize?: string;
  weightPreference?: string;
  note?: string;
};

function optional(value: string | undefined) {
  return value?.trim() || null;
}

/**
 * A fit is a living preference, not evidence: staff and divers both correct it
 * as sizes change, so it upserts rather than versioning. The person lookup
 * keeps a copied URL from writing a fit into another shop's tenant.
 */
export async function saveRentalFit(db: AppDb, input: RentalFitInput) {
  const [person] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.id, input.personId), eq(people.shopId, input.shopId)))
    .limit(1);
  if (!person) return null;

  const values = {
    rentsBcd: input.rentsBcd,
    rentsRegulator: input.rentsRegulator,
    rentsWetsuit: input.rentsWetsuit,
    rentsMaskFins: input.rentsMaskFins,
    rentsWeights: input.rentsWeights,
    rentsDiveComputer: input.rentsDiveComputer,
    rentsGopro: input.rentsGopro,
    bcdSize: optional(input.bcdSize),
    wetsuitSize: optional(input.wetsuitSize),
    bootSize: optional(input.bootSize),
    finSize: optional(input.finSize),
    weightPreference: optional(input.weightPreference),
    updatedAt: nowDate(),
  };
  // The note is the diver's own words to the crew ("titanium hip, I run heavy").
  // Only a form that actually carries it may write it — otherwise staff nudging
  // a boot size would silently delete something nobody can recover.
  const withNote = input.note === undefined ? values : { ...values, note: optional(input.note) };
  const [profile] = await db
    .insert(rentalFitProfiles)
    .values({ shopId: input.shopId, personId: input.personId, ...withNote })
    .onConflictDoUpdate({
      target: [rentalFitProfiles.shopId, rentalFitProfiles.personId],
      set: withNote,
    })
    .returning();
  return profile ?? null;
}

export async function getRentalFit(db: AppDb, shopId: string, personId: string) {
  const [profile] = await db
    .select()
    .from(rentalFitProfiles)
    .where(and(eq(rentalFitProfiles.shopId, shopId), eq(rentalFitProfiles.personId, personId)))
    .limit(1);
  return profile ?? null;
}

/**
 * Everything the prep checklist needs for one departure, in one read: the
 * active roster, each diver's fit, and — separately from the booking's own
 * request flag — whether their nitrox card is verified right now.
 */
export async function listTripPrepDivers(
  db: AppDb,
  shopId: string,
  tripId: string,
): Promise<PrepDiver[]> {
  const rows = await db
    .select({ booking: bookings, person: people, fit: rentalFitProfiles })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .leftJoin(
      rentalFitProfiles,
      and(
        eq(rentalFitProfiles.personId, bookings.personId),
        eq(rentalFitProfiles.shopId, bookings.shopId),
      ),
    )
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.tripId, tripId),
        ne(bookings.status, "cancelled"),
      ),
    )
    .orderBy(asc(people.fullName));

  const certified = await verifiedNitroxPersonIds(db, shopId);
  return rows.map((row) => ({
    bookingId: row.booking.id,
    fullName: row.person.fullName,
    fit: row.fit,
    wantsNitrox: row.booking.wantsNitrox,
    hasVerifiedNitroxCard: certified.has(row.person.id),
  }));
}

/**
 * Fits for one trip's active roster, keyed by booking. Joined from bookings so
 * a caller that already has the roster does not have to wait for it first —
 * this reads in parallel with everything else a manifest needs.
 */
export async function rentalFitByBooking(db: AppDb, shopId: string, tripId: string) {
  const rows = await db
    .select({ bookingId: bookings.id, fit: rentalFitProfiles })
    .from(bookings)
    .leftJoin(
      rentalFitProfiles,
      and(
        eq(rentalFitProfiles.personId, bookings.personId),
        eq(rentalFitProfiles.shopId, bookings.shopId),
      ),
    )
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.tripId, tripId),
        ne(bookings.status, "cancelled"),
      ),
    );
  return new Map(rows.map((row) => [row.bookingId, row.fit]));
}
