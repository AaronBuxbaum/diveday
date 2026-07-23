import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNotNull,
  isNull,
  ne,
  notInArray,
  or,
} from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { AppDb } from "./client";
import { decodeCursor, encodeCursor } from "./cursor";
import { listOrdersForPerson } from "./orders";
import { listPersonBookingPayments } from "./payments";
import {
  bookings,
  certifications,
  courses,
  nitroxCertifications,
  people,
  personRoles,
  rentalFitProfiles,
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
      .where(
        and(eq(people.shopId, input.shopId), eq(people.email, email), isNull(people.deletedAt)),
      )
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
          isNull(people.deletedAt),
        ),
      )
      .limit(1);
    if (existing) return null;
  }
  const [person] = await db
    .update(people)
    .set({ fullName: input.fullName.trim(), email, phone: input.phone?.trim() || null })
    .where(
      and(eq(people.id, input.personId), eq(people.shopId, input.shopId), isNull(people.deletedAt)),
    )
    .returning();
  return person ?? null;
}

/** Soft-delete a diver. Bookings, cards, and rental fit stay available to operations. */
export async function deleteDiver(db: AppDb, shopId: string, personId: string) {
  const [person] = await db
    .update(people)
    .set({ deletedAt: nowDate() })
    .where(and(eq(people.id, personId), eq(people.shopId, shopId), isNull(people.deletedAt)))
    .returning({ id: people.id });
  return Boolean(person);
}

export async function restoreDiver(db: AppDb, shopId: string, personId: string) {
  const [person] = await db
    .update(people)
    .set({ deletedAt: null })
    .where(and(eq(people.id, personId), eq(people.shopId, shopId), isNotNull(people.deletedAt)))
    .returning({ id: people.id });
  return Boolean(person);
}

export const DIVER_PAGE_SIZE = 50;

/**
 * The diver roster stays server-fed: search is indexed `ilike` over the
 * columns the front desk actually types (name, email, phone — same shape as
 * the command palette in `search.ts`), and pages are keyset-bounded so a shop
 * with thousands of records costs one page, not the whole table.
 */
export async function listDiverSummaries(
  db: AppDb,
  shopId: string,
  options: { query?: string; cursor?: string; limit?: number } = {},
) {
  const query = options.query?.trim() ?? "";
  const limit = options.limit ?? DIVER_PAGE_SIZE;
  const like = query ? `%${query}%` : null;
  const after = decodeCursor(options.cursor);

  const scope = and(
    eq(people.shopId, shopId),
    eq(personRoles.role, "diver"),
    isNull(people.deletedAt),
    like
      ? or(ilike(people.fullName, like), ilike(people.email, like), ilike(people.phone, like))
      : undefined,
  );

  const [rows, [counted]] = await Promise.all([
    db
      .select({ person: people })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(
        and(
          scope,
          after
            ? or(
                gt(people.fullName, after[0]),
                and(eq(people.fullName, after[0]), gt(people.id, after[1])),
              )
            : undefined,
        ),
      )
      .orderBy(asc(people.fullName), asc(people.id))
      .limit(limit + 1),
    db
      .select({ total: count() })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(scope),
  ]);

  const pageRows = rows.slice(0, limit).map(({ person }) => person);
  const last = pageRows.at(-1);
  const nextCursor = rows.length > limit && last ? encodeCursor(last.fullName, last.id) : null;
  const total = counted?.total ?? 0;

  return {
    divers: await summarizeDivers(db, shopId, pageRows),
    nextCursor,
    total,
  };
}

async function summarizeDivers(
  db: AppDb,
  shopId: string,
  peopleRows: (typeof people.$inferSelect)[],
) {
  if (peopleRows.length === 0) return [];
  const ids = peopleRows.map((person) => person.id);
  const [levelCards, specialtyCards, nitroxCards, profiles] = await Promise.all([
    db
      .select()
      .from(certifications)
      .where(
        and(
          eq(certifications.shopId, shopId),
          inArray(certifications.personId, ids),
          isNull(certifications.deletedAt),
        ),
      ),
    db
      .select()
      .from(specialtyCertifications)
      .where(
        and(
          eq(specialtyCertifications.shopId, shopId),
          inArray(specialtyCertifications.personId, ids),
          isNull(specialtyCertifications.deletedAt),
        ),
      ),
    db
      .select()
      .from(nitroxCertifications)
      .where(
        and(
          eq(nitroxCertifications.shopId, shopId),
          inArray(nitroxCertifications.personId, ids),
          isNull(nitroxCertifications.deletedAt),
        ),
      ),
    db
      .select()
      .from(rentalFitProfiles)
      .where(and(eq(rentalFitProfiles.shopId, shopId), inArray(rentalFitProfiles.personId, ids))),
  ]);
  const profileByPerson = new Map(profiles.map((profile) => [profile.personId, profile]));
  return peopleRows.map((person) => {
    const cards = levelCards.filter((card) => card.personId === person.id);
    const specialty = specialtyCards.filter((card) => card.personId === person.id);
    const nitrox = nitroxCards.filter((card) => card.personId === person.id);
    return {
      person,
      certificationCount: cards.length,
      pendingCertificationCount: cards.filter((card) => card.status === "pending").length,
      specialtyCount: specialty.length,
      // Nitrox is not a specialty (see the glossary), but a pending nitrox
      // card needs staff attention just the same, so it counts here.
      pendingSpecialtyOrNitroxCount:
        specialty.filter((card) => card.status === "pending").length +
        nitrox.filter((card) => card.status === "pending").length,
      nitroxCertificationCount: nitrox.length,
      rentalFit: profileByPerson.get(person.id) ?? null,
    };
  });
}

export type BookableDiver = {
  person: typeof people.$inferSelect;
  rentalFit: typeof rentalFitProfiles.$inferSelect | null;
};

/**
 * Returning divers a staffer can drop straight onto a trip without re-entering
 * them — the "enter once, reuse everywhere" path that keeps the roster from
 * minting a second person row (and orphaning the first diver's certs, waivers,
 * and rental fit) every time a regular books. Same indexed `ilike` over
 * name/email/phone the diver roster and command palette use, bounded to a
 * handful of matches. Excludes soft-deleted records and anyone already holding
 * an active seat on this trip — the roster can't book them twice. Carries each
 * candidate's rental fit so the picker can show "fit on file — carries over".
 */
export async function listBookableDivers(
  db: AppDb,
  shopId: string,
  tripId: string,
  options: { query?: string; limit?: number } = {},
): Promise<BookableDiver[]> {
  const query = options.query?.trim() ?? "";
  if (!query) return [];
  const limit = options.limit ?? 6;
  const like = `%${query}%`;

  const bookedRows = await db
    .select({ personId: bookings.personId })
    .from(bookings)
    .where(and(eq(bookings.tripId, tripId), ne(bookings.status, "cancelled")));
  const bookedIds = bookedRows.map((row) => row.personId);

  const rows = await db
    .select({ person: people })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(
      and(
        eq(people.shopId, shopId),
        eq(personRoles.role, "diver"),
        isNull(people.deletedAt),
        or(ilike(people.fullName, like), ilike(people.email, like), ilike(people.phone, like)),
        bookedIds.length ? notInArray(people.id, bookedIds) : undefined,
      ),
    )
    .orderBy(asc(people.fullName), asc(people.id))
    .limit(limit);

  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.person.id);
  const profiles = await db
    .select()
    .from(rentalFitProfiles)
    .where(and(eq(rentalFitProfiles.shopId, shopId), inArray(rentalFitProfiles.personId, ids)));
  const fitByPerson = new Map(profiles.map((profile) => [profile.personId, profile]));
  return rows.map((row) => ({
    person: row.person,
    rentalFit: fitByPerson.get(row.person.id) ?? null,
  }));
}

export async function getDiverProfile(db: AppDb, shopId: string, personId: string) {
  const [personRow] = await db
    .select({ person: people })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(
      and(
        eq(people.id, personId),
        eq(people.shopId, shopId),
        eq(personRoles.role, "diver"),
        isNull(people.deletedAt),
      ),
    )
    .limit(1);
  if (!personRow) return null;

  const [
    levelCards,
    specialtyCards,
    nitroxCards,
    profile,
    bookingRows,
    personOrders,
    personBookingPayments,
  ] = await Promise.all([
    db
      .select()
      .from(certifications)
      .where(
        and(
          eq(certifications.shopId, shopId),
          eq(certifications.personId, personId),
          isNull(certifications.deletedAt),
        ),
      )
      .orderBy(desc(certifications.createdAt)),
    db
      .select()
      .from(specialtyCertifications)
      .where(
        and(
          eq(specialtyCertifications.shopId, shopId),
          eq(specialtyCertifications.personId, personId),
          isNull(specialtyCertifications.deletedAt),
        ),
      )
      .orderBy(desc(specialtyCertifications.createdAt)),
    db
      .select()
      .from(nitroxCertifications)
      .where(
        and(
          eq(nitroxCertifications.shopId, shopId),
          eq(nitroxCertifications.personId, personId),
          isNull(nitroxCertifications.deletedAt),
        ),
      )
      .orderBy(desc(nitroxCertifications.createdAt)),
    db
      .select()
      .from(rentalFitProfiles)
      .where(and(eq(rentalFitProfiles.shopId, shopId), eq(rentalFitProfiles.personId, personId)))
      .limit(1),
    db
      .select({ booking: bookings, trip: trips, course: courses })
      .from(bookings)
      .innerJoin(trips, eq(trips.id, bookings.tripId))
      .leftJoin(courses, eq(courses.id, trips.courseId))
      .where(and(eq(bookings.shopId, shopId), eq(bookings.personId, personId)))
      .orderBy(desc(trips.startsAt)),
    listOrdersForPerson(db, shopId, personId),
    listPersonBookingPayments(db, shopId, personId),
  ]);

  return {
    person: personRow.person,
    certifications: levelCards,
    specialtyCertifications: specialtyCards,
    nitroxCertifications: nitroxCards,
    rentalFit: profile[0] ?? null,
    bookings: bookingRows,
    orders: personOrders,
    bookingPayments: personBookingPayments,
  };
}
