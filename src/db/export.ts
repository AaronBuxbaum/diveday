/**
 * Loads one shop's full export dataset (ADR 20260722-full-shop-export; what
 * belongs in it is ADR 20260806-export-operational-records — a record DiveDay
 * writes *about* a shop's work belongs to that shop, unless carrying it would
 * be a credential, a pointer into infrastructure the destination cannot reach,
 * or DiveDay's own bookkeeping about its own machinery).
 * Every query is scoped by shopId — the caller passes the session's shop, and
 * nothing here trusts a URL. Soft-archived rows are included on purpose:
 * the bundle is migration-grade history, not a view of the active roster.
 * A schema-coverage test (export.test.ts) forces every schema table to be
 * either exported here or on the deliberate exclusion list.
 */

import { and, asc, count, eq, getTableColumns } from "drizzle-orm";
import { fieldGuideCards } from "@/i18n/marine-life-labels";
import { diverTranslator } from "@/i18n/messages";
import { canExportShopData, type Role } from "@/lib/authz";
import {
  type CalendarDate,
  calendarDateInTimezone,
  isCalendarDateExpired,
} from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { EXPORT_FILE_NOTES, type ExportBundleInput, type ExportTable } from "@/lib/export";
import { isUnsightedSelfDeclaration } from "@/lib/readiness";
import { WEEKDAY_EXPORT_CODES, weekdaysIn } from "@/lib/recurrence";
import type { AppDb } from "./client";
import {
  activityEvents,
  boats,
  bookingCheckoutBookings,
  bookingCheckouts,
  bookingPaymentEvents,
  bookingPayments,
  bookings,
  buddyPairMembers,
  certificationLevel,
  certifications,
  courseInquiries,
  courses,
  diveSiteCreatures,
  diveSiteMoments,
  diveSites,
  gearItems,
  gearReservations,
  gearServiceEvents,
  importedPaymentHistory,
  internalNotes,
  lastMinuteListEntries,
  nitroxCertifications,
  notificationDeliveries,
  orderLineItems,
  orders,
  people,
  personRoles,
  priorVisits,
  recapPhotos,
  rentalFitProfiles,
  reviewModerationEvents,
  rollCallCrewEvents,
  rollCallEvents,
  shopPromoCodes,
  shopPromoRedemptions,
  shops,
  specialtyCertifications,
  staffShifts,
  tips,
  tripAssignments,
  tripDives,
  tripInvitations,
  tripLastMinutePromoRecipients,
  tripLastMinutePromos,
  tripRecapPhotos,
  tripRequirements,
  tripReviews,
  tripScheduleDays,
  tripSeries,
  tripSeriesSkips,
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
        // The order the shop put its field guide in, then id — the same total
        // order `listDiveSiteCreatures` reads, so an export and a briefing can
        // never disagree about which face comes first.
        .orderBy(
          asc(diveSiteCreatures.diveSiteId),
          asc(diveSiteCreatures.position),
          asc(diveSiteCreatures.id),
        );

      const cardById = new Map(
        fieldGuideCards(creatureRows, diverTranslator(shop.defaultLocale)).map((card) => [
          card.id,
          card,
        ]),
      );

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

      const tripRecapPhotoRows = await tx
        .select({
          photo: tripRecapPhotos,
          tripTitle: trips.title,
          uploadedByName: people.fullName,
        })
        .from(tripRecapPhotos)
        .innerJoin(trips, and(eq(trips.id, tripRecapPhotos.tripId), eq(trips.shopId, shopId)))
        .innerJoin(
          people,
          and(eq(people.id, tripRecapPhotos.uploadedByPersonId), eq(people.shopId, shopId)),
        )
        .where(eq(tripRecapPhotos.shopId, shopId))
        .orderBy(asc(tripRecapPhotos.createdAt), asc(tripRecapPhotos.id));

      const reviewModerationRows = await tx
        .select({ event: reviewModerationEvents, staffName: people.fullName })
        .from(reviewModerationEvents)
        .innerJoin(people, eq(people.id, reviewModerationEvents.recordedByPersonId))
        .where(eq(reviewModerationEvents.shopId, shopId))
        .orderBy(asc(reviewModerationEvents.occurredAt), asc(reviewModerationEvents.id));

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
      const promoCodeText = new Map(promoCodeRows.map((row) => [row.id, row.code]));

      const courseRows = await tx
        .select()
        .from(courses)
        .where(eq(courses.shopId, shopId))
        .orderBy(asc(courses.createdAt), asc(courses.id));
      const courseTitle = new Map(courseRows.map((row) => [row.id, row.title]));

      const seriesRows = await tx
        .select()
        .from(tripSeries)
        .where(eq(tripSeries.shopId, shopId))
        .orderBy(asc(tripSeries.createdAt), asc(tripSeries.id));
      const seriesTitle = new Map(seriesRows.map((row) => [row.id, row.title]));

      const seriesSkipRows = await tx
        .select()
        .from(tripSeriesSkips)
        .where(eq(tripSeriesSkips.shopId, shopId))
        .orderBy(asc(tripSeriesSkips.createdAt), asc(tripSeriesSkips.id));

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

      const lastMinutePromoRecipientRows = await tx
        .select()
        .from(tripLastMinutePromoRecipients)
        .where(eq(tripLastMinutePromoRecipients.shopId, shopId))
        .orderBy(
          asc(tripLastMinutePromoRecipients.createdAt),
          asc(tripLastMinutePromoRecipients.id),
        );

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

      // What the shop *asked* for, next to what it was paid. `booking_payments`
      // folds into bookings.csv and `booking_payment_events` says how that
      // state moved; neither can show an attempt that was never finished, and
      // an abandoned checkout is a real fact about a diver who reached the
      // payment page. Oldest first, like the other append-shaped files.
      const checkoutRows = await tx
        .select()
        .from(bookingCheckouts)
        .where(eq(bookingCheckouts.shopId, shopId))
        .orderBy(asc(bookingCheckouts.createdAt), asc(bookingCheckouts.id));

      // Which seats each of those attempts was paying for. Ordered by checkout
      // then booking so a reader walking the file stays inside one attempt.
      const checkoutBookingRows = await tx
        .select()
        .from(bookingCheckoutBookings)
        .where(eq(bookingCheckoutBookings.shopId, shopId))
        .orderBy(asc(bookingCheckoutBookings.checkoutId), asc(bookingCheckoutBookings.bookingId));

      const promoRedemptionRows = await tx
        .select()
        .from(shopPromoRedemptions)
        .where(eq(shopPromoRedemptions.shopId, shopId))
        .orderBy(asc(shopPromoRedemptions.redeemedAt), asc(shopPromoRedemptions.id));

      const noteRows = await tx
        .select()
        .from(internalNotes)
        .where(eq(internalNotes.shopId, shopId))
        .orderBy(asc(internalNotes.createdAt), asc(internalNotes.id));

      // `seq` is the tiebreaker, not `id`: it is the column the in-product feed
      // already orders by within a single timestamp, so the exported file reads
      // in the order the shop saw the events happen.
      const activityRows = await tx
        .select()
        .from(activityEvents)
        .where(eq(activityEvents.shopId, shopId))
        .orderBy(asc(activityEvents.occurredAt), asc(activityEvents.seq));

      // One row per (booking, kind) by unique index — a resend overwrites in
      // place — so this is the standing outcome per message, not a send log.
      const notificationRows = await tx
        .select()
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.shopId, shopId))
        .orderBy(asc(notificationDeliveries.attemptedAt), asc(notificationDeliveries.id));

      const inquiryRows = await tx
        .select()
        .from(courseInquiries)
        .where(eq(courseInquiries.shopId, shopId))
        .orderBy(asc(courseInquiries.createdAt), asc(courseInquiries.id));
      const inquiryById = new Map(inquiryRows.map((row) => [row.id, row]));

      const invitationRows = await tx
        .select()
        .from(tripInvitations)
        .where(eq(tripInvitations.shopId, shopId))
        .orderBy(asc(tripInvitations.createdAt), asc(tripInvitations.id));

      const rollCallRows = await tx
        .select()
        .from(rollCallEvents)
        .where(eq(rollCallEvents.shopId, shopId))
        // `seq`, not `id`: the id is a random uuid, so two events sharing an
        // `occurred_at` came out in a different order every export — of the one
        // file a shop is meant to be able to diff against last week's.
        .orderBy(asc(rollCallEvents.occurredAt), asc(rollCallEvents.seq));

      // The crew half: who, not just how many. Same oldest-first ordering, same
      // append-only replay rule as the diver events.
      const crewRollCallRows = await tx
        .select()
        .from(rollCallCrewEvents)
        .where(eq(rollCallCrewEvents.shopId, shopId))
        .orderBy(asc(rollCallCrewEvents.occurredAt), asc(rollCallCrewEvents.seq));

      // Buddy teams standing at export time — not a history: dissolving a team
      // deletes the rows, and the trail that outlives them (`buddy_team_events`)
      // is an in-product operational record, deliberately not exported
      // (ADR 20260804-buddy-teams).
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

      const gearItemRows = await tx
        .select()
        .from(gearItems)
        .where(eq(gearItems.shopId, shopId))
        .orderBy(asc(gearItems.kind), asc(gearItems.label));
      const gearItemLabel = new Map(gearItemRows.map((row) => [row.id, row.label]));

      const gearServiceEventRows = await tx
        .select()
        .from(gearServiceEvents)
        .where(eq(gearServiceEvents.shopId, shopId))
        .orderBy(asc(gearServiceEvents.servicedOn), asc(gearServiceEvents.createdAt));

      const gearReservationRows = await tx
        .select()
        .from(gearReservations)
        .where(eq(gearReservations.shopId, shopId))
        .orderBy(asc(gearReservations.reservedFrom), asc(gearReservations.createdAt));

      const priorVisitRows = await tx
        .select()
        .from(priorVisits)
        .where(eq(priorVisits.shopId, shopId))
        .orderBy(asc(priorVisits.visitedOn), asc(priorVisits.id));

      const importedPaymentHistoryRows = await tx
        .select()
        .from(importedPaymentHistory)
        .where(eq(importedPaymentHistory.shopId, shopId))
        .orderBy(asc(importedPaymentHistory.occurredOn), asc(importedPaymentHistory.id));

      const boatRows = await tx
        .select()
        .from(boats)
        .where(eq(boats.shopId, shopId))
        .orderBy(asc(boats.createdAt), asc(boats.id));

      const boatName = new Map(boatRows.map((row) => [row.id, row.name]));

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
      /**
       * **People a card the shop actually holds refutes** — the same three-table
       * test `listCertificationSummaries` applies before it will render "Not
       * certified yet — diver's word", restated here rather than called because
       * that reader takes an `inArray` of person ids and a long-lived shop's
       * lifetime roster would blow PostgreSQL's bind-parameter limit (the same
       * reason `personRoles` above is joined rather than filtered by id list).
       *
       * A still-unsighted self-declaration is not a card, on any of the three:
       * a diver who declared a rung and later said they hold nothing has made
       * two statements and neither is evidence. A specialty row settles it
       * outright — `specialty_certifications` has no `self_declared_at` at all,
       * so every live row in it is a card a staffer captured or a CSV brought in.
       */
      const cardedPeople = new Set<string>();
      for (const card of certificationRows) {
        if (!card.deletedAt && !isUnsightedSelfDeclaration(card)) cardedPeople.add(card.personId);
      }
      for (const card of nitroxRows) {
        if (!card.deletedAt && !isUnsightedSelfDeclaration(card)) cardedPeople.add(card.personId);
      }
      for (const card of specialtyRows) {
        if (!card.deletedAt) cardedPeople.add(card.personId);
      }

      const waiversByPerson = new Map<string, typeof waiverRows>();
      for (const record of waiverRows) {
        waiversByPerson.set(record.personId, [
          ...(waiversByPerson.get(record.personId) ?? []),
          record,
        ]);
      }

      // Every DiveDay-stored image or imported-document URL any CSV below
      // references, for the photos/ bundle (ADR 20260724-export-bundled-photos
      // and 20260816-imported-payment-history-is-evidence). `fetchExportPhotos`
      // filters this again to DiveDay's own storage — collecting a non-managed
      // URL here is harmless, just never fetched.
      const photoUrls = [
        ...recapPhotoRows.map((row) => row.imageUrl),
        ...tripRecapPhotoRows.map(({ photo }) => photo.imageUrl),
        ...siteRows.flatMap((row) => [row.satelliteImageUrl, row.routeImageUrl, ...row.imageUrls]),
        // No field-guide photos: a creature row is a catalog slug, and the
        // picture on its card is DiveDay's own asset under `public/marine-life`
        // (ADR 20260813-marine-life-is-diveday-copy) rather than anything this
        // shop uploaded. `dive_site_creatures.csv` still prints the path, which
        // resolves against DiveDay and needs nothing bundled.
        ...momentRows.map((row) => row.imageUrl),
        ...courseRows.flatMap((row) => [
          row.heroImageUrl,
          ...row.galleryPhotos.map((photo) => photo.url),
        ]),
        ...waiverRows.flatMap((row) => [
          row.importSourceDocumentUrl,
          row.importSourceMedicalDocumentUrl,
        ]),
        ...importedPaymentHistoryRows.map((row) => row.receiptDocumentUrl),
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
            "has_shore_diving",
            "has_pool_diving",
            "contact_email",
            "contact_phone",
            "address_street",
            "address_locality",
            "address_region",
            "address_postal_code",
            "address_country",
            "dock_call_minutes",
            // The rest of the shop's dock-day rhythm (ADR
            // 20260812-configurable-dock-day-rhythm). Six numbers that describe
            // how this shop runs a day — as much the shop's own record as its
            // packing list, and re-importable as one.
            "gear_setup_minutes",
            "briefing_minutes",
            "boat_ride_minutes",
            "bottom_time_minutes",
            "surface_interval_minutes",
            "review_url",
            "packing_list",
            "rental_items",
            "rental_pricing",
            // Whether the shop asked to stay out of search engines
            // (ADR 20260813-search-listing-is-a-choice). Exported because the
            // bundle is also the *backup*: a shop that opted out and later
            // restored from one must not come back published.
            "search_listing_opt_out_at",
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
              shop.hasShoreDiving,
              shop.hasPoolDiving,
              shop.contactEmail,
              shop.contactPhone,
              shop.addressStreet,
              shop.addressLocality,
              shop.addressRegion,
              shop.addressPostalCode,
              shop.addressCountry,
              shop.dockCallMinutes,
              shop.gearSetupMinutes,
              shop.briefingMinutes,
              shop.boatRideMinutes,
              shop.bottomTimeMinutes,
              shop.surfaceIntervalMinutes,
              shop.reviewUrl,
              JSON.stringify(shop.packingList),
              JSON.stringify(shop.rentalItems),
              JSON.stringify(shop.rentalPricing),
              shop.searchListingOptOutAt,
              shop.createdAt,
            ],
          ],
          note: EXPORT_FILE_NOTES["shop.csv"],
        },
        {
          file: "boats.csv",
          header: ["id", "name", "capacity", "created_at"],
          rows: boatRows.map((row) => [row.id, row.name, row.capacity, row.createdAt]),
          note: EXPORT_FILE_NOTES["boats.csv"],
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
            // **"Said they hold no card" is not the same fact as "was never
            // asked", and in this file they were byte-identical.** The four
            // certification columns above are blank for both, which is the exact
            // ambiguity `people.no_certification_declared_at` exists to remove —
            // reintroduced for the reader most likely to act on it, since a
            // destination system importing this file prompts staff to "complete"
            // a blank record and a shop reading it in a spreadsheet reads a gap
            // as an oversight.
            //
            // It sits here, beside the certification columns, and deliberately
            // **never** as a value inside `certification_level` or
            // `certification_agency`: a "none" rung is the `certifications`-row
            // mistake the ADR refuses, one file format down, and the first
            // importer to sort or rank that column would put it on the ladder.
            "no_certification_declared_at",
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
              // Blank unless the answer still stands: cleared by a staffer,
              // refuted by a card the shop holds, or contradicted by the very
              // level this row is already exporting, and this file says nothing.
              // contacts.csv is the *interpreted* row — "the strongest honest
              // claim per diver" — so it must not hand a destination system both
              // a card and a statement that there is no card and leave it to
              // arbitrate. people.csv carries the raw pair for anyone auditing.
              //
              // The `card` test is the one `cardedPeople` cannot do and is not
              // redundant with it. A diver may declare "no card" and later
              // declare a *rung*: the writer keeps both flags and the staff
              // reader renders the rung as the later, more specific statement,
              // but `bestCertification` above ranks a still-unsighted claim too,
              // so without this the same row would ship `certification_level`
              // **and** "there is no card" (`dive-domain-expert`, 2026-08-15).
              row.noCertificationDeclaredAt &&
              !row.noCertificationClearedAt &&
              !cardedPeople.has(row.id) &&
              !card
                ? row.noCertificationDeclaredAt
                : null,
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
            // The diver's own "I'm not certified yet", which is a statement
            // about them and not a card — it has no row in certifications.csv
            // to travel in, so it travels here or not at all (ADR
            // 20260814-self-declared-cards).
            "no_certification_declared_at",
            // And the correction, when a staffer said the diver never gave that
            // answer. Both halves travel because this is the normalized dump:
            // a cleared stamp is *superseded*, not deleted (people.no_certification_cleared_at),
            // so a file that carried only the first column would re-assert a
            // statement the shop has withdrawn. contacts.csv, which interprets
            // rather than dumps, resolves the pair down to one cell.
            "no_certification_cleared_at",
            "no_certification_cleared_by_person_id",
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
            row.noCertificationDeclaredAt,
            row.noCertificationClearedAt,
            row.noCertificationClearedByPersonId,
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
            "reviewed_by_person_id",
            // Provenance from the contact importer (ADR 20260724-import-verified-cards):
            // a non-null imported_at is the definitive "this card was migrated, not
            // carded on sight" marker, permanent even after a staff confirm.
            "imported_at",
            "imported_from_label",
            // The weaker sibling of imported_at, and it travels for the same
            // reason: a non-null self_declared_at means the level came off a
            // public opt-in the diver filled in themselves, with no card
            // sighted. Dropping it from the export would launder a claim into
            // an ordinary card the moment the file is read back.
            "self_declared_at",
            "deleted_at",
            "deleted_by_person_id",
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
            row.reviewedByPersonId,
            row.importedAt,
            row.importedFromLabel,
            row.selfDeclaredAt,
            row.deletedAt,
            row.deletedByPersonId,
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
            "reviewed_by_person_id",
            "deleted_at",
            "deleted_by_person_id",
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
            row.reviewedByPersonId,
            row.deletedAt,
            row.deletedByPersonId,
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
            "reviewed_by_person_id",
            "imported_at",
            "imported_from_label",
            // Same reason as the level card's — see certifications.csv above.
            "self_declared_at",
            "deleted_at",
            "deleted_by_person_id",
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
            row.reviewedByPersonId,
            row.importedAt,
            row.importedFromLabel,
            row.selfDeclaredAt,
            row.deletedAt,
            row.deletedByPersonId,
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
            // Beside the status it qualifies: a shop reading its own history
            // wants to know *when* a departure was called off, not only that it
            // was. Null for anything cancelled before the column existed.
            "cancelled_at",
            "starts_at",
            "ends_at",
            "capacity",
            "planned_dives",
            "price_cents",
            "deposit_cents",
            "cancellation_window_hours",
            "minimum_bookings",
            "minimum_decision_hours",
            "series_id",
            "series_occurrence_date",
            "course_id",
            "dive_site_id",
            "dive_site_name",
            "dive_mode",
            "boat_id",
            "boat_name",
            "conditions_hold",
            "conditions_summary",
            "water_temperature_c",
            "visibility_meters",
            "surface_conditions",
            "conditions_updated_at",
            "description",
            "is_private",
            "created_at",
          ],
          rows: tripRows.map((row) => [
            row.id,
            row.title,
            row.status,
            row.cancelledAt,
            row.startsAt,
            row.endsAt,
            row.capacity,
            row.plannedDives,
            row.priceCents,
            row.depositCents,
            row.cancellationWindowHours,
            row.minimumBookings,
            row.minimumDecisionHours,
            row.seriesId,
            row.seriesOccurrenceDate,
            row.courseId,
            row.diveSiteId,
            row.diveSiteId ? siteName.get(row.diveSiteId) : null,
            row.diveMode,
            row.boatId,
            row.boatId ? boatName.get(row.boatId) : null,
            row.conditionsHold,
            row.conditionsSummary,
            row.waterTemperatureC,
            row.visibilityMeters,
            row.surfaceConditions,
            row.conditionsUpdatedAt,
            row.description,
            row.isPrivate,
            row.createdAt,
          ]),
          note: EXPORT_FILE_NOTES["trips.csv"],
        },
        {
          file: "trip_series.csv",
          header: [
            "id",
            "title",
            "frequency",
            "interval_weeks",
            // The stored value is a bitmask; the CSV carries the days a person
            // can read, because a shop opening this in a spreadsheet is owed
            // "mon,thu" rather than "18" (src/lib/recurrence.ts).
            "weekdays",
            "weekday_mask",
            "anchor_date",
            "ends_on",
            "occurrence_count",
            "last_rolled_at",
            "created_at",
          ],
          rows: seriesRows.map((row) => [
            row.id,
            row.title,
            row.frequency,
            row.intervalWeeks,
            weekdaysIn(row.weekdayMask)
              .map((day) => WEEKDAY_EXPORT_CODES[day])
              .join(","),
            row.weekdayMask,
            row.anchorDate,
            row.endsOn,
            row.occurrenceCount,
            row.lastRolledAt,
            row.createdAt,
          ]),
          note: EXPORT_FILE_NOTES["trip_series.csv"],
        },
        {
          file: "trip_series_skips.csv",
          header: ["series_id", "series_title", "occurrence_date", "created_at"],
          rows: seriesSkipRows.map((row) => [
            row.seriesId,
            seriesTitle.get(row.seriesId) ?? null,
            row.occurrenceDate,
            row.createdAt,
          ]),
          note: EXPORT_FILE_NOTES["trip_series_skips.csv"],
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
            // How long the boat runs to reach this dive's site — from the dock
            // for dive one, from the previous dive's site after that. Empty
            // means the leg reads the shop's own `boat_ride_minutes`
            // (ADR 20260815-per-leg-travel-minutes).
            "travel_minutes",
          ],
          rows: tripDiveRows.map((row) => [
            row.tripId,
            tripTitle.get(row.tripId),
            row.diveNumber,
            row.title,
            row.diveSiteId,
            row.diveSiteId ? siteName.get(row.diveSiteId) : null,
            row.description,
            row.travelMinutes,
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
          file: "trip_invitations.csv",
          header: [
            "id",
            "trip_id",
            "trip_title",
            "trip_starts_at",
            "source",
            "course_inquiry_id",
            "waitlist_entry_id",
            "person_id",
            "person_name",
            "created_by_person_id",
            "created_by_name",
            "invited_at",
            "created_at",
          ],
          rows: invitationRows.map((row) => {
            const inquiry = row.courseInquiryId ? inquiryById.get(row.courseInquiryId) : undefined;
            const personId = row.personId ?? inquiry?.personId ?? null;
            return [
              row.id,
              row.tripId,
              tripTitle.get(row.tripId),
              tripStartsAt.get(row.tripId),
              row.source,
              row.courseInquiryId,
              row.waitlistEntryId,
              personId,
              personId ? personName.get(personId) : inquiry?.name,
              row.createdByPersonId,
              personName.get(row.createdByPersonId),
              row.invitedAt,
              row.createdAt,
            ];
          }),
          note: EXPORT_FILE_NOTES["trip_invitations.csv"],
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
          file: "trip_last_minute_promo_recipients.csv",
          header: ["id", "trip_promo_id", "person_id", "person_name", "email", "created_at"],
          rows: lastMinutePromoRecipientRows.map((row) => [
            row.id,
            row.tripPromoId,
            row.personId,
            personName.get(row.personId),
            row.email,
            row.createdAt,
          ]),
          note: EXPORT_FILE_NOTES["trip_last_minute_promo_recipients.csv"],
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
          file: "booking_checkouts.csv",
          header: [
            "id",
            "trip_id",
            "trip_title",
            "trip_starts_at",
            "status",
            "stripe_session_id",
            "customer_email",
            "promo_code_id",
            "trip_promo_id",
            "promo_code",
            "applied_discount_percent",
            "currency",
            "amount_per_diver_cents",
            "total_cents",
            "settled_total_cents",
            "is_deposit",
            "abandoned_recovery_sent_at",
            "expires_at",
            "completed_at",
            "async_payment_failed_at",
            "created_at",
          ],
          rows: checkoutRows.map((row) => [
            row.id,
            row.tripId,
            tripTitle.get(row.tripId),
            tripStartsAt.get(row.tripId),
            row.status,
            row.stripeSessionId,
            row.customerEmail,
            row.promoCodeId,
            row.tripPromoId,
            row.promoCode,
            row.appliedDiscountPercent,
            row.currency,
            row.amountPerDiverCents,
            row.totalCents,
            row.settledTotalCents,
            row.isDeposit,
            row.abandonedRecoverySentAt,
            row.expiresAt,
            row.completedAt,
            row.asyncPaymentFailedAt,
            row.createdAt,
          ]),
          note: EXPORT_FILE_NOTES["booking_checkouts.csv"],
        },
        {
          file: "booking_checkout_bookings.csv",
          header: ["checkout_id", "booking_id", "person_id", "person_name", "gear_cents"],
          rows: checkoutBookingRows.map((row) => {
            const personId = bookingPerson.get(row.bookingId) ?? null;
            return [
              row.checkoutId,
              row.bookingId,
              personId,
              personId ? personName.get(personId) : null,
              row.gearCents,
            ];
          }),
          note: EXPORT_FILE_NOTES["booking_checkout_bookings.csv"],
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
            "source",
            "client_event_id",
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
            row.source,
            row.clientEventId,
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
            "member_kind",
            "booking_id",
            "crew_person_id",
            "person_id",
            "person_name",
            "paired_by_person_id",
            "paired_by_name",
            "created_at",
          ],
          // One row per member, diver or crew (ADR 20260804-buddy-teams).
          // `person_id` resolves to the same thing either way — the human — so a
          // reader who only cares "who was on this team" reads one column;
          // `member_kind` is what tells them whether that human held a seat.
          rows: buddyPairRows.map((row) => {
            const personId = row.bookingId
              ? (bookingPerson.get(row.bookingId) ?? null)
              : row.crewPersonId;
            return [
              row.pairId,
              row.tripId,
              tripTitle.get(row.tripId),
              tripStartsAt.get(row.tripId),
              row.bookingId ? "diver" : "crew",
              row.bookingId,
              row.crewPersonId,
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
          file: "gear_items.csv",
          header: [
            "id",
            "kind",
            "label",
            "size",
            "serial_number",
            "brand_model",
            "purchased_on",
            "status",
            "service_note",
            "created_at",
            "updated_at",
          ],
          rows: gearItemRows.map((row) => [
            row.id,
            row.kind,
            row.label,
            row.size,
            row.serialNumber,
            row.brandModel,
            row.purchasedOn,
            row.status,
            row.serviceNote,
            row.createdAt,
            row.updatedAt,
          ]),
          note: EXPORT_FILE_NOTES["gear_items.csv"],
        },
        {
          file: "gear_service_events.csv",
          header: [
            "id",
            "gear_item_id",
            "gear_item_label",
            "kind",
            "serviced_on",
            "next_due_on",
            "note",
            "recorded_by_person_id",
            "recorded_by_name",
            "created_at",
          ],
          rows: gearServiceEventRows.map((row) => [
            row.id,
            row.gearItemId,
            gearItemLabel.get(row.gearItemId),
            row.kind,
            row.servicedOn,
            row.nextDueOn,
            row.note,
            row.recordedByPersonId,
            row.recordedByPersonId ? personName.get(row.recordedByPersonId) : null,
            row.createdAt,
          ]),
          note: EXPORT_FILE_NOTES["gear_service_events.csv"],
        },
        {
          file: "gear_reservations.csv",
          header: [
            "id",
            "gear_item_id",
            "gear_item_label",
            "booking_id",
            "person_name",
            "reserved_from",
            "reserved_until",
            "checked_out_at",
            "returned_at",
            "return_note",
            "created_at",
          ],
          rows: gearReservationRows.map((row) => {
            const personId = bookingPerson.get(row.bookingId);
            return [
              row.id,
              row.gearItemId,
              gearItemLabel.get(row.gearItemId),
              row.bookingId,
              personId ? personName.get(personId) : null,
              row.reservedFrom,
              row.reservedUntil,
              row.checkedOutAt,
              row.returnedAt,
              row.returnNote,
              row.createdAt,
            ];
          }),
          note: EXPORT_FILE_NOTES["gear_reservations.csv"],
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
          // Separate source evidence, deliberately not folded into orders.csv:
          // an old processor's receipt or Stripe reference is not a DiveDay
          // invoice. The export keeps the source row portable without making
          // the next system mistake it for a live payment.
          file: "imported_payment_history.csv",
          header: [
            "id",
            "person_id",
            "person_name",
            "occurred_on",
            "direction",
            "title",
            "status_label",
            "amount_label",
            "amount_cents",
            "currency",
            "payment_reference",
            "receipt_reference",
            "receipt_document_url",
            "source_label",
            "source_reference",
            "stripe_reference",
            "imported_at",
          ],
          rows: importedPaymentHistoryRows.map((row) => [
            row.id,
            row.personId,
            personName.get(row.personId),
            row.occurredOn,
            row.direction,
            row.title,
            row.statusLabel,
            row.amountLabel,
            row.amountCents,
            row.currency,
            row.paymentReference,
            row.receiptReference,
            row.receiptDocumentUrl,
            row.sourceLabel,
            row.sourceReference,
            row.stripeReference,
            row.importedAt,
          ]),
          note: EXPORT_FILE_NOTES["imported_payment_history.csv"],
        },
        {
          file: "internal_notes.csv",
          header: [
            "id",
            "person_id",
            "person_name",
            "booking_id",
            "body",
            "created_by_person_id",
            "created_by_name",
            "created_at",
          ],
          rows: noteRows.map((row) => [
            row.id,
            row.personId,
            personName.get(row.personId),
            row.bookingId,
            row.body,
            row.createdByPersonId,
            personName.get(row.createdByPersonId),
            row.createdAt,
          ]),
          note: EXPORT_FILE_NOTES["internal_notes.csv"],
        },
        {
          file: "activity_events.csv",
          header: [
            "id",
            "seq",
            "trip_id",
            "trip_title",
            "booking_id",
            "actor_person_id",
            "actor_name",
            "message",
            "occurred_at",
          ],
          rows: activityRows.map((row) => [
            row.id,
            row.seq,
            row.tripId,
            row.tripId ? tripTitle.get(row.tripId) : null,
            row.bookingId,
            row.actorPersonId,
            personName.get(row.actorPersonId),
            row.message,
            row.occurredAt,
          ]),
          note: EXPORT_FILE_NOTES["activity_events.csv"],
        },
        {
          file: "notification_deliveries.csv",
          header: [
            "id",
            "booking_id",
            "person_id",
            "person_name",
            "kind",
            "status",
            "provider_message_id",
            "provider_status",
            "provider_status_at",
            "provider_detail",
            "send_http_status",
            "send_error_code",
            "send_error",
            "attempted_at",
            "created_at",
          ],
          rows: notificationRows.map((row) => {
            const personId = bookingPerson.get(row.bookingId) ?? null;
            return [
              row.id,
              row.bookingId,
              personId,
              personId ? personName.get(personId) : null,
              row.kind,
              row.status,
              row.providerMessageId,
              row.providerStatus,
              row.providerStatusAt,
              row.providerDetail,
              row.sendHttpStatus,
              row.sendErrorCode,
              row.sendError,
              row.attemptedAt,
              row.createdAt,
            ];
          }),
          note: EXPORT_FILE_NOTES["notification_deliveries.csv"],
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
            "difficulty_level",
            "depth_range",
            "max_depth_meters",
            "expected_bottom_time_minutes",
            "current_note",
            "dive_plan",
            "fit_tone",
            "fit_note",
            "field_guide_tips_heading",
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
            "route_points",
            "route_label",
            "route_note",
            "route_zoom",
            "image_urls",
            "deleted_at",
            "created_at",
          ],
          rows: siteRows.map((row) => [
            row.id,
            row.name,
            row.locationName,
            row.description,
            // The code, not the legacy free text beside it: `difficulty_level`
            // is what the app reads and what the shop chose (ADR
            // 20260813-dive-site-difficulty-is-a-code). The column keeps its
            // three stable values, so a destination system can map them.
            row.difficultyLevel,
            row.depthRange,
            row.maxDepthMeters,
            row.expectedBottomTimeMinutes,
            row.currentNote,
            row.divePlan,
            row.fitTone,
            row.fitNote,
            row.fieldGuideTipsHeading,
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
            // The drawn route travels with the site, so a shop that exports
            // and re-imports keeps the line it drew — the waypoints are only
            // meaningful next to the coordinates and zoom two columns over, so
            // all four go together or none of them do.
            JSON.stringify(row.routePoints),
            row.routeLabel,
            row.routeNote,
            row.routeZoom,
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
            "position",
            "name",
            "kind",
            "description",
            "preparation_tip",
            "image_url",
            "catalog_slug",
          ],
          // A row stores a catalog slug and a position; the words are
          // DiveDay's and belong to no row (ADR
          // 20260813-marine-life-is-diveday-copy). They are resolved here in
          // the shop's own default language rather than left blank, because a
          // bundle of ninety-three slugs is not a thing a person can read, and
          // this file is what a shop opens in a spreadsheet. `catalog_slug` is
          // the column to reconcile against; the rest is a rendering.
          //
          // Iterated over the *rows* rather than over the resolved cards, so a
          // row DiveDay has no words for still appears with its id, its site
          // and its position. The briefing skips such a row; an export must
          // not. A shop's data-out bundle is the one place where "we dropped
          // something and said nothing" is the worst possible behaviour --
          // this file is what a shop reconciles against when it leaves.
          rows: creatureRows.map((row) => {
            const card = cardById.get(row.id);
            return [
              row.id,
              row.diveSiteId,
              siteName.get(row.diveSiteId),
              row.position,
              card?.name,
              card?.kind,
              card?.description,
              card?.preparationTip,
              card?.imageUrl,
              row.catalogSlug,
            ];
          }),
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
          file: "trip_recap_photos.csv",
          header: [
            "id",
            "trip_id",
            "trip_title",
            "image_url",
            "uploaded_by_person_id",
            "uploaded_by_person_name",
            "created_at",
          ],
          rows: tripRecapPhotoRows.map(({ photo, tripTitle, uploadedByName }) => [
            photo.id,
            photo.tripId,
            tripTitle,
            photo.imageUrl,
            photo.uploadedByPersonId,
            uploadedByName,
            photo.createdAt,
          ]),
          note: EXPORT_FILE_NOTES["trip_recap_photos.csv"],
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
            "is_standout",
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
            review.isStandout,
            review.isPublished,
            review.publishedAt,
            review.createdAt,
            review.updatedAt,
          ]),
          note: EXPORT_FILE_NOTES["trip_reviews.csv"],
        },
        {
          file: "review_moderation_events.csv",
          header: [
            "id",
            "review_id",
            "action",
            "reason",
            "reason_note",
            "recorded_by_person_id",
            "recorded_by_name",
            "occurred_at",
          ],
          rows: reviewModerationRows.map(({ event, staffName }) => [
            event.id,
            event.reviewId,
            event.action,
            event.reason,
            event.reasonNote,
            event.recordedByPersonId,
            staffName,
            event.occurredAt,
          ]),
          note: EXPORT_FILE_NOTES["review_moderation_events.csv"],
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
          file: "shop_promo_redemptions.csv",
          header: [
            "id",
            "promo_code_id",
            "code",
            "checkout_id",
            "amount_charged_cents",
            "redeemed_at",
          ],
          // The code travels beside its id for the same reason every other file
          // carries a `*_name` next to a `*_person_id`: a bundle a human opens
          // in a spreadsheet must be readable without joining it back together.
          rows: promoRedemptionRows.map((row) => [
            row.id,
            row.promoCodeId,
            promoCodeText.get(row.promoCodeId),
            row.checkoutId,
            row.amountChargedCents,
            row.redeemedAt,
          ]),
          note: EXPORT_FILE_NOTES["shop_promo_redemptions.csv"],
        },
        {
          file: "courses.csv",
          header: [
            "id",
            "title",
            "agency",
            "slug",
            "description",
            "source_template_slug",
            "source_template_version",
            "source_template_snapshot",
            "summary",
            "overview",
            "price_cents",
            "e_learning_price_cents",
            "private_price_cents",
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
            "gallery_photos",
            "is_active",
            "is_intro_course",
            "nitrox_compatible",
            "created_at",
          ],
          rows: courseRows.map((row) => [
            row.id,
            row.title,
            row.agency,
            row.slug,
            row.description,
            row.sourceTemplateSlug,
            row.sourceTemplateVersion,
            JSON.stringify(row.sourceTemplateSnapshot),
            row.summary,
            row.overview,
            row.priceCents,
            row.eLearningPriceCents,
            row.privatePriceCents,
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
            JSON.stringify(row.galleryPhotos),
            row.isActive,
            row.isIntroCourse,
            row.nitroxCompatible,
            row.createdAt,
          ]),
          note: EXPORT_FILE_NOTES["courses.csv"],
        },
        {
          file: "course_inquiries.csv",
          header: [
            "id",
            "course_id",
            "course_title",
            "interest",
            "person_id",
            "person_name",
            "name",
            "email",
            "phone",
            "experience_level",
            "timing",
            "preferred_date",
            "alternate_date",
            "date_flexible",
            "divers",
            "message",
            "created_at",
          ],
          rows: inquiryRows.map((row) => [
            row.id,
            row.courseId,
            // Null for a request that names no course — it says what it is
            // about in `interest` instead, the column beside this one.
            row.courseId ? courseTitle.get(row.courseId) : null,
            row.interest,
            row.personId,
            // Resolved at capture time by exact email match against a live
            // diver, never back-filled — so a null here is a lead nobody could
            // tie to a person, not a lookup this export skipped.
            row.personId ? personName.get(row.personId) : null,
            row.name,
            row.email,
            row.phone,
            row.experienceLevel,
            row.timing,
            row.preferredDate,
            row.alternateDate,
            row.dateFlexible,
            row.divers,
            row.message,
            row.createdAt,
          ]),
          note: EXPORT_FILE_NOTES["course_inquiries.csv"],
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
    "boats.csv": await countOf(
      db.select({ n: count() }).from(boats).where(eq(boats.shopId, shopId)),
    ),
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
    "trip_series_skips.csv": await countOf(
      db.select({ n: count() }).from(tripSeriesSkips).where(eq(tripSeriesSkips.shopId, shopId)),
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
    "booking_checkouts.csv": await countOf(
      db.select({ n: count() }).from(bookingCheckouts).where(eq(bookingCheckouts.shopId, shopId)),
    ),
    "booking_checkout_bookings.csv": await countOf(
      db
        .select({ n: count() })
        .from(bookingCheckoutBookings)
        .where(eq(bookingCheckoutBookings.shopId, shopId)),
    ),
    "internal_notes.csv": await countOf(
      db.select({ n: count() }).from(internalNotes).where(eq(internalNotes.shopId, shopId)),
    ),
    "activity_events.csv": await countOf(
      db.select({ n: count() }).from(activityEvents).where(eq(activityEvents.shopId, shopId)),
    ),
    "notification_deliveries.csv": await countOf(
      db
        .select({ n: count() })
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.shopId, shopId)),
    ),
    "shop_promo_redemptions.csv": await countOf(
      db
        .select({ n: count() })
        .from(shopPromoRedemptions)
        .where(eq(shopPromoRedemptions.shopId, shopId)),
    ),
    "course_inquiries.csv": await countOf(
      db.select({ n: count() }).from(courseInquiries).where(eq(courseInquiries.shopId, shopId)),
    ),
    "waitlist_entries.csv": await countOf(
      db
        .select({ n: count() })
        .from(tripWaitlistEntries)
        .where(eq(tripWaitlistEntries.shopId, shopId)),
    ),
    "trip_invitations.csv": await countOf(
      db.select({ n: count() }).from(tripInvitations).where(eq(tripInvitations.shopId, shopId)),
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
    "trip_last_minute_promo_recipients.csv": await countOf(
      db
        .select({ n: count() })
        .from(tripLastMinutePromoRecipients)
        .where(eq(tripLastMinutePromoRecipients.shopId, shopId)),
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
    "gear_items.csv": await countOf(
      db.select({ n: count() }).from(gearItems).where(eq(gearItems.shopId, shopId)),
    ),
    "gear_service_events.csv": await countOf(
      db.select({ n: count() }).from(gearServiceEvents).where(eq(gearServiceEvents.shopId, shopId)),
    ),
    "gear_reservations.csv": await countOf(
      db.select({ n: count() }).from(gearReservations).where(eq(gearReservations.shopId, shopId)),
    ),
    "prior_visits.csv": await countOf(
      db.select({ n: count() }).from(priorVisits).where(eq(priorVisits.shopId, shopId)),
    ),
    "imported_payment_history.csv": await countOf(
      db
        .select({ n: count() })
        .from(importedPaymentHistory)
        .where(eq(importedPaymentHistory.shopId, shopId)),
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
    "trip_recap_photos.csv": await countOf(
      db.select({ n: count() }).from(tripRecapPhotos).where(eq(tripRecapPhotos.shopId, shopId)),
    ),
    "trip_reviews.csv": await countOf(
      db.select({ n: count() }).from(tripReviews).where(eq(tripReviews.shopId, shopId)),
    ),
    "review_moderation_events.csv": await countOf(
      db
        .select({ n: count() })
        .from(reviewModerationEvents)
        .where(eq(reviewModerationEvents.shopId, shopId)),
    ),
    "shop_promo_codes.csv": await countOf(
      db.select({ n: count() }).from(shopPromoCodes).where(eq(shopPromoCodes.shopId, shopId)),
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
