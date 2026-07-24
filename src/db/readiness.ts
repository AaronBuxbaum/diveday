import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { CalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import type { SiteCertRequirement } from "@/lib/readiness";
import { calculateReadiness, unavailableReadiness } from "@/lib/readiness";
import { effectiveWaiverForBooking } from "@/lib/waivers";
import { type AppDb, type DbExecutor, isUniqueConstraintViolation } from "./client";
import { paymentsByBooking } from "./payments";
import type { DiveSpecialty } from "./schema";
import {
  bookings,
  certifications,
  diveSites,
  nitroxCertifications,
  people,
  shops,
  specialtyCertifications,
  tripRequirements,
  trips,
} from "./schema";
import {
  getCurrentWaiverTemplate,
  listSignedWaiversByPerson,
  listTripWaiverStatuses,
} from "./waivers";

export async function getTripRequirements(db: DbExecutor, shopId: string, tripId: string) {
  const [requirement] = await db
    .select()
    .from(tripRequirements)
    .where(and(eq(tripRequirements.shopId, shopId), eq(tripRequirements.tripId, tripId)))
    .limit(1);
  return requirement ?? null;
}

type CertLevel = "open_water" | "advanced_open_water" | "rescue" | "divemaster" | "instructor";

export async function upsertTripRequirements(
  db: AppDb,
  input: {
    shopId: string;
    tripId: string;
    requiresWaiver: boolean;
    minimumCertificationLevel: CertLevel | null;
    requiredSpecialties: DiveSpecialty[];
    requiresNitrox: boolean;
    requiresPayment: boolean;
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
        requiredSpecialties: input.requiredSpecialties,
        requiresNitrox: input.requiresNitrox,
        requiresPayment: input.requiresPayment,
        updatedAt: nowDate(),
      },
    })
    .returning();
  return requirement ?? null;
}

/**
 * The inherent cert gate of a trip's primary dive site, or null when the trip
 * has no site or the site demands nothing. Composed with the trip's own
 * requirement by the readiness service — never a standalone gate.
 */
export async function getTripSiteRequirement(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<SiteCertRequirement | null> {
  const [row] = await db
    .select({
      minimumCertificationLevel: diveSites.minimumCertificationLevel,
      requiredSpecialties: diveSites.requiredSpecialties,
      requiresNitrox: diveSites.requiresNitrox,
    })
    .from(trips)
    .innerJoin(diveSites, eq(diveSites.id, trips.diveSiteId))
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId)))
    .limit(1);
  if (!row) return null;
  if (!row.minimumCertificationLevel && row.requiredSpecialties.length === 0 && !row.requiresNitrox)
    return null;
  return {
    minimumCertificationLevel: row.minimumCertificationLevel,
    requiredSpecialties: row.requiredSpecialties,
    requiresNitrox: row.requiresNitrox,
  };
}

export type NewCertification = {
  shopId: string;
  personId: string;
  agency: "padi" | "ssi" | "naui" | "sdi" | "tdi" | "other";
  level: "open_water" | "advanced_open_water" | "rescue" | "divemaster" | "instructor";
  identifier: string;
  /** Date-only "YYYY-MM-DD", the shop's own local calendar date (CR-009). */
  expiresAt?: CalendarDate;
  cardImageUrl?: string;
};

/**
 * Evidence is captured pending; a separate, explicit review makes it usable for
 * readiness. Refuses (returns null) rather than throwing when a live card
 * already holds the same shop/agency/identifier in any case — the
 * case-insensitive partial unique index would reject it anyway (CR-009).
 */
export async function createCertification(db: AppDb, input: NewCertification) {
  const [person] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.id, input.personId), eq(people.shopId, input.shopId)))
    .limit(1);
  if (!person) return null;
  try {
    const [certification] = await db
      .insert(certifications)
      .values({
        ...input,
        identifier: input.identifier.trim(),
        cardImageUrl: input.cardImageUrl?.trim() || null,
      })
      .returning();
    return certification ?? null;
  } catch (error) {
    if (isUniqueConstraintViolation(error)) return null;
    throw error;
  }
}

export async function reviewCertification(
  db: AppDb,
  input: {
    shopId: string;
    certificationId: string;
    status: "verified";
    reviewNote?: string;
  },
) {
  const [certification] = await db
    .update(certifications)
    .set({
      status: input.status,
      reviewNote: input.reviewNote?.trim() || null,
      reviewedAt: nowDate(),
    })
    .where(
      and(eq(certifications.id, input.certificationId), eq(certifications.shopId, input.shopId)),
    )
    .returning();
  return certification ?? null;
}

/**
 * Soft-archive a level card: it drops out of every readiness/roster read but the
 * row is kept for safety history (ADR 20260719-crud-archive-semantics). Shop-scoped
 * so one shop can never touch another's evidence; a no-op on an already-archived card.
 */
export async function archiveCertification(
  db: AppDb,
  input: { shopId: string; certificationId: string },
) {
  const [row] = await db
    .update(certifications)
    .set({ deletedAt: nowDate() })
    .where(
      and(
        eq(certifications.id, input.certificationId),
        eq(certifications.shopId, input.shopId),
        isNull(certifications.deletedAt),
      ),
    )
    .returning({ id: certifications.id });
  return Boolean(row);
}

/**
 * Undo a soft-archive: bring a level card back into every readiness/roster read.
 * The inverse of `archiveCertification`, powering the land-then-undo affordance.
 * Refuses (returns false) when a live card already holds the same
 * shop/agency/identifier — the partial unique index would reject it, and a
 * re-entered card must never be clobbered by an undo.
 */
export async function restoreCertification(
  db: AppDb,
  input: { shopId: string; certificationId: string },
) {
  const [archived] = await db
    .select()
    .from(certifications)
    .where(
      and(eq(certifications.id, input.certificationId), eq(certifications.shopId, input.shopId)),
    )
    .limit(1);
  if (!archived || archived.deletedAt === null) return false;
  const [conflict] = await db
    .select({ id: certifications.id })
    .from(certifications)
    .where(
      and(
        eq(certifications.shopId, input.shopId),
        eq(certifications.agency, archived.agency),
        sql`lower(${certifications.identifier}) = lower(${archived.identifier})`,
        isNull(certifications.deletedAt),
      ),
    )
    .limit(1);
  if (conflict) return false;
  const [row] = await db
    .update(certifications)
    .set({ deletedAt: null })
    .where(
      and(eq(certifications.id, input.certificationId), eq(certifications.shopId, input.shopId)),
    )
    .returning({ id: certifications.id });
  return Boolean(row);
}

export async function listShopCertifications(db: AppDb, shopId: string) {
  return db
    .select({ certification: certifications, person: people })
    .from(certifications)
    .innerJoin(people, eq(people.id, certifications.personId))
    .where(and(eq(certifications.shopId, shopId), isNull(certifications.deletedAt)))
    .orderBy(asc(people.fullName), asc(certifications.createdAt));
}

export type NewSpecialtyCertification = {
  shopId: string;
  personId: string;
  agency: "padi" | "ssi" | "naui" | "sdi" | "tdi" | "other";
  specialty: DiveSpecialty;
  identifier: string;
  /** Date-only "YYYY-MM-DD", the shop's own local calendar date (CR-009). */
  expiresAt?: CalendarDate;
  cardImageUrl?: string;
};

/**
 * Same capture→verify contract as a level card: evidence starts pending.
 * Refuses (returns null) on a same-shop/agency/identifier collision in any
 * case, mirroring `createCertification` (CR-009).
 */
export async function createSpecialtyCertification(db: AppDb, input: NewSpecialtyCertification) {
  const [person] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.id, input.personId), eq(people.shopId, input.shopId)))
    .limit(1);
  if (!person) return null;
  try {
    const [certification] = await db
      .insert(specialtyCertifications)
      .values({
        ...input,
        identifier: input.identifier.trim(),
        cardImageUrl: input.cardImageUrl?.trim() || null,
      })
      .returning();
    return certification ?? null;
  } catch (error) {
    if (isUniqueConstraintViolation(error)) return null;
    throw error;
  }
}

export async function reviewSpecialtyCertification(
  db: AppDb,
  input: {
    shopId: string;
    certificationId: string;
    status: "verified";
    reviewNote?: string;
  },
) {
  const [certification] = await db
    .update(specialtyCertifications)
    .set({
      status: input.status,
      reviewNote: input.reviewNote?.trim() || null,
      reviewedAt: nowDate(),
    })
    .where(
      and(
        eq(specialtyCertifications.id, input.certificationId),
        eq(specialtyCertifications.shopId, input.shopId),
      ),
    )
    .returning();
  return certification ?? null;
}

/** Soft-archive a specialty card. Shop-scoped, mirroring `archiveCertification`. */
export async function archiveSpecialtyCertification(
  db: AppDb,
  input: { shopId: string; certificationId: string },
) {
  const [row] = await db
    .update(specialtyCertifications)
    .set({ deletedAt: nowDate() })
    .where(
      and(
        eq(specialtyCertifications.id, input.certificationId),
        eq(specialtyCertifications.shopId, input.shopId),
        isNull(specialtyCertifications.deletedAt),
      ),
    )
    .returning({ id: specialtyCertifications.id });
  return Boolean(row);
}

/** Undo a specialty-card soft-archive, mirroring `restoreCertification`. */
export async function restoreSpecialtyCertification(
  db: AppDb,
  input: { shopId: string; certificationId: string },
) {
  const [archived] = await db
    .select()
    .from(specialtyCertifications)
    .where(
      and(
        eq(specialtyCertifications.id, input.certificationId),
        eq(specialtyCertifications.shopId, input.shopId),
      ),
    )
    .limit(1);
  if (!archived || archived.deletedAt === null) return false;
  const [conflict] = await db
    .select({ id: specialtyCertifications.id })
    .from(specialtyCertifications)
    .where(
      and(
        eq(specialtyCertifications.shopId, input.shopId),
        eq(specialtyCertifications.agency, archived.agency),
        sql`lower(${specialtyCertifications.identifier}) = lower(${archived.identifier})`,
        isNull(specialtyCertifications.deletedAt),
      ),
    )
    .limit(1);
  if (conflict) return false;
  const [row] = await db
    .update(specialtyCertifications)
    .set({ deletedAt: null })
    .where(
      and(
        eq(specialtyCertifications.id, input.certificationId),
        eq(specialtyCertifications.shopId, input.shopId),
      ),
    )
    .returning({ id: specialtyCertifications.id });
  return Boolean(row);
}

export async function listShopSpecialtyCertifications(db: AppDb, shopId: string) {
  return db
    .select({ certification: specialtyCertifications, person: people })
    .from(specialtyCertifications)
    .innerJoin(people, eq(people.id, specialtyCertifications.personId))
    .where(
      and(eq(specialtyCertifications.shopId, shopId), isNull(specialtyCertifications.deletedAt)),
    )
    .orderBy(asc(people.fullName), asc(specialtyCertifications.createdAt));
}

/** The exact same result drives staff rosters today and diver/manifest views later. */
export async function listTripReadiness(
  db: DbExecutor,
  shopId: string,
  tripId: string,
  now: Date = nowDate(),
) {
  const [requirement, siteRequirement, waiverRows, currentTemplate, shopRow] = await Promise.all([
    getTripRequirements(db, shopId, tripId),
    getTripSiteRequirement(db, shopId, tripId),
    listTripWaiverStatuses(db, shopId, tripId),
    getCurrentWaiverTemplate(db, shopId),
    db.select({ timezone: shops.timezone }).from(shops).where(eq(shops.id, shopId)).limit(1),
  ]);
  const [shop] = shopRow;
  if (!shop) throw new Error(`listTripReadiness: shop ${shopId} not found`);
  const timezone = shop.timezone;
  const bookingIds = waiverRows.map((row) => row.booking.id);
  const paymentByBooking = await paymentsByBooking(db, shopId, bookingIds);
  const personIds = waiverRows.map((row) => row.person.id);
  const [certificationRows, specialtyRows, nitroxRows, signedWaiversByPerson] =
    personIds.length === 0
      ? [[], [], [], new Map<string, never[]>()]
      : await Promise.all([
          db
            .select()
            .from(certifications)
            .where(
              and(
                eq(certifications.shopId, shopId),
                inArray(certifications.personId, personIds),
                isNull(certifications.deletedAt),
              ),
            ),
          db
            .select()
            .from(specialtyCertifications)
            .where(
              and(
                eq(specialtyCertifications.shopId, shopId),
                inArray(specialtyCertifications.personId, personIds),
                isNull(specialtyCertifications.deletedAt),
              ),
            ),
          db
            .select()
            .from(nitroxCertifications)
            .where(
              and(
                eq(nitroxCertifications.shopId, shopId),
                inArray(nitroxCertifications.personId, personIds),
                isNull(nitroxCertifications.deletedAt),
              ),
            ),
          listSignedWaiversByPerson(db, shopId, personIds),
        ]);
  const currentTemplateVersion = currentTemplate?.version ?? null;
  const certificationsByPerson = new Map<string, typeof certificationRows>();
  for (const certification of certificationRows) {
    const current = certificationsByPerson.get(certification.personId) ?? [];
    current.push(certification);
    certificationsByPerson.set(certification.personId, current);
  }
  const specialtiesByPerson = new Map<string, typeof specialtyRows>();
  for (const specialty of specialtyRows) {
    const current = specialtiesByPerson.get(specialty.personId) ?? [];
    current.push(specialty);
    specialtiesByPerson.set(specialty.personId, current);
  }
  const nitroxByPerson = new Map<string, typeof nitroxRows>();
  for (const card of nitroxRows) {
    const current = nitroxByPerson.get(card.personId) ?? [];
    current.push(card);
    nitroxByPerson.set(card.personId, current);
  }

  return waiverRows.map((row) => {
    // Sign-once: a diver's own signed/in-review record wins; otherwise a current
    // completed release from any of their bookings carries over. This is the one
    // place the rule is applied, so readiness, the roster, the Today queue, the
    // manifest, and the fail-closed boarding gate all agree.
    const effectiveWaiver = effectiveWaiverForBooking({
      bookingWaiver: row.waiver,
      personSignedWaivers: signedWaiversByPerson.get(row.person.id) ?? [],
      currentTemplateVersion,
      now,
    });
    return {
      ...row,
      /** The booking's own current record (where the link was issued). */
      bookingWaiver: row.waiver,
      /** The record that actually governs readiness after the sign-once rule. */
      waiver: effectiveWaiver,
      requirement,
      siteRequirement,
      certifications: certificationsByPerson.get(row.person.id) ?? [],
      specialtyCertifications: specialtiesByPerson.get(row.person.id) ?? [],
      nitroxCertifications: nitroxByPerson.get(row.person.id) ?? [],
      paymentStatus: paymentByBooking.get(row.booking.id)?.status ?? null,
      paymentProvider: paymentByBooking.get(row.booking.id)?.provider ?? null,
      readiness: calculateReadiness({
        requirement,
        siteRequirement,
        waiver: effectiveWaiver,
        certifications: certificationsByPerson.get(row.person.id) ?? [],
        specialtyCertifications: specialtiesByPerson.get(row.person.id) ?? [],
        nitroxCertifications: nitroxByPerson.get(row.person.id) ?? [],
        paymentStatus: paymentByBooking.get(row.booking.id)?.status ?? null,
        identityUnconfirmed: row.booking.identityUnconfirmedAt !== null,
        now,
        timezone,
      }),
    };
  });
}

export async function getBookingReadiness(db: DbExecutor, shopId: string, bookingId: string) {
  const [booking] = await db
    .select({ tripId: bookings.tripId })
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.shopId, shopId)))
    .limit(1);
  if (!booking) return null;
  const readiness = await listTripReadiness(db, shopId, booking.tripId);
  return readiness.find((row) => row.booking.id === bookingId)?.readiness ?? null;
}

export type BookingReadinessDetail = {
  shop: { name: string; timezone: string };
  trip: { id: string; title: string; startsAt: Date; endsAt: Date };
  person: { fullName: string };
  requirement: Awaited<ReturnType<typeof getTripRequirements>>;
  readiness: NonNullable<Awaited<ReturnType<typeof getBookingReadiness>>>;
  cancelled: boolean;
};

/**
 * Everything the no-login diver readiness page needs, keyed only by a booking
 * id (the signed link is the capability, so there is no shop scope to pass).
 * Fails closed to null when the booking, trip, or shop is missing.
 */
export async function getBookingReadinessDetail(
  db: DbExecutor,
  bookingId: string,
): Promise<BookingReadinessDetail | null> {
  const [row] = await db
    .select({
      shopId: bookings.shopId,
      tripId: bookings.tripId,
      status: bookings.status,
      tripTitle: trips.title,
      startsAt: trips.startsAt,
      endsAt: trips.endsAt,
      personName: people.fullName,
      shopName: shops.name,
      timezone: shops.timezone,
    })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(shops, eq(shops.id, bookings.shopId))
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!row) return null;

  const readinessRows = await listTripReadiness(db, row.shopId, row.tripId);
  const match = readinessRows.find((entry) => entry.booking.id === bookingId);
  // A cancelled booking still resolves (so the page can say so plainly) but the
  // readiness engine only knows non-cancelled roster rows; fail closed if it's
  // gone from the roster for any other reason.
  const readiness = match?.readiness ?? unavailableReadiness();
  const requirement = match?.requirement ?? (await getTripRequirements(db, row.shopId, row.tripId));

  return {
    shop: { name: row.shopName, timezone: row.timezone },
    trip: { id: row.tripId, title: row.tripTitle, startsAt: row.startsAt, endsAt: row.endsAt },
    person: { fullName: row.personName },
    requirement,
    readiness,
    cancelled: row.status === "cancelled",
  };
}
