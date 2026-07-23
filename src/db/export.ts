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
import { nowDate } from "@/lib/clock";
import { EXPORT_FILE_NOTES, type ExportBundleInput, type ExportTable } from "@/lib/export";
import type { AppDb } from "./client";
import {
  bookingPayments,
  bookings,
  certificationLevel,
  certifications,
  courses,
  diveSiteCreatures,
  diveSiteMoments,
  diveSites,
  nitroxCertifications,
  orderLineItems,
  orders,
  people,
  personRoles,
  rentalFitProfiles,
  rollCallEvents,
  shops,
  specialtyCertifications,
  tripAssignments,
  tripDives,
  tripRequirements,
  tripSeries,
  trips,
  tripWaitlistEntries,
  userAccounts,
  waiverRecords,
  waiverTemplates,
} from "./schema";

/**
 * "Best card" for the flat contacts file: current cards before expired ones,
 * verified evidence before pending claims, then the highest rung — a shop
 * leaving with this file should hand its next system the strongest honest
 * claim per diver. An expired card is history, not evidence, so it only
 * represents a diver who has nothing current — and the expiry column travels
 * in contacts.csv so the destination can enforce it either way.
 */
function bestCertification<
  Card extends {
    level: (typeof certificationLevel.enumValues)[number];
    status: string;
    expiresAt: Date | null;
  },
>(cards: Card[], now: Date): Card | undefined {
  const rank = (card: Card) =>
    (card.expiresAt && card.expiresAt <= now ? 0 : 2000) +
    (card.status === "verified" ? 1000 : 0) +
    certificationLevel.enumValues.indexOf(card.level);
  return cards.reduce<Card | undefined>(
    (best, card) => (!best || rank(card) > rank(best) ? card : best),
    undefined,
  );
}

/** Best-effort first/last split for import wizards; full_name stays authoritative. */
function splitName(fullName: string): { first: string; last: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return { first: fullName.trim(), last: "" };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

export async function loadShopExportBundleInput(
  db: AppDb,
  shopId: string,
  now: Date = nowDate(),
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
        .select()
        .from(diveSites)
        .where(eq(diveSites.shopId, shopId))
        .orderBy(asc(diveSites.createdAt), asc(diveSites.id));
      const siteName = new Map(siteRows.map((row) => [row.id, row.name]));

      const creatureRows = await tx
        .select()
        .from(diveSiteCreatures)
        .where(eq(diveSiteCreatures.shopId, shopId))
        .orderBy(asc(diveSiteCreatures.diveSiteId), asc(diveSiteCreatures.id));

      const momentRows = await tx
        .select()
        .from(diveSiteMoments)
        .where(eq(diveSiteMoments.shopId, shopId))
        .orderBy(asc(diveSiteMoments.createdAt), asc(diveSiteMoments.id));

      const courseRows = await tx
        .select()
        .from(courses)
        .where(eq(courses.shopId, shopId))
        .orderBy(asc(courses.createdAt), asc(courses.id));

      const seriesRows = await tx
        .select()
        .from(tripSeries)
        .where(eq(tripSeries.shopId, shopId))
        .orderBy(asc(tripSeries.createdAt), asc(tripSeries.id));

      const waitlistRows = await tx
        .select()
        .from(tripWaitlistEntries)
        .where(eq(tripWaitlistEntries.shopId, shopId))
        .orderBy(asc(tripWaitlistEntries.createdAt), asc(tripWaitlistEntries.id));

      const orderRows = await tx
        .select()
        .from(orders)
        .where(eq(orders.shopId, shopId))
        .orderBy(asc(orders.createdAt), asc(orders.id));

      const orderLineRows = await tx
        .select()
        .from(orderLineItems)
        .where(eq(orderLineItems.shopId, shopId))
        .orderBy(
          asc(orderLineItems.orderId),
          asc(orderLineItems.createdAt),
          asc(orderLineItems.id),
        );

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

      // Per-person rollups for contacts.csv. Archived cards never represent a
      // diver in a migration file; archived people still export, marked.
      const cardsByPerson = new Map<string, typeof certificationRows>();
      for (const card of certificationRows) {
        if (card.deletedAt) continue;
        cardsByPerson.set(card.personId, [...(cardsByPerson.get(card.personId) ?? []), card]);
      }
      const nitroxVerified = new Set(
        nitroxRows
          .filter((card) => card.status === "verified" && !card.deletedAt)
          .map((card) => card.personId),
      );
      const fitByPerson = new Map(rentalFitRows.map((row) => [row.personId, row]));

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
          file: "contacts.csv",
          header: [
            "first_name",
            "last_name",
            "full_name",
            "email",
            "phone",
            "roles",
            "emergency_contact_name",
            "emergency_contact_phone",
            "certification_agency",
            "certification_level",
            "certification_number",
            "certification_status",
            "certification_expires_at",
            "nitrox_certified",
            "bcd_size",
            "wetsuit_size",
            "boot_size",
            "fin_size",
            "archived_at",
            "created_at",
          ],
          rows: peopleRows.map((row) => {
            const name = splitName(row.fullName);
            const card = bestCertification(cardsByPerson.get(row.id) ?? [], now);
            const fit = fitByPerson.get(row.id);
            return [
              name.first,
              name.last,
              row.fullName,
              row.email,
              row.phone,
              personRolesText(row.id),
              row.emergencyContactName,
              row.emergencyContactPhone,
              card?.agency,
              card?.level,
              card?.identifier,
              card?.status,
              card?.expiresAt,
              nitroxVerified.has(row.id),
              fit?.bcdSize,
              fit?.wetsuitSize,
              fit?.bootSize,
              fit?.finSize,
              row.deletedAt,
              row.createdAt,
            ];
          }),
          note: EXPORT_FILE_NOTES["contacts.csv"],
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
          file: "trip_series.csv",
          header: ["id", "title", "frequency", "interval_weeks", "occurrence_count", "created_at"],
          rows: seriesRows.map((row) => [
            row.id,
            row.title,
            row.frequency,
            row.intervalWeeks,
            row.occurrenceCount,
            row.createdAt,
          ]),
          note: EXPORT_FILE_NOTES["trip_series.csv"],
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
          file: "waitlist_entries.csv",
          header: [
            "id",
            "trip_id",
            "trip_title",
            "trip_starts_at",
            "person_id",
            "person_name",
            "invited_at",
            "created_at",
          ],
          rows: waitlistRows.map((row) => [
            row.id,
            row.tripId,
            tripTitle.get(row.tripId),
            tripStartsAt.get(row.tripId),
            row.personId,
            personName.get(row.personId),
            row.invitedAt,
            row.createdAt,
          ]),
          note: EXPORT_FILE_NOTES["waitlist_entries.csv"],
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
        {
          file: "orders.csv",
          header: [
            "id",
            "person_id",
            "person_name",
            "booking_id",
            "created_by_person_id",
            "created_by_name",
            "status",
            "currency",
            "total_cents",
            "amount_paid_cents",
            "description",
            "stripe_invoice_id",
            "hosted_invoice_url",
            "invoice_pdf_url",
            "finalized_at",
            "paid_at",
            "voided_at",
            "refunded_at",
            "created_at",
          ],
          rows: orderRows.map((row) => [
            row.id,
            row.personId,
            personName.get(row.personId),
            row.bookingId,
            row.createdByPersonId,
            personName.get(row.createdByPersonId),
            row.status,
            row.currency,
            row.totalCents,
            row.amountPaidCents,
            row.description,
            row.stripeInvoiceId,
            row.hostedInvoiceUrl,
            row.invoicePdfUrl,
            row.finalizedAt,
            row.paidAt,
            row.voidedAt,
            row.refundedAt,
            row.createdAt,
          ]),
          note: EXPORT_FILE_NOTES["orders.csv"],
        },
        {
          file: "order_line_items.csv",
          header: [
            "order_id",
            "kind",
            "description",
            "quantity",
            "unit_amount_cents",
            "created_at",
          ],
          rows: orderLineRows.map((row) => [
            row.orderId,
            row.kind,
            row.description,
            row.quantity,
            row.unitAmountCents,
            row.createdAt,
          ]),
          note: EXPORT_FILE_NOTES["order_line_items.csv"],
        },
        {
          file: "dive_sites.csv",
          header: [
            "id",
            "name",
            "location_name",
            "description",
            "difficulty",
            "depth_range",
            "current_note",
            "dive_plan",
            "marine_life",
            "marine_life_description",
            "landmarks",
            "minimum_certification_level",
            "required_specialties",
            "requires_nitrox",
            "forecast_latitude",
            "forecast_longitude",
            "satellite_image_url",
            "route_image_url",
            "image_urls",
            "deleted_at",
            "created_at",
          ],
          rows: siteRows.map((row) => [
            row.id,
            row.name,
            row.locationName,
            row.description,
            row.difficulty,
            row.depthRange,
            row.currentNote,
            row.divePlan,
            row.marineLife,
            row.marineLifeDescription,
            JSON.stringify(row.landmarks),
            row.minimumCertificationLevel,
            row.requiredSpecialties.join("; "),
            row.requiresNitrox,
            row.forecastLatitude,
            row.forecastLongitude,
            row.satelliteImageUrl,
            row.routeImageUrl,
            JSON.stringify(row.imageUrls),
            row.deletedAt,
            row.createdAt,
          ]),
          note: EXPORT_FILE_NOTES["dive_sites.csv"],
        },
        {
          file: "dive_site_creatures.csv",
          header: [
            "id",
            "dive_site_id",
            "dive_site_name",
            "name",
            "kind",
            "description",
            "preparation_tip",
            "image_url",
          ],
          rows: creatureRows.map((row) => [
            row.id,
            row.diveSiteId,
            siteName.get(row.diveSiteId),
            row.name,
            row.kind,
            row.description,
            row.preparationTip,
            row.imageUrl,
          ]),
          note: EXPORT_FILE_NOTES["dive_site_creatures.csv"],
        },
        {
          file: "dive_site_moments.csv",
          header: [
            "id",
            "dive_site_id",
            "dive_site_name",
            "caption",
            "is_published",
            "image_url",
            "created_at",
          ],
          rows: momentRows.map((row) => [
            row.id,
            row.diveSiteId,
            siteName.get(row.diveSiteId),
            row.caption,
            row.isPublished,
            row.imageUrl,
            row.createdAt,
          ]),
          note: EXPORT_FILE_NOTES["dive_site_moments.csv"],
        },
        {
          file: "courses.csv",
          header: [
            "id",
            "title",
            "agency",
            "slug",
            "description",
            "summary",
            "overview",
            "price_cents",
            "e_learning_price_cents",
            "minimum_certification_level",
            "minimum_age",
            "duration_text",
            "group_size_text",
            "prerequisite_note",
            "includes",
            "excludes",
            "schedule_days",
            "faqs",
            "hero_image_url",
            "image_urls",
            "is_active",
            "created_at",
          ],
          rows: courseRows.map((row) => [
            row.id,
            row.title,
            row.agency,
            row.slug,
            row.description,
            row.summary,
            row.overview,
            row.priceCents,
            row.eLearningPriceCents,
            row.minimumCertificationLevel,
            row.minimumAge,
            row.durationText,
            row.groupSizeText,
            row.prerequisiteNote,
            JSON.stringify(row.includes),
            JSON.stringify(row.excludes),
            JSON.stringify(row.scheduleDays),
            JSON.stringify(row.faqs),
            row.heroImageUrl,
            JSON.stringify(row.imageUrls),
            row.isActive,
            row.createdAt,
          ]),
          note: EXPORT_FILE_NOTES["courses.csv"],
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
  const peopleCount = await countOf(
    db.select({ n: count() }).from(people).where(eq(people.shopId, shopId)),
  );
  const counts: Record<keyof typeof EXPORT_FILE_NOTES, number> = {
    "shop.csv": 1,
    // One flat import-ready row per person, so the count mirrors people.csv.
    "contacts.csv": peopleCount,
    "people.csv": peopleCount,
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
    "trip_series.csv": await countOf(
      db.select({ n: count() }).from(tripSeries).where(eq(tripSeries.shopId, shopId)),
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
    "waitlist_entries.csv": await countOf(
      db
        .select({ n: count() })
        .from(tripWaitlistEntries)
        .where(eq(tripWaitlistEntries.shopId, shopId)),
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
    "orders.csv": await countOf(
      db.select({ n: count() }).from(orders).where(eq(orders.shopId, shopId)),
    ),
    "order_line_items.csv": await countOf(
      db.select({ n: count() }).from(orderLineItems).where(eq(orderLineItems.shopId, shopId)),
    ),
    "dive_sites.csv": await countOf(
      db.select({ n: count() }).from(diveSites).where(eq(diveSites.shopId, shopId)),
    ),
    "dive_site_creatures.csv": await countOf(
      db.select({ n: count() }).from(diveSiteCreatures).where(eq(diveSiteCreatures.shopId, shopId)),
    ),
    "dive_site_moments.csv": await countOf(
      db.select({ n: count() }).from(diveSiteMoments).where(eq(diveSiteMoments.shopId, shopId)),
    ),
    "courses.csv": await countOf(
      db.select({ n: count() }).from(courses).where(eq(courses.shopId, shopId)),
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
