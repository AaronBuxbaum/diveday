import { and, asc, eq, inArray } from "drizzle-orm";
import { calculateReadiness } from "@/lib/readiness";
import type { AppDb } from "./client";
import { bookings, certifications, people, personRoles, tripRequirements, trips } from "./schema";
import { listTripWaiverStatuses } from "./waivers";

export async function getTripRequirements(db: AppDb, shopId: string, tripId: string) {
  const [requirement] = await db
    .select()
    .from(tripRequirements)
    .where(and(eq(tripRequirements.shopId, shopId), eq(tripRequirements.tripId, tripId)))
    .limit(1);
  return requirement ?? null;
}

export async function upsertTripRequirements(
  db: AppDb,
  input: {
    shopId: string;
    tripId: string;
    requiresWaiver: boolean;
    minimumCertificationLevel:
      | "open_water"
      | "advanced_open_water"
      | "rescue"
      | "divemaster"
      | "instructor";
  },
) {
  const [trip] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId)))
    .limit(1);
  if (!trip) return null;
  const [requirement] = await db
    .insert(tripRequirements)
    .values(input)
    .onConflictDoUpdate({
      target: tripRequirements.tripId,
      set: {
        requiresWaiver: input.requiresWaiver,
        minimumCertificationLevel: input.minimumCertificationLevel,
        updatedAt: new Date(),
      },
    })
    .returning();
  return requirement ?? null;
}

export type NewCertification = {
  shopId: string;
  personId: string;
  agency: "padi" | "ssi" | "naui" | "sdi" | "tdi" | "other";
  level: "open_water" | "advanced_open_water" | "rescue" | "divemaster" | "instructor";
  identifier: string;
  expiresAt?: Date;
  cardImageUrl?: string;
};

/** Evidence is captured pending; a separate, explicit review makes it usable for readiness. */
export async function createCertification(db: AppDb, input: NewCertification) {
  const [person] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.id, input.personId), eq(people.shopId, input.shopId)))
    .limit(1);
  if (!person) return null;
  const [certification] = await db
    .insert(certifications)
    .values({
      ...input,
      identifier: input.identifier.trim(),
      cardImageUrl: input.cardImageUrl?.trim() || null,
    })
    .returning();
  return certification ?? null;
}

export async function reviewCertification(
  db: AppDb,
  input: {
    shopId: string;
    certificationId: string;
    status: "verified" | "rejected";
    reviewNote?: string;
  },
) {
  const [certification] = await db
    .update(certifications)
    .set({
      status: input.status,
      reviewNote: input.reviewNote?.trim() || null,
      reviewedAt: new Date(),
    })
    .where(
      and(eq(certifications.id, input.certificationId), eq(certifications.shopId, input.shopId)),
    )
    .returning();
  return certification ?? null;
}

export async function listShopCertifications(db: AppDb, shopId: string) {
  return db
    .select({ certification: certifications, person: people })
    .from(certifications)
    .innerJoin(people, eq(people.id, certifications.personId))
    .where(eq(certifications.shopId, shopId))
    .orderBy(asc(people.fullName), asc(certifications.createdAt));
}

/** Customers are the people whose card evidence can be collected for a trip. */
export async function listShopDivers(db: AppDb, shopId: string) {
  return db
    .select({ id: people.id, fullName: people.fullName, email: people.email })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shopId), eq(personRoles.role, "customer")))
    .orderBy(asc(people.fullName));
}

/** The exact same result drives staff rosters today and diver/manifest views later. */
export async function listTripReadiness(db: AppDb, shopId: string, tripId: string) {
  const [requirement, waiverRows] = await Promise.all([
    getTripRequirements(db, shopId, tripId),
    listTripWaiverStatuses(db, shopId, tripId),
  ]);
  const personIds = waiverRows.map((row) => row.person.id);
  const certificationRows =
    personIds.length === 0
      ? []
      : await db
          .select()
          .from(certifications)
          .where(
            and(eq(certifications.shopId, shopId), inArray(certifications.personId, personIds)),
          );
  const certificationsByPerson = new Map<string, typeof certificationRows>();
  for (const certification of certificationRows) {
    const current = certificationsByPerson.get(certification.personId) ?? [];
    current.push(certification);
    certificationsByPerson.set(certification.personId, current);
  }

  return waiverRows.map((row) => ({
    ...row,
    requirement,
    certifications: certificationsByPerson.get(row.person.id) ?? [],
    readiness: calculateReadiness({
      requirement,
      waiver: row.waiver,
      certifications: certificationsByPerson.get(row.person.id) ?? [],
    }),
  }));
}

export async function getBookingReadiness(db: AppDb, shopId: string, bookingId: string) {
  const [booking] = await db
    .select({ tripId: bookings.tripId })
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.shopId, shopId)))
    .limit(1);
  if (!booking) return null;
  const readiness = await listTripReadiness(db, shopId, booking.tripId);
  return readiness.find((row) => row.booking.id === bookingId)?.readiness ?? null;
}
