import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { type CalendarDate, calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { checkDepthCeiling, diverDepthLimit } from "@/lib/depth-ceiling";
import type { CertificationLevel, SiteCertRequirement } from "@/lib/readiness";
import {
  BLOCKER_CATEGORY,
  calculateReadiness,
  combineSiteRequirements,
  higherCertificationLevel,
  unavailableReadiness,
  validVerifiedCertification,
} from "@/lib/readiness";
import { effectiveWaiverForBooking } from "@/lib/waivers";
import { type AppDb, type DbExecutor, isUniqueConstraintViolation } from "./client";
import { paymentsByBooking } from "./payments";
import type { DiveSpecialty } from "./schema";
import {
  bookings,
  certifications,
  courses,
  diveSites,
  nitroxCertifications,
  people,
  shops,
  specialtyCertifications,
  tripDives,
  tripRequirements,
  trips,
} from "./schema";
import {
  getCurrentWaiverTemplate,
  listSignedWaiversByPerson,
  listTripsWaiverStatuses,
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
 * Every site a trip visits, for the cert gate — its primary site *and* every
 * site on its ordered dives. `trip_dives.dive_site_id` is nullable (a planned
 * dive with no site chosen yet is legal), and the `in (…)` simply never matches
 * those rows.
 *
 * Like `getTripMaxDepthMeters` this deliberately does not filter
 * `dive_sites.deleted_at`: an archived briefing still governs the historical
 * trip it is attached to. The choice is inherited from the depth advisory
 * rather than decided here — change both together or neither.
 */
function tripVisitedSites(db: DbExecutor, shopId: string, tripId: string) {
  return (
    db
      .select({
        tripId: trips.id,
        minimumCertificationLevel: diveSites.minimumCertificationLevel,
        requiredSpecialties: diveSites.requiredSpecialties,
        requiresNitrox: diveSites.requiresNitrox,
      })
      .from(trips)
      .innerJoin(
        diveSites,
        sql`${diveSites.id} = ${trips.diveSiteId} or ${diveSites.id} in (
          select ${tripDives.diveSiteId} from ${tripDives} where ${tripDives.tripId} = ${trips.id}
        )`,
      )
      // `dive_sites.shop_id` as well as the trip's: the join above reaches sites
      // through two paths, so shop ownership is proven on the query rather than
      // assumed from the trip's pointer (the CR-007 house rule).
      .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), eq(diveSites.shopId, shopId)))
  );
}

/**
 * The inherent cert gate of every dive site a trip visits, folded into one
 * requirement (strictest level, union of specialties, OR of nitrox), or null
 * when the trip has no site or no visited site demands anything. Composed with
 * the trip's own requirement by the readiness service — never a standalone gate.
 *
 * Reading only the primary site is how a deep second-dive site never reached
 * the gate: the depth advisory already spanned the whole itinerary, and the
 * cert/specialty/nitrox gate now matches it.
 */
export async function getTripSiteRequirement(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<SiteCertRequirement | null> {
  const rows = await tripVisitedSites(db, shopId, tripId);
  return combineSiteRequirements(rows);
}

/**
 * The deepest recorded site the trip actually visits — its primary site *and*
 * every site on its ordered dives, because a warning that only looked at the
 * first one would go quiet on exactly the two-tank day where dive two is the
 * deep one.
 *
 * Null when no visited site has a depth on file. `max()` over a nullable column
 * ignores nulls in SQL, which is the behavior we want: one unrecorded site does
 * not erase the depth of the site next to it.
 */
export async function getTripMaxDepthMeters(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<number | null> {
  const [row] = await db
    .select({
      maxDepth: sql<number | null>`max(${diveSites.maxDepthMeters})`,
    })
    .from(trips)
    .innerJoin(
      diveSites,
      sql`${diveSites.id} = ${trips.diveSiteId} or ${diveSites.id} in (
        select ${tripDives.diveSiteId} from ${tripDives} where ${tripDives.tripId} = ${trips.id}
      )`,
    )
    // `dive_sites.shop_id` as well as the trip's: the join above reaches sites
    // through two paths, and proving the row belongs to this shop on the query
    // beats relying on the invariant that a trip never points at a foreign
    // site (the CR-007 house rule).
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), eq(diveSites.shopId, shopId)));
  return row?.maxDepth ?? null;
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

/**
 * The highest level on a diver's *verified, unexpired* cards, or null when they
 * hold none the shop has checked.
 *
 * Deliberately ignores pending and expired cards: a suggestion of what to learn
 * next should be built on the same evidence the boarding gate trusts, or the
 * two surfaces will tell a diver different stories about where they stand.
 */
export async function highestVerifiedCertificationLevel(
  db: DbExecutor,
  shopId: string,
  personId: string,
  timezone: string,
  now = nowDate(),
): Promise<CertificationLevel | null> {
  const rows = await db
    .select()
    .from(certifications)
    .where(
      and(
        eq(certifications.shopId, shopId),
        eq(certifications.personId, personId),
        isNull(certifications.deletedAt),
      ),
    );
  const todayLocal = calendarDateInTimezone(now, timezone);
  let highest: CertificationLevel | null = null;
  for (const certification of rows) {
    if (!validVerifiedCertification(certification, todayLocal)) continue;
    highest = higherCertificationLevel(highest, certification.level);
  }
  return highest;
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

/**
 * Why a review was refused, so a caller can say something specific.
 * `card_sighting_required` is the imported-card case below.
 */
export type ReviewRefusal = "not_found" | "card_sighting_required";

/**
 * Confirming an **imported** specialty card is the tap that opens a specialty
 * gate — depth past 18 m for Deep — on the strength of a spreadsheet cell that
 * DiveDay itself never checked. So it is the one review that requires the staffer
 * to state what they are asserting (`cardSighted`), the same shape as the paper
 * waiver's medical attestation (`recordInPersonWaiver`): a bare button that opens
 * a safety gate while asserting nothing is where this posture's value leaks away
 * (`dive-domain-expert` review, H-24).
 *
 * A card captured by this shop (`importedAt` null) is unaffected — "Mark
 * certified" already means a staffer looked the number up with the agency, and
 * adding a second checkbox to it would be friction with no claim behind it.
 * The attestation is recorded in `reviewNote` so the audit trail says what was
 * asserted and not merely that a click happened.
 */
export async function reviewSpecialtyCertification(
  db: AppDb,
  input: {
    shopId: string;
    certificationId: string;
    status: "verified";
    reviewNote?: string;
    /** The staffer asserts they have seen the card, or checked it with the agency. */
    cardSighted?: boolean;
  },
): Promise<
  | { ok: true; certification: typeof specialtyCertifications.$inferSelect }
  | { ok: false; reason: ReviewRefusal }
> {
  const [existing] = await db
    .select({ importedAt: specialtyCertifications.importedAt })
    .from(specialtyCertifications)
    .where(
      and(
        eq(specialtyCertifications.id, input.certificationId),
        eq(specialtyCertifications.shopId, input.shopId),
        isNull(specialtyCertifications.deletedAt),
      ),
    )
    .limit(1);
  if (!existing) return { ok: false, reason: "not_found" };
  if (existing.importedAt && !input.cardSighted) {
    return { ok: false, reason: "card_sighting_required" };
  }

  const [certification] = await db
    .update(specialtyCertifications)
    .set({
      status: input.status,
      reviewNote: reviewNoteFor(
        input.reviewNote,
        Boolean(existing.importedAt && input.cardSighted),
      ),
      reviewedAt: nowDate(),
    })
    .where(
      and(
        eq(specialtyCertifications.id, input.certificationId),
        eq(specialtyCertifications.shopId, input.shopId),
        // Never re-verify an archived card: this is the mutation that opens a
        // specialty (depth) gate, and an archived card is out of every readiness
        // read by design (`security-reviewer` finding).
        isNull(specialtyCertifications.deletedAt),
      ),
    )
    .returning();
  return certification ? { ok: true, certification } : { ok: false, reason: "not_found" };
}

/** What the staffer asserted, kept on the row rather than only in their memory. */
export const CARD_SIGHTING_NOTE =
  "Staff confirmed an imported card: seen in person, or the number checked with the issuing agency.";

export function reviewNoteFor(note: string | undefined, attested: boolean): string | null {
  const own = note?.trim();
  if (!attested) return own || null;
  return own ? `${CARD_SIGHTING_NOTE} ${own}` : CARD_SIGHTING_NOTE;
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
  const [
    requirement,
    siteRequirement,
    waiverRows,
    currentTemplate,
    shopRow,
    courseRow,
    tripMaxDepthMeters,
  ] = await Promise.all([
    getTripRequirements(db, shopId, tripId),
    getTripSiteRequirement(db, shopId, tripId),
    listTripWaiverStatuses(db, shopId, tripId),
    getCurrentWaiverTemplate(db, shopId),
    db
      .select({ timezone: shops.timezone, depthUnit: shops.depthUnit })
      .from(shops)
      .where(eq(shops.id, shopId))
      .limit(1),
    // The course's stated minimum age and the day this session runs — age is
    // measured on the course date, not today (H-08).
    db
      .select({ startsAt: trips.startsAt, minimumAge: courses.minimumAge })
      .from(trips)
      .leftJoin(courses, eq(courses.id, trips.courseId))
      .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId)))
      .limit(1),
    getTripMaxDepthMeters(db, shopId, tripId),
  ]);
  const [shop] = shopRow;
  if (!shop) throw new Error(`listTripReadiness: shop ${shopId} not found`);
  const timezone = shop.timezone;
  const depthUnit = shop.depthUnit;
  const courseMinimumAge = courseRow[0]?.minimumAge ?? null;
  // The trip's own shop-local calendar date. `courses` is left-joined, so this
  // is set for every trip, not only course sessions — the minimum-age gate reads
  // it as "the course date", while age, birthdays, and junior depth bands read
  // it as "the day they are in the water". Same date, three questions.
  const tripDate = courseRow[0]?.startsAt
    ? calendarDateInTimezone(courseRow[0].startsAt, timezone)
    : null;
  const courseDate = tripDate;
  // Card validity is asked about *today* (is this card expired right now?),
  // which is a different question from the trip date the junior band is
  // measured on — a card expiring next week is valid today and invalid on a
  // trip a fortnight out.
  const todayLocal = calendarDateInTimezone(now, timezone);
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
    const readiness = calculateReadiness({
      requirement,
      siteRequirement,
      waiver: effectiveWaiver,
      certifications: certificationsByPerson.get(row.person.id) ?? [],
      specialtyCertifications: specialtiesByPerson.get(row.person.id) ?? [],
      nitroxCertifications: nitroxByPerson.get(row.person.id) ?? [],
      paymentStatus: paymentByBooking.get(row.booking.id)?.status ?? null,
      identityUnconfirmed: row.booking.identityUnconfirmedAt !== null,
      courseMinimumAge,
      courseDate,
      dateOfBirth: row.person.dateOfBirth,
      now,
      timezone,
    });

    const depthLimit = diverDepthLimit(
      certificationsByPerson.get(row.person.id) ?? [],
      specialtiesByPerson.get(row.person.id) ?? [],
      todayLocal,
      row.person.dateOfBirth,
      tripDate,
    );
    // An uncertified diver falls to the entry-level ceiling rather than to
    // silence — on a trip with no `minimum_certification_level` (a DSD session,
    // an all-levels charter) nothing else says a word about them. But when a
    // certification blocker *is* already raised, the depth line would only
    // repeat it, so it is suppressed: the "no redundant warning" argument holds
    // exactly where a redundant warning actually exists.
    const certificationBlocked =
      depthLimit.basis === "no_card" &&
      readiness.blockers.some((blocker) => BLOCKER_CATEGORY[blocker.code] === "certification");

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
      /**
       * Whether the deepest site on this trip goes past what this diver's card
       * (and junior age band) is trained for — H-08, decided as a **warning,
       * not a block**. Deliberately a sibling of `readiness` rather than a
       * blocker inside it: an instructor may keep a diver shallower than the
       * site's maximum, so this must never be able to flip a `ready` diver to
       * `blocked`. Nothing downstream treats it as a gate.
       */
      depthAdvisory: certificationBlocked
        ? ({ status: "unknown" } as const)
        : checkDepthCeiling(tripMaxDepthMeters, depthLimit, depthUnit),
      readiness,
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

export async function listTripsReadiness(
  db: DbExecutor,
  shopId: string,
  tripIds: string[],
  now: Date = nowDate(),
) {
  if (tripIds.length === 0) return [];

  const [requirements, siteRequirements, waiverRows, currentTemplate, shopRow, courseRows] =
    await Promise.all([
      db
        .select()
        .from(tripRequirements)
        .where(and(eq(tripRequirements.shopId, shopId), inArray(tripRequirements.tripId, tripIds))),
      // Every site every trip visits — see `tripVisitedSites` for why the join
      // reaches through `trip_dives` too, and why `dive_sites.shop_id` is
      // re-proven here.
      db
        .select({
          tripId: trips.id,
          minimumCertificationLevel: diveSites.minimumCertificationLevel,
          requiredSpecialties: diveSites.requiredSpecialties,
          requiresNitrox: diveSites.requiresNitrox,
        })
        .from(trips)
        .innerJoin(
          diveSites,
          sql`${diveSites.id} = ${trips.diveSiteId} or ${diveSites.id} in (
            select ${tripDives.diveSiteId} from ${tripDives} where ${tripDives.tripId} = ${trips.id}
          )`,
        )
        .where(
          and(inArray(trips.id, tripIds), eq(trips.shopId, shopId), eq(diveSites.shopId, shopId)),
        ),
      listTripsWaiverStatuses(db, shopId, tripIds),
      getCurrentWaiverTemplate(db, shopId),
      db.select({ timezone: shops.timezone }).from(shops).where(eq(shops.id, shopId)).limit(1),
      db
        .select({ id: trips.id, startsAt: trips.startsAt, minimumAge: courses.minimumAge })
        .from(trips)
        .leftJoin(courses, eq(courses.id, trips.courseId))
        .where(and(inArray(trips.id, tripIds), eq(trips.shopId, shopId))),
    ]);

  const [shop] = shopRow;
  if (!shop) throw new Error(`listTripsReadiness: shop ${shopId} not found`);
  const timezone = shop.timezone;

  const requirementsByTrip = new Map(requirements.map((r) => [r.tripId, r]));
  // A fold, not `new Map(rows.map(...))`: the join returns one row per site a
  // trip visits, so building the map by construction would be last-write-wins
  // and would silently drop every site but one.
  const siteRowsByTrip = new Map<string, SiteCertRequirement[]>();
  for (const sr of siteRequirements) {
    const current = siteRowsByTrip.get(sr.tripId) ?? [];
    current.push({
      minimumCertificationLevel: sr.minimumCertificationLevel,
      requiredSpecialties: sr.requiredSpecialties,
      requiresNitrox: sr.requiresNitrox,
    });
    siteRowsByTrip.set(sr.tripId, current);
  }
  const siteRequirementsByTrip = new Map<string, SiteCertRequirement | null>(
    [...siteRowsByTrip].map(([tripId, sites]) => [tripId, combineSiteRequirements(sites)]),
  );
  const courseByTrip = new Map(courseRows.map((c) => [c.id, c]));

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
    const tripId = row.booking.tripId;
    const requirement = requirementsByTrip.get(tripId) ?? null;
    const siteRequirement = siteRequirementsByTrip.get(tripId) ?? null;
    const courseRow = courseByTrip.get(tripId);
    const courseMinimumAge = courseRow?.minimumAge ?? null;
    const courseDate = courseRow?.startsAt
      ? calendarDateInTimezone(courseRow.startsAt, timezone)
      : null;

    const effectiveWaiver = effectiveWaiverForBooking({
      bookingWaiver: row.waiver,
      personSignedWaivers: signedWaiversByPerson.get(row.person.id) ?? [],
      currentTemplateVersion,
      now,
    });

    return {
      ...row,
      bookingWaiver: row.waiver,
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
        courseMinimumAge,
        courseDate,
        dateOfBirth: row.person.dateOfBirth,
        now,
        timezone,
      }),
    };
  });
}
