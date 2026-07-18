import { and, asc, eq, ne } from "drizzle-orm";
import type { AppDb } from "./client";
import { bookings, people, rentalGearProfiles, rentalGearRequests } from "./schema";

export type RentalGearRequestInput = {
  shopId: string;
  bookingId: string;
  bcd: boolean;
  regulator: boolean;
  wetsuit: boolean;
  maskFins: boolean;
  weights: boolean;
  tank: boolean;
  diveComputer: boolean;
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
 * A request is intentionally editable: it is a diver's planning preference,
 * never evidence of an issued or checked-out item. The booking and shop
 * checks make a copied confirmation URL unable to alter another booking.
 */
export async function saveRentalGearRequest(db: AppDb, input: RentalGearRequestInput) {
  const [booking] = await db
    .select({ id: bookings.id, personId: bookings.personId })
    .from(bookings)
    .where(
      and(
        eq(bookings.id, input.bookingId),
        eq(bookings.shopId, input.shopId),
        ne(bookings.status, "cancelled"),
      ),
    )
    .limit(1);
  if (!booking) return null;

  const values = {
    bcd: input.bcd,
    regulator: input.regulator,
    wetsuit: input.wetsuit,
    maskFins: input.maskFins,
    weights: input.weights,
    tank: input.tank,
    diveComputer: input.diveComputer,
    bcdSize: optional(input.bcdSize),
    wetsuitSize: optional(input.wetsuitSize),
    bootSize: optional(input.bootSize),
    finSize: optional(input.finSize),
    weightPreference: optional(input.weightPreference),
    note: optional(input.note),
    updatedAt: new Date(),
  };
  const [request] = await db
    .insert(rentalGearRequests)
    .values({ shopId: input.shopId, bookingId: booking.id, ...values })
    .onConflictDoUpdate({ target: rentalGearRequests.bookingId, set: values })
    .returning();
  await db
    .insert(rentalGearProfiles)
    .values({
      shopId: input.shopId,
      personId: booking.personId,
      bcdSize: values.bcdSize,
      wetsuitSize: values.wetsuitSize,
      bootSize: values.bootSize,
      finSize: values.finSize,
      weightPreference: values.weightPreference,
    })
    .onConflictDoUpdate({
      target: [rentalGearProfiles.shopId, rentalGearProfiles.personId],
      set: {
        bcdSize: values.bcdSize,
        wetsuitSize: values.wetsuitSize,
        bootSize: values.bootSize,
        finSize: values.finSize,
        weightPreference: values.weightPreference,
        updatedAt: new Date(),
      },
    });
  return request ?? null;
}

export async function getRentalGearRequest(db: AppDb, shopId: string, bookingId: string) {
  const [request] = await db
    .select()
    .from(rentalGearRequests)
    .where(and(eq(rentalGearRequests.shopId, shopId), eq(rentalGearRequests.bookingId, bookingId)))
    .limit(1);
  return request ?? null;
}

export async function getRentalGearProfile(db: AppDb, shopId: string, personId: string) {
  const [profile] = await db
    .select()
    .from(rentalGearProfiles)
    .where(and(eq(rentalGearProfiles.shopId, shopId), eq(rentalGearProfiles.personId, personId)))
    .limit(1);
  return profile ?? null;
}

/** Planning view for a roster; a left join keeps divers with no request visible. */
export async function listTripRentalGearRequests(db: AppDb, shopId: string, tripId: string) {
  return db
    .select({
      booking: bookings,
      person: people,
      request: rentalGearRequests,
      profile: rentalGearProfiles,
    })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .leftJoin(rentalGearRequests, eq(rentalGearRequests.bookingId, bookings.id))
    .leftJoin(
      rentalGearProfiles,
      and(
        eq(rentalGearProfiles.personId, bookings.personId),
        eq(rentalGearProfiles.shopId, bookings.shopId),
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
}
