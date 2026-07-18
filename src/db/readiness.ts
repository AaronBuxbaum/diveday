import { and, asc, eq, inArray } from "drizzle-orm";
import type { CertVerificationProvider, CertVerificationResult } from "@/lib/cert-verification";
import { verifyCard } from "@/lib/cert-verification";
import type { SiteCertRequirement } from "@/lib/readiness";
import { calculateReadiness } from "@/lib/readiness";
import type { AppDb, DbExecutor } from "./client";
import type { DiveSpecialty } from "./schema";
import {
  bookings,
  certifications,
  diveSites,
  nitroxCertifications,
  people,
  personRoles,
  specialtyCertifications,
  tripRequirements,
  trips,
} from "./schema";
import { listTripWaiverStatuses } from "./waivers";

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
        updatedAt: new Date(),
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

const AGENCY_NAMES: Record<string, string> = {
  padi: "PADI",
  ssi: "SSI",
  naui: "NAUI",
  sdi: "SDI",
  tdi: "TDI",
  other: "the agency",
};

/**
 * Check a certification against its issuing agency and apply the result. A
 * confirmed match verifies the card (recording the source); anything else is
 * assistive only — the card stays pending with a note, never auto-cleared or
 * auto-rejected. Fails closed to `unavailable`.
 */
export async function verifyCertificationWithAgency(
  db: AppDb,
  shopId: string,
  certificationId: string,
  provider?: CertVerificationProvider,
): Promise<CertVerificationResult["status"] | null> {
  const [row] = await db
    .select({ certification: certifications, person: people })
    .from(certifications)
    .innerJoin(people, eq(people.id, certifications.personId))
    .where(and(eq(certifications.id, certificationId), eq(certifications.shopId, shopId)))
    .limit(1);
  if (!row) return null;
  const { certification, person } = row;

  const result = await verifyCard(
    {
      agency: certification.agency,
      level: certification.level,
      identifier: certification.identifier,
      holderName: person.fullName,
    },
    provider,
  );

  const agencyName = AGENCY_NAMES[certification.agency] ?? certification.agency;
  if (result.status === "verified") {
    await db
      .update(certifications)
      .set({
        status: "verified",
        reviewNote: `Confirmed via ${agencyName} verification${result.reference ? ` (ref ${result.reference})` : ""}`,
        reviewedAt: new Date(),
      })
      .where(and(eq(certifications.id, certificationId), eq(certifications.shopId, shopId)));
  } else if (result.status === "not_found" || result.status === "mismatch") {
    // Assistive only: warn, do not auto-reject a possibly-valid card.
    const note =
      result.status === "not_found"
        ? `${agencyName} verification could not find this card. Review manually.`
        : `${agencyName} verification returned a mismatch. Review manually.`;
    await db
      .update(certifications)
      .set({ reviewNote: note })
      .where(and(eq(certifications.id, certificationId), eq(certifications.shopId, shopId)));
  }
  return result.status;
}

export type NewSpecialtyCertification = {
  shopId: string;
  personId: string;
  agency: "padi" | "ssi" | "naui" | "sdi" | "tdi" | "other";
  specialty: DiveSpecialty;
  identifier: string;
  expiresAt?: Date;
  cardImageUrl?: string;
};

/** Same capture→verify contract as a level card: evidence starts pending. */
export async function createSpecialtyCertification(db: AppDb, input: NewSpecialtyCertification) {
  const [person] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.id, input.personId), eq(people.shopId, input.shopId)))
    .limit(1);
  if (!person) return null;
  const [certification] = await db
    .insert(specialtyCertifications)
    .values({
      ...input,
      identifier: input.identifier.trim(),
      cardImageUrl: input.cardImageUrl?.trim() || null,
    })
    .returning();
  return certification ?? null;
}

export async function reviewSpecialtyCertification(
  db: AppDb,
  input: {
    shopId: string;
    certificationId: string;
    status: "verified" | "rejected";
    reviewNote?: string;
  },
) {
  const [certification] = await db
    .update(specialtyCertifications)
    .set({
      status: input.status,
      reviewNote: input.reviewNote?.trim() || null,
      reviewedAt: new Date(),
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

export async function listShopSpecialtyCertifications(db: AppDb, shopId: string) {
  return db
    .select({ certification: specialtyCertifications, person: people })
    .from(specialtyCertifications)
    .innerJoin(people, eq(people.id, specialtyCertifications.personId))
    .where(eq(specialtyCertifications.shopId, shopId))
    .orderBy(asc(people.fullName), asc(specialtyCertifications.createdAt));
}

/** Customers are the people whose card evidence can be collected for a trip. */
export async function listShopDivers(db: AppDb, shopId: string) {
  return db
    .select({ id: people.id, fullName: people.fullName, email: people.email })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shopId), eq(personRoles.role, "diver")))
    .orderBy(asc(people.fullName));
}

/** The exact same result drives staff rosters today and diver/manifest views later. */
export async function listTripReadiness(db: DbExecutor, shopId: string, tripId: string) {
  const [requirement, siteRequirement, waiverRows] = await Promise.all([
    getTripRequirements(db, shopId, tripId),
    getTripSiteRequirement(db, shopId, tripId),
    listTripWaiverStatuses(db, shopId, tripId),
  ]);
  const personIds = waiverRows.map((row) => row.person.id);
  const [certificationRows, specialtyRows, nitroxRows] =
    personIds.length === 0
      ? [[], [], []]
      : await Promise.all([
          db
            .select()
            .from(certifications)
            .where(
              and(eq(certifications.shopId, shopId), inArray(certifications.personId, personIds)),
            ),
          db
            .select()
            .from(specialtyCertifications)
            .where(
              and(
                eq(specialtyCertifications.shopId, shopId),
                inArray(specialtyCertifications.personId, personIds),
              ),
            ),
          db
            .select()
            .from(nitroxCertifications)
            .where(
              and(
                eq(nitroxCertifications.shopId, shopId),
                inArray(nitroxCertifications.personId, personIds),
              ),
            ),
        ]);
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

  return waiverRows.map((row) => ({
    ...row,
    requirement,
    siteRequirement,
    certifications: certificationsByPerson.get(row.person.id) ?? [],
    specialtyCertifications: specialtiesByPerson.get(row.person.id) ?? [],
    nitroxCertifications: nitroxByPerson.get(row.person.id) ?? [],
    readiness: calculateReadiness({
      requirement,
      siteRequirement,
      waiver: row.waiver,
      certifications: certificationsByPerson.get(row.person.id) ?? [],
      specialtyCertifications: specialtiesByPerson.get(row.person.id) ?? [],
      nitroxCertifications: nitroxByPerson.get(row.person.id) ?? [],
    }),
  }));
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
