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
import {
  type CalendarDate,
  calendarDateInTimezone,
  isCalendarDateExpired,
} from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { EXPORT_FILE_NOTES, type ExportBundleInput, type ExportTable } from "@/lib/export";
import type { AppDb } from "./client";
import {
  bookingPaymentEvents,
  bookingPayments,
  bookings,
  buddyPairMembers,
  certificationLevel,
  certifications,
  coursePathSteps,
  coursePaths,
  courses,
  diveSiteCreatures,
  diveSiteMoments,
  diveSites,
  lastMinuteListEntries,
  nitroxCertifications,
  orderLineItems,
  orders,
  people,
  personRoles,
  priorVisits,
  recapPhotos,
  rentalFitProfiles,
  rollCallCrewAttestations,
  rollCallCrewEvents,
  rollCallEvents,
  shopPromoCodes,
  shops,
  specialtyCertifications,
  staffShifts,
  tips,
  tripAssignments,
  tripDives,
  tripLastMinutePromos,
  tripRequirements,
  tripReviews,
  tripScheduleDays,
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
    expiresAt: CalendarDate | null;
  },
>(cards: Card[], todayLocal: CalendarDate): Card | undefined {
  const rank = (card: Card) =>
    (card.expiresAt && isCalendarDateExpired(card.expiresAt, todayLocal) ? 0 : 2000) +
    (card.status === "verified" ? 1000 : 0) +
    certificationLevel.enumValues.indexOf(card.level);
  return cards.reduce<Card | undefined>(
    (best, card) => (!best || rank(card) > rank(best) ? card : best),
    undefined,
  );
}

/**
 * The most recent live (non-superseded) *completed* waiver for the flat
 * contacts file — a diver's round-trippable "has this shop's waiver on
 * file" signal for another DiveDay shop's importer. `medical_review` never
 * counts as accepted here: a live physician-referral hold must never be
 * mistaken for clearance by a downstream import (the importer's own
 * dedup/currency check is a second, independent guard against the same
 * mistake, but the export must not hand out a misleading signal either).
 */
function bestWaiver<
  Record extends {
    status: string;
    supersededAt: Date | null;
    signedAt: Date | null;
    completedAt: Date | null;
  },
>(records: Record[]): Record | undefined {
  const completed = records.filter((r) => r.status === "completed" && !r.supersededAt);
  const at = (r: Record) => (r.signedAt ?? r.completedAt)?.getTime() ?? 0;
  return completed.reduce<Record | undefined>(
    (best, r) => (!best || at(r) > at(best) ? r : best),
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
      const todayLocal = calendarDateInTimezone(now, shop.timezone);

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

      const recapPhotoRows = await tx
        .select()
        .from(recapPhotos)
        .where(eq(recapPhotos.shopId, shopId))
        .orderBy(asc(recapPhotos.createdAt), asc(recapPhotos.id));

      const reviewRows = await tx
        .select({ review: tripReviews, diverName: people.fullName })
        .from(tripReviews)
        .innerJoin(people, eq(people.id, tripReviews.personId))
        .where(eq(tripReviews.shopId, shopId))
        .orderBy(asc(tripReviews.createdAt), asc(tripReviews.id));

      const promoCodeRows = await tx
        .select()
        .from(shopPromoCodes)
        .where(eq(shopPromoCodes.shopId, shopId))
        .orderBy(asc(shopPromoCodes.createdAt), asc(shopPromoCodes.id));

      const courseRows = await tx
        .select()
        .from(courses)
        .where(eq(courses.shopId, shopId))
        .orderBy(asc(courses.createdAt), asc(courses.id));

      const coursePathRows = await tx
        .select()
        .from(coursePaths)
        .where(eq(coursePaths.shopId, shopId))
        .orderBy(asc(coursePaths.createdAt), asc(coursePaths.id));

      // Joined through the owning path so the tenant filter lives on a column
      // the steps table doesn't carry — a step is scoped by its path, not by
      // its own shop_id.
      const coursePathStepRows = await tx
        .select({ step: coursePathSteps })
        .from(coursePathSteps)
        .innerJoin(coursePaths, eq(coursePaths.id, coursePathSteps.pathId))
        .where(eq(coursePaths.shopId, shopId))
        .orderBy(asc(coursePathSteps.pathId), asc(coursePathSteps.position));

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

      const lastMinuteListRows = await tx
        .select()
        .from(lastMinuteListEntries)
        .where(eq(lastMinuteListEntries.shopId, shopId))
        .orderBy(asc(lastMinuteListEntries.createdAt), asc(lastMinuteListEntries.id));

      const lastMinutePromoRows = await tx
        .select()
        .from(tripLastMinutePromos)
        .where(eq(tripLastMinutePromos.shopId, shopId))
        .orderBy(asc(tripLastMinutePromos.createdAt), asc(tripLastMinutePromos.id));

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

      const scheduleDayRows = await tx
        .select()
        .from(tripScheduleDays)
        .innerJoin(trips, eq(trips.id, tripScheduleDays.tripId))
        .where(eq(trips.shopId, shopId))
        .orderBy(asc(tripScheduleDays.tripId), asc(tripScheduleDays.dayNumber));

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

      const staffShiftRows = await tx
        .select()
        .from(staffShifts)
        .innerJoin(people, eq(people.id, staffShifts.personId))
        .where(eq(staffShifts.shopId, shopId))
        .orderBy(asc(staffShifts.startsAt), asc(staffShifts.id));

      const bookingRows = await tx
        .select()
        .from(bookings)
        .where(eq(bookings.shopId, shopId))
        .orderBy(asc(bookings.createdAt), asc(bookings.id));
      const bookingPerson = new Map(bookingRows.map((row) => [row.id, row.personId]));

      const tipRows = await tx
        .select()
        .from(tips)
        .where(eq(tips.shopId, shopId))
        .orderBy(asc(tips.createdAt), asc(tips.id));

      const paymentRows = await tx
        .select()
        .from(bookingPayments)
        .where(eq(bookingPayments.shopId, shopId));
      const paymentByBooking = new Map(paymentRows.map((row) => [row.bookingId, row]));

      // The history behind those current rows. `booking_payments` folds into
      // bookings.csv as one payment_* column set — the state as it stands —
      // and refunds overwrite it in place, so without this file the bundle
      // carries a balance and no story. Oldest first, so a reader replaying
      // the file in order arrives at the folded row.
      const paymentEventRows = await tx
        .select()
        .from(bookingPaymentEvents)
        .where(eq(bookingPaymentEvents.shopId, shopId))
        .orderBy(asc(bookingPaymentEvents.occurredAt), asc(bookingPaymentEvents.id));

      const rollCallRows = await tx
        .select()
        .from(rollCallEvents)
        .where(eq(rollCallEvents.shopId, shopId))
        .orderBy(asc(rollCallEvents.occurredAt), asc(rollCallEvents.id));

      // The crew half of the same head count. Same ordering rule as the events
      // above (oldest first), so a reader replaying the file in order ends on
      // the count that stood.
      const crewAttestationRows = await tx
        .select()
        .from(rollCallCrewAttestations)
        .where(eq(rollCallCrewAttestations.shopId, shopId))
        .orderBy(asc(rollCallCrewAttestations.occurredAt), asc(rollCallCrewAttestations.id));

      // And the per-person half: who, not just how many. Same oldest-first
      // ordering, same append-only replay rule as the diver events.
      const crewRollCallRows = await tx
        .select()
        .from(rollCallCrewEvents)
        .where(eq(rollCallCrewEvents.shopId, shopId))
        .orderBy(asc(rollCallCrewEvents.occurredAt), asc(rollCallCrewEvents.id));

      // Buddy teams standing at export time — not a history: unpairing
      // deletes the rows (ADR 20260804-buddy-pairs).
      const buddyPairRows = await tx
        .select()
        .from(buddyPairMembers)
        .where(eq(buddyPairMembers.shopId, shopId))
        .orderBy(asc(buddyPairMembers.createdAt), asc(buddyPairMembers.pairId));

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

      const priorVisitRows = await tx
        .select()
        .from(priorVisits)
        .where(eq(priorVisits.shopId, shopId))
        .orderBy(asc(priorVisits.visitedOn), asc(priorVisits.id));

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

      const waiversByPerson = new Map<string, typeof waiverRows>();
      for (const record of waiverRows) {
        waiversByPerson.set(record.personId, [
          ...(waiversByPerson.get(record.personId) ?? []),
          record,
        ]);
      }

      // Every image URL any CSV below references, for the photos/ bundle
      // (ADR 20260724-export-bundled-photos). fetchExportPhotos filters this
      // again to DiveDay's own storage — collecting a non-managed URL here is
      // harmless, just never fetched.
      const photoUrls = [
        ...certificationRows.map((row) => row.cardImageUrl),
        ...specialtyRows.map((row) => row.cardImageUrl),
        ...recapPhotoRows.map((row) => row.imageUrl),
        ...siteRows.flatMap((row) => [row.satelliteImageUrl, row.routeImageUrl, ...row.imageUrls]),
        ...creatureRows.map((row) => row.imageUrl),
        ...momentRows.map((row) => row.imageUrl),
        ...courseRows.flatMap((row) => [row.heroImageUrl, ...row.imageUrls]),
        ...waiverRows.flatMap((row) => [
          row.importSourceDocumentUrl,
          row.importSourceMedicalDocumentUrl,
        ]),
      ].filter((url): url is string => Boolean(url));

      const tables: ExportTable[] = [
        {
          file: "shop.csv",
          header: [
            "name",
            "slug",
            "timezone",
            "default_locale",
            // Without this the whole export is ambiguous: every other file's
            // `*_cents` column is a count of *this* currency's minor unit, and
            // a bare 13000 is $130.00 or ¥13,000 depending on it.
            "currency",
            "medical_jurisdiction",
            "depth_unit",
            "temperature_unit",
            "contact_email",
            "contact_phone",
            "address_street",
            "address_locality",
            "address_region",
            "address_postal_code",
            "address_country",
            "dock_call_minutes",
            "review_url",
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
              shop.defaultLocale,
              shop.currency,
              shop.jurisdiction,
              shop.depthUnit,
              shop.temperatureUnit,
              shop.contactEmail,
              shop.contactPhone,
              shop.addressStreet,
              shop.addressLocality,
              shop.addressRegion,
              shop.addressPostalCode,
              shop.addressCountry,
              shop.dockCallMinutes,
              shop.reviewUrl,
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
            "date_of_birth",
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
            "waiver_accepted",
            "waiver_signed_at",
            "waiver_source_name",
            "archived_at",
            "created_at",
          ],
          rows: peopleRows.map((row) => {
            const name = splitName(row.fullName);
            const card = bestCertification(cardsByPerson.get(row.id) ?? [], todayLocal);
            const fit = fitByPerson.get(row.id);
            const waiver = bestWaiver(waiversByPerson.get(row.id) ?? []);
            const waiverSignedAt = waiver
              ? calendarDateInTimezone(
                  waiver.signedAt ?? waiver.completedAt ?? row.createdAt,
                  shop.timezone,
                )
              : null;
            return [
              name.first,
              name.last,
              row.fullName,
              row.email,
              row.phone,
              personRolesText(row.id),
              row.dateOfBirth,
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
              Boolean(waiver),
              waiverSignedAt,
              waiver?.signatureMethod === "imported" ? waiver.importedFromLabel : null,
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
            "date_of_birth",
            "dive_insurance",
            "emergency_contact_name",
            "emergency_contact_phone",
            "courtesy_email_opt_out_at",
            "deleted_at",
            // Erasure travels with the bundle (ADR 20260802-diver-data-erasure).
            // Every identifying column above is already blank for such a row, so
            // without these two the destination system cannot tell a diver who
            // was erased from one whose details were simply never collected —
            // and would happily prompt staff to "complete" the record.
            "anonymized_at",
            "anonymized_by_person_id",
            "created_at",
          ],
          rows: peopleRows.map((row) => [
            row.id,
            row.fullName,
            row.email,
            row.phone,
            personRolesText(row.id),
            row.dateOfBirth,
            row.diveInsurance,
            row.emergencyContactName,
            row.emergencyContactPhone,
            row.courtesyEmailOptOutAt,
            row.deletedAt,
            row.anonymizedAt,
            row.anonymizedByPersonId,
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
            // Provenance from the contact importer (ADR 20260724-import-verified-cards):
            // a non-null imported_at is the definitive "this card was migrated, not
            // carded on sight" marker, permanent even after a staff confirm.
            "imported_at",
            "imported_from_label",
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
            row.importedAt,
            row.importedFromLabel,
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
            "imported_at",
            "imported_from_label",
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
            row.importedAt,
            row.importedFromLabel,
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
            "conditions_hold",
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
            row.conditionsHold,
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
          file: "trip_schedule_days.csv",
          header: ["trip_id", "trip_title", "day_number", "starts_at", "ends_at"],
          rows: scheduleDayRows.map(({ trip_schedule_days: row }) => [
            row.tripId,
            tripTitle.get(row.tripId),
            row.dayNumber,
            row.startsAt,
            row.endsAt,
          ]),
          note: EXPORT_FILE_NOTES["trip_schedule_days.csv"],
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
          header: [
            "trip_id",
            "trip_title",
            "trip_starts_at",
            "person_id",
            "person_name",
            "roles",
            "trip_role",
          ],
          rows: assignmentRows.map((row) => [
            row.tripId,
            tripTitle.get(row.tripId),
            tripStartsAt.get(row.tripId),
            row.personId,
            personName.get(row.personId),
            personRolesText(row.personId),
            row.tripRole,
          ]),
          note: EXPORT_FILE_NOTES["trip_assignments.csv"],
        },
        {
          file: "staff_shifts.csv",
          header: [
            "id",
            "person_id",
            "person_name",
            "starts_at",
            "ends_at",
            "note",
            "created_by_person_id",
            "created_by_name",
            "created_at",
          ],
          rows: staffShiftRows.map(({ staff_shifts: row }) => [
            row.id,
            row.personId,
            personName.get(row.personId),
            row.startsAt,
            row.endsAt,
            row.note,
            row.createdByPersonId,
            row.createdByPersonId ? personName.get(row.createdByPersonId) : null,
            row.createdAt,
          ]),
          note: EXPORT_FILE_NOTES["staff_shifts.csv"],
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
            "conditions_briefed_at",
            "group_preference",
            // The party structure a shop booked (ADR 20260804-seat-claim-links).
            // Both are real records of what happened to a seat, so both travel:
            // `party_lead_booking_id` is a booking id from this same file's `id`
            // column, and `claimed_at` sits alongside `conditions_briefed_at` as
            // another plain fact about the seat. Dropping either would let a shop
            // export a party of six and get back six unrelated singles.
            "party_lead_booking_id",
            "claimed_at",
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
              row.conditionsBriefedAt,
              row.groupPreference,
              row.partyLeadBookingId,
              row.claimedAt,
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
          file: "last_minute_list.csv",
          header: [
            "id",
            "person_id",
            "person_name",
            "available_from",
            "available_until",
            "unsubscribed_at",
            "created_at",
          ],
          rows: lastMinuteListRows.map((row) => [
            row.id,
            row.personId,
            personName.get(row.personId),
            row.availableFrom,
            row.availableUntil,
            row.unsubscribedAt,
            row.createdAt,
          ]),
          note: EXPORT_FILE_NOTES["last_minute_list.csv"],
        },
        {
          file: "trip_last_minute_promos.csv",
          header: [
            "id",
            "trip_id",
            "trip_title",
            "trip_starts_at",
            "status",
            "discount_percent",
            "code",
            "expires_at",
            "recipient_count",
            "created_by_person_id",
            "created_by_name",
            "created_at",
          ],
          rows: lastMinutePromoRows.map((row) => [
            row.id,
            row.tripId,
            tripTitle.get(row.tripId),
            tripStartsAt.get(row.tripId),
            row.status,
            row.discountPercent,
            row.code,
            row.expiresAt,
            row.recipientCount,
            row.createdByPersonId,
            row.createdByPersonId ? personName.get(row.createdByPersonId) : null,
            row.createdAt,
          ]),
          note: EXPORT_FILE_NOTES["trip_last_minute_promos.csv"],
        },
        {
          file: "booking_payment_events.csv",
          header: [
            "id",
            "booking_id",
            "person_id",
            "person_name",
            "status",
            "previous_status",
            "amount_cents",
            "currency",
            "provider",
            "provider_ref",
            "operation",
            "note",
            "occurred_at",
          ],
          rows: paymentEventRows.map((row) => {
            const personId = bookingPerson.get(row.bookingId);
            return [
              row.id,
              row.bookingId,
              personId,
              personId ? personName.get(personId) : null,
              row.status,
              row.previousStatus,
              row.amountCents,
              row.currency,
              row.provider,
              row.providerRef,
              row.operation,
              row.note,
              row.occurredAt,
            ];
          }),
          note: EXPORT_FILE_NOTES["booking_payment_events.csv"],
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
          file: "roll_call_crew_attestations.csv",
          header: [
            "id",
            "trip_id",
            "trip_title",
            "trip_starts_at",
            "checkpoint",
            "crew_aboard",
            "crew_assigned",
            "attested_by_person_id",
            "attested_by_name",
            "note",
            "occurred_at",
            "created_at",
          ],
          rows: crewAttestationRows.map((row) => [
            row.id,
            row.tripId,
            tripTitle.get(row.tripId),
            tripStartsAt.get(row.tripId),
            row.checkpoint,
            row.crewAboard,
            row.crewAssigned,
            row.attestedByPersonId,
            personName.get(row.attestedByPersonId),
            row.note,
            row.occurredAt,
            row.createdAt,
          ]),
          note: EXPORT_FILE_NOTES["roll_call_crew_attestations.csv"],
        },
        {
          file: "roll_call_crew_events.csv",
          header: [
            "id",
            "trip_id",
            "trip_title",
            "trip_starts_at",
            "person_id",
            "person_name",
            "status",
            "checkpoint",
            "recorded_by_person_id",
            "recorded_by_name",
            "note",
            "occurred_at",
            "created_at",
          ],
          rows: crewRollCallRows.map((row) => [
            row.id,
            row.tripId,
            tripTitle.get(row.tripId),
            tripStartsAt.get(row.tripId),
            row.personId,
            personName.get(row.personId),
            row.status,
            row.checkpoint,
            row.recordedByPersonId,
            personName.get(row.recordedByPersonId),
            row.note,
            row.occurredAt,
            row.createdAt,
          ]),
          note: EXPORT_FILE_NOTES["roll_call_crew_events.csv"],
        },
        {
          file: "buddy_pairs.csv",
          header: [
            "pair_id",
            "trip_id",
            "trip_title",
            "trip_starts_at",
            "booking_id",
            "person_id",
            "person_name",
            "paired_by_person_id",
            "paired_by_name",
            "created_at",
          ],
          rows: buddyPairRows.map((row) => {
            const personId = bookingPerson.get(row.bookingId);
            return [
              row.pairId,
              row.tripId,
              tripTitle.get(row.tripId),
              tripStartsAt.get(row.tripId),
              row.bookingId,
              personId,
              personId ? personName.get(personId) : null,
              row.pairedByPersonId,
              personName.get(row.pairedByPersonId),
              row.createdAt,
            ];
          }),
          note: EXPORT_FILE_NOTES["buddy_pairs.csv"],
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
            "integrity_hash",
            "integrity_version",
            "superseded_at",
            "expires_at",
            "imported_from_label",
            "import_source_document_url",
            "import_source_medical_document_url",
            // Which seal the row's `integrity_hash` is over: version 2 means
            // this release was stripped when its diver was erased, and the
            // signature and medical answers above are blank by decision rather
            // than by omission (ADR 20260802-diver-data-erasure).
            "anonymized_at",
            "anonymized_by_person_id",
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
            row.integrityHash,
            row.integrityVersion,
            row.supersededAt,
            row.expiresAt,
            row.importedFromLabel,
            row.importSourceDocumentUrl,
            row.importSourceMedicalDocumentUrl,
            row.anonymizedAt,
            row.anonymizedByPersonId,
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
            "needs_staff_fit_at",
            "needs_staff_fit_note",
            // Who raised the flag, by the same id + name pair every other
            // person reference in the bundle uses. A safety flag without its
            // attribution is a rumour.
            "needs_staff_fit_by",
            "needs_staff_fit_by_name",
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
            row.needsStaffFitAt,
            row.needsStaffFitNote,
            row.needsStaffFitBy,
            row.needsStaffFitBy ? personName.get(row.needsStaffFitBy) : null,
            row.updatedAt,
          ]),
          note: EXPORT_FILE_NOTES["rental_fit.csv"],
        },
        {
          // History the shop brought in from its previous system
          // (ADR 20260725-import-prior-visits). In the bundle because a shop's
          // own history is its own to take back out, and out of the operational
          // files because that is exactly what it never was.
          file: "prior_visits.csv",
          header: [
            "id",
            "person_id",
            "person_name",
            "visited_on",
            "title",
            "status_label",
            "amount_label",
            "source_label",
            "source_reference",
            "imported_at",
          ],
          rows: priorVisitRows.map((row) => [
            row.id,
            row.personId,
            personName.get(row.personId),
            row.visitedOn,
            row.title,
            row.statusLabel,
            row.amountLabel,
            row.sourceLabel,
            row.sourceReference,
            row.importedAt,
          ]),
          note: EXPORT_FILE_NOTES["prior_visits.csv"],
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
          file: "tips.csv",
          header: [
            "id",
            "booking_id",
            "person_id",
            "person_name",
            "status",
            "currency",
            "amount_cents",
            "stripe_session_id",
            "expires_at",
            "completed_at",
            "created_at",
          ],
          rows: tipRows.map((row) => {
            const personId = bookingPerson.get(row.bookingId) ?? null;
            return [
              row.id,
              row.bookingId,
              personId,
              personId ? personName.get(personId) : null,
              row.status,
              row.currency,
              row.amountCents,
              row.stripeSessionId,
              row.expiresAt,
              row.completedAt,
              row.createdAt,
            ];
          }),
          note: EXPORT_FILE_NOTES["tips.csv"],
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
            "max_depth_meters",
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
            row.maxDepthMeters,
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
          file: "recap_photos.csv",
          header: ["id", "booking_id", "trip_id", "image_url", "caption", "created_at"],
          rows: recapPhotoRows.map((row) => [
            row.id,
            row.bookingId,
            row.tripId,
            row.imageUrl,
            row.caption,
            row.createdAt,
          ]),
          note: EXPORT_FILE_NOTES["recap_photos.csv"],
        },
        {
          file: "trip_reviews.csv",
          header: [
            "id",
            "booking_id",
            "trip_id",
            "person_id",
            "diver_name",
            "rating",
            "comment",
            "is_published",
            "published_at",
            "created_at",
            "updated_at",
          ],
          rows: reviewRows.map(({ review, diverName }) => [
            review.id,
            review.bookingId,
            review.tripId,
            review.personId,
            diverName,
            review.rating,
            review.comment,
            review.isPublished,
            review.publishedAt,
            review.createdAt,
            review.updatedAt,
          ]),
          note: EXPORT_FILE_NOTES["trip_reviews.csv"],
        },
        {
          file: "shop_promo_codes.csv",
          header: [
            "id",
            "code",
            "description",
            "discount_percent",
            "scope",
            "status",
            "starts_at",
            "expires_at",
            "max_redemptions",
            "created_by_person_id",
            "created_at",
          ],
          rows: promoCodeRows.map((row) => [
            row.id,
            row.code,
            row.description,
            row.discountPercent,
            row.scope,
            row.status,
            row.startsAt,
            row.expiresAt,
            row.maxRedemptions,
            row.createdByPersonId,
            row.createdAt,
          ]),
          note: EXPORT_FILE_NOTES["shop_promo_codes.csv"],
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
            "hero_image_alt",
            "image_urls",
            "image_alts",
            "is_active",
            "is_intro_course",
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
            row.heroImageAlt,
            JSON.stringify(row.imageUrls),
            JSON.stringify(row.imageAlts),
            row.isActive,
            row.isIntroCourse,
            row.createdAt,
          ]),
          note: EXPORT_FILE_NOTES["courses.csv"],
        },
        {
          file: "course_paths.csv",
          header: ["id", "title", "slug", "summary", "is_active", "created_at"],
          rows: coursePathRows.map((row) => [
            row.id,
            row.title,
            row.slug,
            row.summary,
            row.isActive,
            row.createdAt,
          ]),
          note: EXPORT_FILE_NOTES["course_paths.csv"],
        },
        {
          file: "course_path_steps.csv",
          header: ["id", "path_id", "course_id", "position", "note"],
          rows: coursePathStepRows.map(({ step }) => [
            step.id,
            step.pathId,
            step.courseId,
            step.position,
            step.note,
          ]),
          note: EXPORT_FILE_NOTES["course_path_steps.csv"],
        },
      ];

      return {
        shopName: shop.name,
        shopSlug: shop.slug,
        timezone: shop.timezone,
        tables,
        photoUrls: [...new Set(photoUrls)].sort(),
      };
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
    "trip_schedule_days.csv": await countOf(
      db
        .select({ n: count() })
        .from(tripScheduleDays)
        .innerJoin(trips, eq(trips.id, tripScheduleDays.tripId))
        .where(eq(trips.shopId, shopId)),
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
    "staff_shifts.csv": await countOf(
      db.select({ n: count() }).from(staffShifts).where(eq(staffShifts.shopId, shopId)),
    ),
    "bookings.csv": await countOf(
      db.select({ n: count() }).from(bookings).where(eq(bookings.shopId, shopId)),
    ),
    "booking_payment_events.csv": await countOf(
      db
        .select({ n: count() })
        .from(bookingPaymentEvents)
        .where(eq(bookingPaymentEvents.shopId, shopId)),
    ),
    "waitlist_entries.csv": await countOf(
      db
        .select({ n: count() })
        .from(tripWaitlistEntries)
        .where(eq(tripWaitlistEntries.shopId, shopId)),
    ),
    "last_minute_list.csv": await countOf(
      db
        .select({ n: count() })
        .from(lastMinuteListEntries)
        .where(eq(lastMinuteListEntries.shopId, shopId)),
    ),
    "trip_last_minute_promos.csv": await countOf(
      db
        .select({ n: count() })
        .from(tripLastMinutePromos)
        .where(eq(tripLastMinutePromos.shopId, shopId)),
    ),
    "roll_call_events.csv": await countOf(
      db.select({ n: count() }).from(rollCallEvents).where(eq(rollCallEvents.shopId, shopId)),
    ),
    "roll_call_crew_events.csv": await countOf(
      db
        .select({ n: count() })
        .from(rollCallCrewEvents)
        .where(eq(rollCallCrewEvents.shopId, shopId)),
    ),
    "roll_call_crew_attestations.csv": await countOf(
      db
        .select({ n: count() })
        .from(rollCallCrewAttestations)
        .where(eq(rollCallCrewAttestations.shopId, shopId)),
    ),
    "buddy_pairs.csv": await countOf(
      db.select({ n: count() }).from(buddyPairMembers).where(eq(buddyPairMembers.shopId, shopId)),
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
    "prior_visits.csv": await countOf(
      db.select({ n: count() }).from(priorVisits).where(eq(priorVisits.shopId, shopId)),
    ),
    "orders.csv": await countOf(
      db.select({ n: count() }).from(orders).where(eq(orders.shopId, shopId)),
    ),
    "order_line_items.csv": await countOf(
      db.select({ n: count() }).from(orderLineItems).where(eq(orderLineItems.shopId, shopId)),
    ),
    "tips.csv": await countOf(db.select({ n: count() }).from(tips).where(eq(tips.shopId, shopId))),
    "dive_sites.csv": await countOf(
      db.select({ n: count() }).from(diveSites).where(eq(diveSites.shopId, shopId)),
    ),
    "dive_site_creatures.csv": await countOf(
      db.select({ n: count() }).from(diveSiteCreatures).where(eq(diveSiteCreatures.shopId, shopId)),
    ),
    "dive_site_moments.csv": await countOf(
      db.select({ n: count() }).from(diveSiteMoments).where(eq(diveSiteMoments.shopId, shopId)),
    ),
    "recap_photos.csv": await countOf(
      db.select({ n: count() }).from(recapPhotos).where(eq(recapPhotos.shopId, shopId)),
    ),
    "trip_reviews.csv": await countOf(
      db.select({ n: count() }).from(tripReviews).where(eq(tripReviews.shopId, shopId)),
    ),
    "shop_promo_codes.csv": await countOf(
      db.select({ n: count() }).from(shopPromoCodes).where(eq(shopPromoCodes.shopId, shopId)),
    ),
    "courses.csv": await countOf(
      db.select({ n: count() }).from(courses).where(eq(courses.shopId, shopId)),
    ),
    "course_paths.csv": await countOf(
      db.select({ n: count() }).from(coursePaths).where(eq(coursePaths.shopId, shopId)),
    ),
    "course_path_steps.csv": await countOf(
      db
        .select({ n: count() })
        .from(coursePathSteps)
        .innerJoin(coursePaths, eq(coursePaths.id, coursePathSteps.pathId))
        .where(eq(coursePaths.shopId, shopId)),
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
