import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  ne,
  notInArray,
  or,
} from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { type AppDb, isUniqueConstraintViolation } from "./client";
import { listOrdersForPerson } from "./orders";
import { offsetPage } from "./paging";
import { listPersonBookingPayments } from "./payments";
import {
  bookings,
  certifications,
  courses,
  nitroxCertifications,
  people,
  personRoles,
  priorVisits,
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

/**
 * Create a reusable shop person without requiring a booking first. Returns
 * null both for the ordinary "someone with this email already exists" case
 * and for the race where a concurrent write (a booking, a wait-list join, an
 * import row) claims the same email between the check and this insert
 * (people_shop_email_unique, CR-008) — either way, staff must go find and
 * reuse the existing diver rather than getting a second row silently split
 * off from the first's history.
 */
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

  try {
    return await db.transaction(async (tx) => {
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
  } catch (error) {
    if (isUniqueConstraintViolation(error)) return null;
    throw error;
  }
}

export async function updateDiver(
  db: AppDb,
  input: {
    shopId: string;
    personId: string;
    fullName: string;
    email?: string;
    phone?: string;
    diveInsurance?: string;
    /** Date-only "YYYY-MM-DD", or "" to clear. Undefined leaves it untouched. */
    dateOfBirth?: string;
    /**
     * Staff-entered directly on the diver record (task 144 — Today used to say
     * "ask at the counter" with no field to type it into). Undefined leaves it
     * untouched; "" clears it — unlike `saveBookingEmergencyContact`'s
     * blanks-never-overwrite rule for the diver-facing capture on /ready and
     * /waivers, a staffer correcting a wrong entry here must be able to blank it.
     */
    emergencyContactName?: string;
    emergencyContactPhone?: string;
  },
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
  try {
    const [person] = await db
      .update(people)
      .set({
        fullName: input.fullName.trim(),
        email,
        phone: input.phone?.trim() || null,
        ...(input.diveInsurance === undefined
          ? {}
          : { diveInsurance: input.diveInsurance.trim() || null }),
        ...(input.dateOfBirth === undefined
          ? {}
          : { dateOfBirth: input.dateOfBirth.trim() || null }),
        ...(input.emergencyContactName === undefined
          ? {}
          : { emergencyContactName: input.emergencyContactName.trim() || null }),
        ...(input.emergencyContactPhone === undefined
          ? {}
          : { emergencyContactPhone: input.emergencyContactPhone.trim() || null }),
      })
      .where(
        and(
          eq(people.id, input.personId),
          eq(people.shopId, input.shopId),
          isNull(people.deletedAt),
        ),
      )
      .returning();
    return person ?? null;
  } catch (error) {
    // Same race as the check above, closed instead of just narrowed
    // (people_shop_email_unique, CR-008): a concurrent write claimed this
    // email between the read and this write.
    if (isUniqueConstraintViolation(error)) return null;
    throw error;
  }
}

/**
 * Soft-delete a diver. Bookings, cards, and rental fit stay available to
 * operations, and the record itself is untouched — this is removal from the
 * active lists, not erasure. Erasing a diver's identity and medical data is a
 * separate, one-way, owner-only operation (`anonymizeDiver`,
 * `src/db/anonymize.ts`, ADR 20260802-diver-data-erasure).
 */
export async function deleteDiver(db: AppDb, shopId: string, personId: string) {
  const [person] = await db
    .update(people)
    .set({ deletedAt: nowDate() })
    .where(and(eq(people.id, personId), eq(people.shopId, shopId), isNull(people.deletedAt)))
    .returning({ id: people.id });
  return Boolean(person);
}

/**
 * Undo a soft-delete. Refuses (returns false) if an active person at this
 * shop now holds the same email — the partial unique index would reject it
 * anyway (people_shop_email_unique, CR-008), and a diver who re-registered
 * while this one was deleted must not be silently clobbered by the undo.
 *
 * Also refuses an **erased** record. There is no undo for erasure: restoring
 * one would put a half-blank person back on the active roster with a sentinel
 * for a name and no way to recover what was destroyed. The `isNull` below is
 * the polite refusal; `people_anonymized_stays_removed` is the structural one,
 * so a future caller that forgets this clause is refused by the database
 * instead of quietly succeeding.
 */
export async function restoreDiver(db: AppDb, shopId: string, personId: string) {
  try {
    const [person] = await db
      .update(people)
      .set({ deletedAt: null })
      .where(
        and(
          eq(people.id, personId),
          eq(people.shopId, shopId),
          isNotNull(people.deletedAt),
          isNull(people.anonymizedAt),
        ),
      )
      .returning({ id: people.id });
    return Boolean(person);
  } catch (error) {
    if (isUniqueConstraintViolation(error)) return false;
    throw error;
  }
}

export const DIVER_PAGE_SIZE = 20;

/**
 * The diver roster stays server-fed: search is indexed `ilike` over the
 * columns the front desk actually types (name, email, phone — same shape as
 * the command palette in `search.ts`), and pages are bounded so a shop with
 * thousands of records costs one page, not the whole table.
 */
/**
 * Named roster views for common front-desk jobs. Deliberately code-defined, not
 * a per-shop table: they are role-shaped presets over the one roster ("who needs
 * a safety contact chased", "who carries insurance"), and any staffer can pin
 * their own combinations in the browser (see DiverQuickViews). Each is a cheap
 * WHERE clause applied to both the page and its count, so filtering never
 * breaks the paging.
 */
export type DiverFilter = "all" | "missing_contact" | "insured";

export const DIVER_FILTERS = ["all", "missing_contact", "insured"] as const;

export function isDiverFilter(value: string | undefined): value is DiverFilter {
  return value === "all" || value === "missing_contact" || value === "insured";
}

function diverFilterCondition(filter: DiverFilter) {
  if (filter === "missing_contact") {
    // "On file" needs both a name and a phone (glossary — Emergency contact), so
    // a hole in either lands the diver in this view.
    return or(
      isNull(people.emergencyContactName),
      eq(people.emergencyContactName, ""),
      isNull(people.emergencyContactPhone),
      eq(people.emergencyContactPhone, ""),
    );
  }
  if (filter === "insured") {
    return and(isNotNull(people.diveInsurance), ne(people.diveInsurance, ""));
  }
  return undefined;
}

export async function listDiverSummaries(
  db: AppDb,
  shopId: string,
  options: { query?: string; page?: number; limit?: number; filter?: DiverFilter } = {},
) {
  const query = options.query?.trim() ?? "";
  const like = query ? `%${query}%` : null;

  const scope = and(
    eq(people.shopId, shopId),
    eq(personRoles.role, "diver"),
    isNull(people.deletedAt),
    diverFilterCondition(options.filter ?? "all"),
    like
      ? or(ilike(people.fullName, like), ilike(people.email, like), ilike(people.phone, like))
      : undefined,
  );

  // Offset rather than keyset. The roster used to page forward-only by cursor,
  // which meant a staffer three pages into "who is missing a safety contact"
  // could only start over — there was no way back one page, and no way to say
  // where they were. Name-then-id is a total order, so an offset lands exactly
  // where "Page 3 of 7" claims (ADR 20260803-one-pagination-model).
  const page = await offsetPage({
    page: options.page,
    pageSize: options.limit ?? DIVER_PAGE_SIZE,
    countRows: async () => {
      const [counted] = await db
        .select({ total: count() })
        .from(people)
        .innerJoin(personRoles, eq(personRoles.personId, people.id))
        .where(scope);
      return counted?.total ?? 0;
    },
    fetchRows: async (offset, limit) =>
      db
        .select({ person: people })
        .from(people)
        .innerJoin(personRoles, eq(personRoles.personId, people.id))
        .where(scope)
        .orderBy(asc(people.fullName), asc(people.id))
        .limit(limit)
        .offset(offset),
  });

  return {
    divers: await summarizeDivers(
      db,
      shopId,
      page.rows.map(({ person }) => person),
    ),
    total: page.total,
    page: page.page,
    pageCount: page.pageCount,
    pageSize: page.pageSize,
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
      // The roster list is a client component, so the whole row would ship to
      // the browser — including every diver's date of birth, which nothing on
      // that list renders and some of which belongs to minors. Drop it at the
      // boundary rather than relying on the UI not to show it. The same argument
      // covers dive insurance (an insurance policy identifier) and the
      // emergency contact (a third party's name and number, never the diver's
      // own): the list renders name, email, and phone, and the importer now
      // fills those other columns roster-wide in one click, so what used to be
      // incidental is systemic (`security-reviewer` finding).
      person: {
        ...person,
        dateOfBirth: null,
        diveInsurance: null,
        emergencyContactName: null,
        emergencyContactPhone: null,
      },
      certificationCount: cards.length,
      pendingCertificationCount: cards.filter((card) => card.status === "pending").length,
      specialtyCount: specialty.length,
      // Nitrox is not a specialty (see the glossary), but a pending nitrox
      // card needs staff attention just the same, so it counts here.
      pendingSpecialtyOrNitroxCount:
        specialty.filter((card) => card.status === "pending").length +
        nitrox.filter((card) => card.status === "pending").length,
      // Imported cards land verified but flagged, awaiting a one-tap staff
      // confirm (ADR 20260724-import-verified-cards). Level and nitrox cards
      // already count as valid, so for them this is a soft "give these a look"
      // nudge, kept separate from the pending-review count above. An imported
      // *specialty* card is counted here too and is more than a nudge: its gate
      // stays shut until the confirm (ADR 20260725-import-specialty-cards).
      importedUnconfirmedCount: [...cards, ...specialty, ...nitrox].filter(
        (card) => card.importedAt && !card.reviewedAt,
      ).length,
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
    visitRows,
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
    // History from the shop's prior system (ADR 20260725-import-prior-visits).
    // Read here and rendered on the profile only — deliberately not joined into
    // anything readiness, capacity, prep, or reporting consumes.
    db
      .select()
      .from(priorVisits)
      .where(and(eq(priorVisits.shopId, shopId), eq(priorVisits.personId, personId)))
      .orderBy(desc(priorVisits.visitedOn)),
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
    priorVisits: visitRows,
  };
}
