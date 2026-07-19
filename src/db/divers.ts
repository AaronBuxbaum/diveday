import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import type { AppDb } from "./client";
import {
  bookings,
  certifications,
  courses,
  gearAssignments,
  gearItems,
  people,
  personRoles,
  rentalGearProfiles,
  rentalGearRequests,
  specialtyCertifications,
  trips,
} from "./schema";

export type NewDiver = {
  shopId: string;
  fullName: string;
  email?: string;
  phone?: string;
};

/** Create a reusable shop person without requiring a booking first. */
export async function createDiver(db: AppDb, input: NewDiver) {
  const email = input.email?.trim().toLowerCase() || null;
  if (email) {
    const [existing] = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.shopId, input.shopId), eq(people.email, email)))
      .limit(1);
    if (existing) return null;
  }

  return db.transaction(async (tx) => {
    const [person] = await tx
      .insert(people)
      .values({
        shopId: input.shopId,
        fullName: input.fullName.trim(),
        email,
        phone: input.phone?.trim() || null,
      })
      .returning();
    if (!person) throw new Error("createDiver: person insert returned no row");
    await tx.insert(personRoles).values({ personId: person.id, role: "diver" });
    return person;
  });
}

export async function updateDiver(
  db: AppDb,
  input: { shopId: string; personId: string; fullName: string; email?: string; phone?: string },
) {
  const email = input.email?.trim().toLowerCase() || null;
  if (email) {
    const [existing] = await db
      .select({ id: people.id })
      .from(people)
      .where(
        and(
          eq(people.shopId, input.shopId),
          eq(people.email, email),
          ne(people.id, input.personId),
        ),
      )
      .limit(1);
    if (existing) return null;
  }
  const [person] = await db
    .update(people)
    .set({ fullName: input.fullName.trim(), email, phone: input.phone?.trim() || null })
    .where(and(eq(people.id, input.personId), eq(people.shopId, input.shopId)))
    .returning();
  return person ?? null;
}

async function diverIds(db: AppDb, shopId: string) {
  const rows = await db
    .select({ person: people })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shopId), eq(personRoles.role, "diver")))
    .orderBy(asc(people.fullName));
  return rows.map(({ person }) => person);
}

export async function listDiverSummaries(db: AppDb, shopId: string) {
  const peopleRows = await diverIds(db, shopId);
  if (peopleRows.length === 0) return [];
  const ids = peopleRows.map((person) => person.id);
  const [levelCards, specialtyCards, profiles, activeAssignments] = await Promise.all([
    db
      .select()
      .from(certifications)
      .where(and(eq(certifications.shopId, shopId), inArray(certifications.personId, ids))),
    db
      .select()
      .from(specialtyCertifications)
      .where(
        and(
          eq(specialtyCertifications.shopId, shopId),
          inArray(specialtyCertifications.personId, ids),
        ),
      ),
    db
      .select()
      .from(rentalGearProfiles)
      .where(and(eq(rentalGearProfiles.shopId, shopId), inArray(rentalGearProfiles.personId, ids))),
    db
      .select({ personId: bookings.personId })
      .from(gearAssignments)
      .innerJoin(gearItems, eq(gearItems.id, gearAssignments.gearItemId))
      .innerJoin(bookings, eq(bookings.id, gearAssignments.bookingId))
      .where(
        and(
          eq(gearAssignments.shopId, shopId),
          eq(gearAssignments.status, "assigned"),
          inArray(bookings.personId, ids),
        ),
      ),
  ]);
  const profileByPerson = new Map(profiles.map((profile) => [profile.personId, profile]));
  const assignedCount = new Map<string, number>();
  for (const row of activeAssignments) {
    assignedCount.set(row.personId, (assignedCount.get(row.personId) ?? 0) + 1);
  }
  return peopleRows.map((person) => {
    const cards = levelCards.filter((card) => card.personId === person.id);
    const specialty = specialtyCards.filter((card) => card.personId === person.id);
    return {
      person,
      certificationCount: cards.length,
      pendingCertificationCount: cards.filter((card) => card.status === "pending").length,
      specialtyCount: specialty.length,
      pendingSpecialtyCount: specialty.filter((card) => card.status === "pending").length,
      gearProfile: profileByPerson.get(person.id) ?? null,
      assignedGearCount: assignedCount.get(person.id) ?? 0,
    };
  });
}

export async function getDiverProfile(db: AppDb, shopId: string, personId: string) {
  const [personRow] = await db
    .select({ person: people })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.id, personId), eq(people.shopId, shopId), eq(personRoles.role, "diver")))
    .limit(1);
  if (!personRow) return null;

  const [levelCards, specialtyCards, profile, bookingRows, gearRows, requests] = await Promise.all([
    db
      .select()
      .from(certifications)
      .where(and(eq(certifications.shopId, shopId), eq(certifications.personId, personId)))
      .orderBy(desc(certifications.createdAt)),
    db
      .select()
      .from(specialtyCertifications)
      .where(
        and(
          eq(specialtyCertifications.shopId, shopId),
          eq(specialtyCertifications.personId, personId),
        ),
      )
      .orderBy(desc(specialtyCertifications.createdAt)),
    db
      .select()
      .from(rentalGearProfiles)
      .where(and(eq(rentalGearProfiles.shopId, shopId), eq(rentalGearProfiles.personId, personId)))
      .limit(1),
    db
      .select({ booking: bookings, trip: trips, course: courses })
      .from(bookings)
      .innerJoin(trips, eq(trips.id, bookings.tripId))
      .leftJoin(courses, eq(courses.id, trips.courseId))
      .where(and(eq(bookings.shopId, shopId), eq(bookings.personId, personId)))
      .orderBy(desc(trips.startsAt)),
    db
      .select({ assignment: gearAssignments, item: gearItems, trip: trips })
      .from(gearAssignments)
      .innerJoin(gearItems, eq(gearItems.id, gearAssignments.gearItemId))
      .innerJoin(bookings, eq(bookings.id, gearAssignments.bookingId))
      .innerJoin(trips, eq(trips.id, bookings.tripId))
      .where(and(eq(gearAssignments.shopId, shopId), eq(bookings.personId, personId)))
      .orderBy(desc(gearAssignments.assignedAt)),
    db
      .select({ request: rentalGearRequests, trip: trips })
      .from(rentalGearRequests)
      .innerJoin(bookings, eq(bookings.id, rentalGearRequests.bookingId))
      .innerJoin(trips, eq(trips.id, bookings.tripId))
      .where(and(eq(rentalGearRequests.shopId, shopId), eq(bookings.personId, personId)))
      .orderBy(desc(rentalGearRequests.updatedAt)),
  ]);

  return {
    person: personRow.person,
    certifications: levelCards,
    specialtyCertifications: specialtyCards,
    gearProfile: profile[0] ?? null,
    bookings: bookingRows,
    gearAssignments: gearRows,
    gearRequests: requests,
  };
}
