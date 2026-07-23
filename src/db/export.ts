/**
 * Loads one shop's full export dataset (ADR 20260722-full-shop-export).
 * Every query is scoped by shopId — the caller passes the session's shop, and
 * nothing here trusts a URL. Soft-archived rows are included on purpose:
 * the bundle is migration-grade history, not a view of the active roster.
 * A schema-coverage test (export.test.ts) forces every schema table to be
 * either exported here or on the deliberate exclusion list.
 */

import { and, asc, count, eq, getTableColumns } from "drizzle-orm";
import { canExportShopData, type Role } from "@/lib/authz";
import { EXPORT_FILE_NOTES, type ExportBundleInput, type ExportTable } from "@/lib/export";
import type { AppDb } from "./client";
import {
  bookingPayments,
  bookings,
  certifications,
  diveSites,
  nitroxCertifications,
  people,
  personRoles,
  rentalFitProfiles,
  rollCallEvents,
  shops,
  specialtyCertifications,
  tripAssignments,
  tripDives,
  tripRequirements,
  trips,
  userAccounts,
  waiverRecords,
  waiverTemplates,
} from "./schema";

export async function loadShopExportBundleInput(
  db: AppDb,
  shopId: string,
): Promise<ExportBundleInput | null> {
  // One read-only repeatable-read transaction: the bundle is a relational
  // snapshot, and per-statement snapshots would let a booking that commits
  // mid-export show up in bookings.csv while its person is missing from
  // people.csv.
  return db.transaction(
    async (tx) => {
      const [shop] = await tx.select().from(shops).where(eq(shops.id, shopId)).limit(1);
      if (!shop) return null;

      const peopleRows = await tx
        .select()
        .from(people)
        .where(eq(people.shopId, shopId))
        .orderBy(asc(people.createdAt), asc(people.id));
      const personName = new Map(peopleRows.map((row) => [row.id, row.fullName]));

      // Joined through people rather than an id list: a long-lived shop's
      // lifetime roster would otherwise blow PostgreSQL's bind-parameter limit.
      const roleRows = await tx
        .select({ personId: personRoles.personId, role: personRoles.role })
        .from(personRoles)
        .innerJoin(people, eq(people.id, personRoles.personId))
        .where(eq(people.shopId, shopId));
      const rolesByPerson = new Map<string, string[]>();
      for (const row of roleRows) {
        const roles = rolesByPerson.get(row.personId) ?? [];
        roles.push(row.role);
        rolesByPerson.set(row.personId, roles);
      }
      const personRolesText = (personId: string) =>
        (rolesByPerson.get(personId) ?? []).sort().join("; ");

      const siteRows = await tx
        .select({ id: diveSites.id, name: diveSites.name })
        .from(diveSites)
        .where(eq(diveSites.shopId, shopId));
      const siteName = new Map(siteRows.map((row) => [row.id, row.name]));

      const tripRows = await tx
        .select()
        .from(trips)
        .where(eq(trips.shopId, shopId))
        .orderBy(asc(trips.startsAt), asc(trips.id));
      const tripTitle = new Map(tripRows.map((row) => [row.id, row.title]));
      const tripStartsAt = new Map(tripRows.map((row) => [row.id, row.startsAt]));

      const tripDiveRows = await tx
        .select(getTableColumns(tripDives))
        .from(tripDives)
        .innerJoin(trips, eq(trips.id, tripDives.tripId))
        .where(eq(trips.shopId, shopId))
        .orderBy(asc(tripDives.tripId), asc(tripDives.diveNumber));

      const requirementRows = await tx
        .select()
        .from(tripRequirements)
        .where(eq(tripRequirements.shopId, shopId));
      const requirementsByTrip = new Map(requirementRows.map((row) => [row.tripId, row]));
      const orderedRequirementRows = tripRows
        .filter((trip) => requirementsByTrip.has(trip.id))
        .map((trip) => requirementsByTrip.get(trip.id));

      const assignmentRows = await tx
        .select(getTableColumns(tripAssignments))
        .from(tripAssignments)
        .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
        .where(eq(trips.shopId, shopId))
        .orderBy(asc(tripAssignments.tripId), asc(tripAssignments.personId));

      const bookingRows = await tx
        .select()
        .from(bookings)
        .where(eq(bookings.shopId, shopId))
        .orderBy(asc(bookings.createdAt), asc(bookings.id));
      const bookingPerson = new Map(bookingRows.map((row) => [row.id, row.personId]));

      const paymentRows = await tx
        .select()
        .from(bookingPayments)
        .where(eq(bookingPayments.shopId, shopId));
      const paymentByBooking = new Map(paymentRows.map((row) => [row.bookingId, row]));

      const rollCallRows = await tx
        .select()
        .from(rollCallEvents)
        .where(eq(rollCallEvents.shopId, shopId))
        .orderBy(asc(rollCallEvents.occurredAt), asc(rollCallEvents.id));

      const certificationRows = await tx
        .select()
        .from(certifications)
        .where(eq(certifications.shopId, shopId))
        .orderBy(asc(certifications.createdAt), asc(certifications.id));

      const specialtyRows = await tx
        .select()
        .from(specialtyCertifications)
        .where(eq(specialtyCertifications.shopId, shopId))
        .orderBy(asc(specialtyCertifications.createdAt), asc(specialtyCertifications.id));

      const nitroxRows = await tx
        .select()
        .from(nitroxCertifications)
        .where(eq(nitroxCertifications.shopId, shopId))
        .orderBy(asc(nitroxCertifications.createdAt), asc(nitroxCertifications.id));

      const templateRows = await tx
        .select()
        .from(waiverTemplates)
        .where(eq(waiverTemplates.shopId, shopId))
        .orderBy(asc(waiverTemplates.title), asc(waiverTemplates.version));

      const waiverRows = await tx
        .select()
        .from(waiverRecords)
        .where(eq(waiverRecords.shopId, shopId))
        .orderBy(asc(waiverRecords.createdAt), asc(waiverRecords.id));

      const rentalFitRows = await tx
        .select()
        .from(rentalFitProfiles)
        .where(eq(rentalFitProfiles.shopId, shopId))
        .orderBy(asc(rentalFitProfiles.createdAt), asc(rentalFitProfiles.id));

      const tables: ExportTable[] = [
        {
          file: "shop.csv",
          header: [
            "name",
            "slug",
            "timezone",
            "medical_jurisdiction",
            "contact_email",
            "contact_phone",
            "dock_call_minutes",
            "packing_list",
            "rental_items",
            "rental_pricing",
            "created_at",
          ],
          rows: [
            [
              shop.name,
              shop.slug,
              shop.timezone,
              shop.jurisdiction,
              shop.contactEmail,
              shop.contactPhone,
              shop.dockCallMinutes,
              JSON.stringify(shop.packingList),
              JSON.stringify(shop.rentalItems),
              JSON.stringify(shop.rentalPricing),
              shop.createdAt,
            ],
          ],
          note: EXPORT_FILE_NOTES["shop.csv"],
        },
        {
          file: "people.csv",
          header: [
            "id",
            "full_name",
            "email",
            "phone",
            "roles",
            "emergency_contact_name",
            "emergency_contact_phone",
            "deleted_at",
            "created_at",
          ],
          rows: peopleRows.map((row) => [
            row.id,
            row.fullName,
            row.email,
            row.phone,
            personRolesText(row.id),
            row.emergencyContactName,
            row.emergencyContactPhone,
            row.deletedAt,
            row.createdAt,
          ]),
          note: EXPORT_FILE_NOTES["people.csv"],
        },
        {
          file: "certifications.csv",
          header: [
            "id",
            "person_id",
            "person_name",
            "agency",
            "level",
            "identifier",
            "status",
            "expires_at",
            "review_note",
            "reviewed_at",
            "card_image_url",
            "deleted_at",
            "created_at",
          ],
          rows: certificationRows.map((row) => [
            row.id,
            row.personId,
            personName.get(row.personId),
            row.agency,
            row.level,
            row.identifier,
            row.status,
            row.expiresAt,
            row.reviewNote,
            row.reviewedAt,
            row.cardImageUrl,
            row.deletedAt,
            row.createdAt,
          ]),
          note: EXPORT_FILE_NOTES["certifications.csv"],
        },
        {
          file: "specialty_certifications.csv",
          header: [
            "id",
            "person_id",
            "person_name",
            "agency",
            "specialty",
            "identifier",
            "status",
            "expires_at",
            "review_note",
            "reviewed_at",
            "card_image_url",
            "deleted_at",
            "created_at",
          ],
          rows: specialtyRows.map((row) => [
            row.id,
            row.personId,
            personName.get(row.personId),
            row.agency,
            row.specialty,
            row.identifier,
            row.status,
            row.expiresAt,
            row.reviewNote,
            row.reviewedAt,
            row.cardImageUrl,
            row.deletedAt,
            row.createdAt,
          ]),
          note: EXPORT_FILE_NOTES["specialty_certifications.csv"],
        },
        {
          file: "nitrox_certifications.csv",
          header: [
            "id",
            "person_id",
            "person_name",
            "agency",
            "identifier",
            "status",
            "review_note",
            "reviewed_at",
            "deleted_at",
            "created_at",
          ],
          rows: nitroxRows.map((row) => [
            row.id,
            row.personId,
            personName.get(row.personId),
            row.agency,
            row.identifier,
            row.status,
            row.reviewNote,
            row.reviewedAt,
            row.deletedAt,
            row.createdAt,
          ]),
          note: EXPORT_FILE_NOTES["nitrox_certifications.csv"],
        },
        {
          file: "trips.csv",
          header: [
            "id",
            "title",
            "status",
            "starts_at",
            "ends_at",
            "capacity",
            "planned_dives",
            "price_cents",
            "deposit_cents",
            "cancellation_window_hours",
            "series_id",
            "course_id",
            "dive_site_id",
            "dive_site_name",
            "conditions_summary",
            "water_temperature_c",
            "visibility_meters",
            "surface_conditions",
            "conditions_updated_at",
            "description",
            "created_at",
          ],
          rows: tripRows.map((row) => [
            row.id,
            row.title,
            row.status,
            row.startsAt,
            row.endsAt,
            row.capacity,
            row.plannedDives,
            row.priceCents,
            row.depositCents,
            row.cancellationWindowHours,
            row.seriesId,
            row.courseId,
            row.diveSiteId,
            row.diveSiteId ? siteName.get(row.diveSiteId) : null,
            row.conditionsSummary,
            row.waterTemperatureC,
            row.visibilityMeters,
            row.surfaceConditions,
            row.conditionsUpdatedAt,
            row.description,
            row.createdAt,
          ]),
          note: EXPORT_FILE_NOTES["trips.csv"],
        },
        {
          file: "trip_dives.csv",
          header: [
            "trip_id",
            "trip_title",
            "dive_number",
            "title",
            "dive_site_id",
            "dive_site_name",
            "description",
          ],
          rows: tripDiveRows.map((row) => [
            row.tripId,
            tripTitle.get(row.tripId),
            row.diveNumber,
            row.title,
            row.diveSiteId,
            row.diveSiteId ? siteName.get(row.diveSiteId) : null,
            row.description,
          ]),
          note: EXPORT_FILE_NOTES["trip_dives.csv"],
        },
        {
          file: "trip_requirements.csv",
          header: [
            "trip_id",
            "trip_title",
            "trip_starts_at",
            "requires_waiver",
            "minimum_certification_level",
            "required_specialties",
            "requires_nitrox",
            "requires_payment",
            "updated_at",
          ],
          rows: orderedRequirementRows.flatMap((row) =>
            row
              ? [
                  [
                    row.tripId,
                    tripTitle.get(row.tripId),
                    tripStartsAt.get(row.tripId),
                    row.requiresWaiver,
                    row.minimumCertificationLevel,
                    row.requiredSpecialties.join("; "),
                    row.requiresNitrox,
                    row.requiresPayment,
                    row.updatedAt,
                  ],
                ]
              : [],
          ),
          note: EXPORT_FILE_NOTES["trip_requirements.csv"],
        },
        {
          file: "trip_assignments.csv",
          header: ["trip_id", "trip_title", "trip_starts_at", "person_id", "person_name", "roles"],
          rows: assignmentRows.map((row) => [
            row.tripId,
            tripTitle.get(row.tripId),
            tripStartsAt.get(row.tripId),
            row.personId,
            personName.get(row.personId),
            personRolesText(row.personId),
          ]),
          note: EXPORT_FILE_NOTES["trip_assignments.csv"],
        },
        {
          file: "bookings.csv",
          header: [
            "id",
            "trip_id",
            "trip_title",
            "trip_starts_at",
            "person_id",
            "person_name",
            "status",
            "wants_nitrox",
            "buddy_preference",
            "conditions_briefed_at",
            "payment_status",
            "payment_amount_cents",
            "payment_currency",
            "payment_provider",
            "created_at",
          ],
          rows: bookingRows.map((row) => {
            const payment = paymentByBooking.get(row.id);
            return [
              row.id,
              row.tripId,
              tripTitle.get(row.tripId),
              tripStartsAt.get(row.tripId),
              row.personId,
              personName.get(row.personId),
              row.status,
              row.wantsNitrox,
              row.buddyPreference,
              row.conditionsBriefedAt,
              payment?.status ?? "unpaid",
              payment?.amountCents,
              payment?.currency,
              payment?.provider,
              row.createdAt,
            ];
          }),
          note: EXPORT_FILE_NOTES["bookings.csv"],
        },
        {
          file: "roll_call_events.csv",
          header: [
            "id",
            "trip_id",
            "trip_title",
            "trip_starts_at",
            "booking_id",
            "person_id",
            "person_name",
            "status",
            "checkpoint",
            "source",
            "client_event_id",
            "offline_snapshot_saved_at",
            "recorded_by_person_id",
            "recorded_by_name",
            "note",
            "occurred_at",
            "created_at",
          ],
          rows: rollCallRows.map((row) => {
            const personId = bookingPerson.get(row.bookingId);
            return [
              row.id,
              row.tripId,
              tripTitle.get(row.tripId),
              tripStartsAt.get(row.tripId),
              row.bookingId,
              personId,
              personId ? personName.get(personId) : null,
              row.status,
              row.checkpoint,
              row.source,
              row.clientEventId,
              row.offlineSnapshotSavedAt,
              row.recordedByPersonId,
              personName.get(row.recordedByPersonId),
              row.note,
              row.occurredAt,
              row.createdAt,
            ];
          }),
          note: EXPORT_FILE_NOTES["roll_call_events.csv"],
        },
        {
          file: "waiver_templates.csv",
          header: ["id", "title", "version", "archived_at", "created_at", "body"],
          rows: templateRows.map((row) => [
            row.id,
            row.title,
            row.version,
            row.archivedAt,
            row.createdAt,
            row.body,
          ]),
          note: EXPORT_FILE_NOTES["waiver_templates.csv"],
        },
        {
          file: "waiver_records.csv",
          header: [
            "id",
            "person_id",
            "person_name",
            "booking_id",
            "template_id",
            "template_title",
            "template_version",
            "status",
            "signed_name",
            "signature_method",
            "recorded_by_person_id",
            "recorded_by_name",
            "started_at",
            "consented_at",
            "signed_at",
            "completed_at",
            "medical_review_required",
            "medical_answers",
            "superseded_at",
            "expires_at",
            "created_at",
          ],
          rows: waiverRows.map((row) => [
            row.id,
            row.personId,
            personName.get(row.personId),
            row.bookingId,
            row.templateId,
            row.templateTitle,
            row.templateVersion,
            row.status,
            row.signedName,
            row.signatureMethod,
            row.recordedByPersonId,
            row.recordedByPersonId ? personName.get(row.recordedByPersonId) : null,
            row.startedAt,
            row.consentedAt,
            row.signedAt,
            row.completedAt,
            row.medicalReviewRequired,
            row.medicalAnswers ? JSON.stringify(row.medicalAnswers) : null,
            row.supersededAt,
            row.expiresAt,
            row.createdAt,
          ]),
          note: EXPORT_FILE_NOTES["waiver_records.csv"],
        },
        {
          file: "rental_fit.csv",
          header: [
            "person_id",
            "person_name",
            "rents_bcd",
            "rents_regulator",
            "rents_wetsuit",
            "rents_mask_fins",
            "rents_weights",
            "rents_dive_computer",
            "rents_gopro",
            "bcd_size",
            "wetsuit_size",
            "boot_size",
            "fin_size",
            "weight_preference",
            "note",
            "updated_at",
          ],
          rows: rentalFitRows.map((row) => [
            row.personId,
            personName.get(row.personId),
            row.rentsBcd,
            row.rentsRegulator,
            row.rentsWetsuit,
            row.rentsMaskFins,
            row.rentsWeights,
            row.rentsDiveComputer,
            row.rentsGopro,
            row.bcdSize,
            row.wetsuitSize,
            row.bootSize,
            row.finSize,
            row.weightPreference,
            row.note,
            row.updatedAt,
          ]),
          note: EXPORT_FILE_NOTES["rental_fit.csv"],
        },
      ];

      return { shopName: shop.name, shopSlug: shop.slug, timezone: shop.timezone, tables };
    },
    { accessMode: "read only", isolationLevel: "repeatable read" },
  );
}

export type ExportFileCount = { file: string; note: string; count: number };

/**
 * Row counts for the settings page — the same file list as the bundle without
 * materializing a single data row. A sync test asserts this list and the
 * bundle's file list never drift.
 */
export async function loadShopExportCounts(
  db: AppDb,
  shopId: string,
): Promise<ExportFileCount[] | null> {
  const [shop] = await db.select({ id: shops.id }).from(shops).where(eq(shops.id, shopId)).limit(1);
  if (!shop) return null;

  const countOf = async (query: Promise<{ n: number }[]>) => (await query)[0]?.n ?? 0;
  const counts: Record<keyof typeof EXPORT_FILE_NOTES, number> = {
    "shop.csv": 1,
    "people.csv": await countOf(
      db.select({ n: count() }).from(people).where(eq(people.shopId, shopId)),
    ),
    "certifications.csv": await countOf(
      db.select({ n: count() }).from(certifications).where(eq(certifications.shopId, shopId)),
    ),
    "specialty_certifications.csv": await countOf(
      db
        .select({ n: count() })
        .from(specialtyCertifications)
        .where(eq(specialtyCertifications.shopId, shopId)),
    ),
    "nitrox_certifications.csv": await countOf(
      db
        .select({ n: count() })
        .from(nitroxCertifications)
        .where(eq(nitroxCertifications.shopId, shopId)),
    ),
    "trips.csv": await countOf(
      db.select({ n: count() }).from(trips).where(eq(trips.shopId, shopId)),
    ),
    "trip_dives.csv": await countOf(
      db
        .select({ n: count() })
        .from(tripDives)
        .innerJoin(trips, eq(trips.id, tripDives.tripId))
        .where(eq(trips.shopId, shopId)),
    ),
    "trip_requirements.csv": await countOf(
      db.select({ n: count() }).from(tripRequirements).where(eq(tripRequirements.shopId, shopId)),
    ),
    "trip_assignments.csv": await countOf(
      db
        .select({ n: count() })
        .from(tripAssignments)
        .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
        .where(eq(trips.shopId, shopId)),
    ),
    "bookings.csv": await countOf(
      db.select({ n: count() }).from(bookings).where(eq(bookings.shopId, shopId)),
    ),
    "roll_call_events.csv": await countOf(
      db.select({ n: count() }).from(rollCallEvents).where(eq(rollCallEvents.shopId, shopId)),
    ),
    "waiver_templates.csv": await countOf(
      db.select({ n: count() }).from(waiverTemplates).where(eq(waiverTemplates.shopId, shopId)),
    ),
    "waiver_records.csv": await countOf(
      db.select({ n: count() }).from(waiverRecords).where(eq(waiverRecords.shopId, shopId)),
    ),
    "rental_fit.csv": await countOf(
      db.select({ n: count() }).from(rentalFitProfiles).where(eq(rentalFitProfiles.shopId, shopId)),
    ),
  };

  return (Object.keys(EXPORT_FILE_NOTES) as (keyof typeof EXPORT_FILE_NOTES)[]).map((file) => ({
    file,
    note: EXPORT_FILE_NOTES[file],
    count: counts[file],
  }));
}

/**
 * Re-checks export privilege against the database, not the session's JWT:
 * roles are copied into the stateless token at sign-in and can be up to the
 * token's lifetime stale, so a demoted or disabled manager could otherwise
 * keep downloading the roster's medical evidence. Requires a live person in
 * this shop, an active login, and a current owner/manager role.
 */
export async function canPersonExportShopData(
  db: AppDb,
  shopId: string,
  personId: string,
): Promise<boolean> {
  const [person] = await db
    .select({ id: people.id, deletedAt: people.deletedAt })
    .from(people)
    .where(and(eq(people.id, personId), eq(people.shopId, shopId)))
    .limit(1);
  if (!person || person.deletedAt) return false;

  const [account] = await db
    .select({ status: userAccounts.status })
    .from(userAccounts)
    .where(eq(userAccounts.personId, personId))
    .limit(1);
  if (account?.status !== "active") return false;

  const roleRows = await db
    .select({ role: personRoles.role })
    .from(personRoles)
    .where(eq(personRoles.personId, personId));
  return canExportShopData(roleRows.map((row) => row.role as Role));
}
