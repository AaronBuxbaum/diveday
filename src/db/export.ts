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

import { and, asc, count, eq, getTableColumns, inArray, isNull, or } from "drizzle-orm";
import { fieldGuideCards } from "@/i18n/marine-life-labels";
import { diverTranslator } from "@/i18n/messages";
import { canExportShopData, type Role } from "@/lib/authz";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import {
  type DiverExportBundleInput,
  EXPORT_FILE_NOTES,
  type ExportBundleInput,
  type ExportTable,
} from "@/lib/export";
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
  closeoutLeftoverDecisions,
  courseInquiries,
  courses,
  crewAssignmentRequests,
  crewAvailabilityBlocks,
  divePackageEntitlements,
  divePackages,
  diveSiteCreatures,
  diveSiteMoments,
  diveSites,
  diveSupportNeeds,
  executedDives,
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
  preDepartureCheckEvents,
  preDepartureChecklistItems,
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
  staffCredentials,
  staffShifts,
  tips,
  tripAssignments,
  tripChangeEvents,
  tripDives,
  tripHelpRequests,
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
  waiverMaterialityDecisions,
  waiverRecords,
  waiverTemplates,
} from "./schema";

/**
 * "Best card" for the flat contacts file: verified evidence before pending
 * claims, then the highest rung — a shop leaving with this file should hand
 * its next system the strongest honest claim per diver.
 */
function bestCertification<
  Card extends {
    level: (typeof certificationLevel.enumValues)[number];
    status: string;
  },
>(cards: Card[]): Card | undefined {
  const rank = (card: Card) =>
    (card.status === "verified" ? 1000 : 0) + certificationLevel.enumValues.indexOf(card.level);
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
  _now: Date = nowDate(),
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

      // The shop's own price list of prepaid packages, and every dive a diver
      // has bought and not yet taken (ADR
      // 20260822-a-package-is-entitlements-not-money). Both are shop records by
      // the export rule's own test — neither is a credential, an infrastructure
      // pointer, nor DiveDay's bookkeeping about its own machinery — and the
      // entitlements are the sharper of the two: they are money a diver has
      // already handed over, so a bundle without them describes a shop that
      // owes nobody anything.
      const divePackageRows = await tx
        .select()
        .from(divePackages)
        .where(eq(divePackages.shopId, shopId))
        .orderBy(asc(divePackages.createdAt), asc(divePackages.id));
      const entitlementRows = await tx
        .select()
        .from(divePackageEntitlements)
        .where(eq(divePackageEntitlements.shopId, shopId))
        .orderBy(asc(divePackageEntitlements.createdAt), asc(divePackageEntitlements.id));

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

      // diveday:allow-deleted-trips: the bundle is the shop taking everything it
      // has, tombstones included — a departure they deleted is still a row they
      // own, and a backup that quietly drops rows is not a backup. The same
      // applies to the three child joins below, which read through this bundle's
      // own trip set rather than the board.
      const tripRows = await tx
        .select()
        .from(trips)
        .where(eq(trips.shopId, shopId))
        .orderBy(asc(trips.startsAt), asc(trips.id));
      const tripTitle = new Map(tripRows.map((row) => [row.id, row.title]));
      const tripStartsAt = new Map(tripRows.map((row) => [row.id, row.startsAt]));

      const tripChangeEventRows = await tx
        .select()
        .from(tripChangeEvents)
        .where(eq(tripChangeEvents.shopId, shopId))
        .orderBy(
          asc(tripChangeEvents.occurredAt),
          asc(tripChangeEvents.seq),
          asc(tripChangeEvents.id),
        );

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

      // The crew's own two tables (issue #1235). Live rows only: a withdrawn
      // ask and a deleted holiday are not the shop's roster.
      const crewAwayRows = await tx
        .select()
        .from(crewAvailabilityBlocks)
        .where(
          and(eq(crewAvailabilityBlocks.shopId, shopId), isNull(crewAvailabilityBlocks.deletedAt)),
        )
        .orderBy(asc(crewAvailabilityBlocks.startsOn), asc(crewAvailabilityBlocks.id));

      const crewRequestRows = await tx
        .select()
        .from(crewAssignmentRequests)
        .where(
          and(eq(crewAssignmentRequests.shopId, shopId), isNull(crewAssignmentRequests.deletedAt)),
        )
        .orderBy(asc(crewAssignmentRequests.requestedAt), asc(crewAssignmentRequests.id));

      const staffCredentialRows = await tx
        .select()
        .from(staffCredentials)
        .where(eq(staffCredentials.shopId, shopId))
        .orderBy(asc(staffCredentials.createdAt), asc(staffCredentials.id));

      const bookingRows = await tx
        .select()
        .from(bookings)
        .where(eq(bookings.shopId, shopId))
        .orderBy(asc(bookings.createdAt), asc(bookings.id));
      const bookingPerson = new Map(bookingRows.map((row) => [row.id, row.personId]));

      const tripHelpRequestRows = await tx
        .select()
        .from(tripHelpRequests)
        .where(eq(tripHelpRequests.shopId, shopId))
        .orderBy(asc(tripHelpRequests.createdAt), asc(tripHelpRequests.id));

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

      const executedDiveRows = await tx
        .select()
        .from(executedDives)
        .where(eq(executedDives.shopId, shopId))
        .orderBy(asc(executedDives.tripId), asc(executedDives.diveNumber));

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

      const waiverMaterialityRows = await tx
        .select()
        .from(waiverMaterialityDecisions)
        .where(eq(waiverMaterialityDecisions.shopId, shopId))
        .orderBy(asc(waiverMaterialityDecisions.seq));

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

      const supportNeedsRows = await tx
        .select()
        .from(diveSupportNeeds)
        .where(eq(diveSupportNeeds.shopId, shopId))
        .orderBy(asc(diveSupportNeeds.createdAt), asc(diveSupportNeeds.id));

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
        .orderBy(
          asc(gearServiceEvents.servicedOn),
          asc(gearServiceEvents.createdAt),
          // The id tiebreaker keeps the bundle diffable when a batch write
          // lands several events on one timestamp (see rollCallEvents above).
          asc(gearServiceEvents.id),
        );

      const gearReservationRows = await tx
        .select()
        .from(gearReservations)
        .where(eq(gearReservations.shopId, shopId))
        .orderBy(
          asc(gearReservations.reservedFrom),
          asc(gearReservations.createdAt),
          asc(gearReservations.id),
        );

      const closeoutLeftoverDecisionRows = await tx
        .select()
        .from(closeoutLeftoverDecisions)
        .where(eq(closeoutLeftoverDecisions.shopId, shopId))
        .orderBy(asc(closeoutLeftoverDecisions.seq));

      const checklistItemRows = await tx
        .select()
        .from(preDepartureChecklistItems)
        .where(eq(preDepartureChecklistItems.shopId, shopId))
        .orderBy(
          asc(preDepartureChecklistItems.sortOrder),
          asc(preDepartureChecklistItems.createdAt),
        );
      const checklistItemLabel = new Map(checklistItemRows.map((row) => [row.id, row.label]));

      const checklistEventRows = await tx
        .select()
        .from(preDepartureCheckEvents)
        .where(eq(preDepartureCheckEvents.shopId, shopId))
        .orderBy(
          asc(preDepartureCheckEvents.occurredAt),
          asc(preDepartureCheckEvents.createdAt),
          asc(preDepartureCheckEvents.seq),
        );

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
       * certified yet — unverified", restated here rather than called because
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
        ...tripRows.map((row) => row.arrivalPhotoUrl),
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
            "tax_enabled",
            "pass_through_fee",
            "conservation_commitments",
            "medical_jurisdiction",
            "depth_unit",
            "temperature_unit",
            "has_boat_diving",
            "has_shore_diving",
            "has_pool_diving",
            // The shop's target diver-to-divemaster ratio, stored as the divers
            // half (ADR 20260820-shop-divemaster-ratio). The bundle is also the
            // backup, and a shop restoring from one must come back planning and
            // crewing against its own number rather than the default.
            "divers_per_divemaster",
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
            // The shop's own emergency numbers. Exported because the bundle is
            // the backup: a shop restoring from one must come back with the
            // chamber's number on its manifests, not an empty card.
            "emergency_reference",
            // The hours its automated messages may reach a diver
            // (`src/lib/send-window.ts`). Exported because restoring from a
            // backup must not silently put a shop back on the default and start
            // texting at hours it had deliberately ruled out.
            "send_window_start_hour",
            "send_window_end_hour",
            // Whether the shop asked to stay out of search engines
            // (ADR 20260813-search-listing-is-a-choice). Exported because the
            // bundle is also the *backup*: a shop that opted out and later
            // restored from one must not come back published.
            "search_listing_opt_out_at",
            "conservation_commitments",
            "tagline",
            "description",
            "logo_url",
            "brand_color",
            "brand_display_font",
            "brand_hero_image_url",
            "brand_hero_image_alt",
            "established_year",
            "brand_badges",
            "created_at",
          ],
          rows: [
            [
              shop.name,
              shop.slug,
              shop.timezone,
              shop.defaultLocale,
              shop.currency,
              shop.taxEnabled,
              JSON.stringify(shop.passThroughFee),
              JSON.stringify(shop.conservationCommitments),
              shop.jurisdiction,
              shop.depthUnit,
              shop.temperatureUnit,
              shop.hasBoatDiving,
              shop.hasShoreDiving,
              shop.hasPoolDiving,
              shop.diversPerDivemaster,
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
              JSON.stringify(shop.emergencyReference),
              shop.sendWindowStartHour,
              shop.sendWindowEndHour,
              shop.searchListingOptOutAt,
              JSON.stringify(shop.conservationCommitments),
              shop.tagline,
              shop.description,
              shop.logoUrl,
              shop.brandColor,
              shop.brandDisplayFont,
              shop.brandHeroImageUrl,
              shop.brandHeroImageAlt,
              shop.establishedYear,
              JSON.stringify(shop.brandBadges),
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
            "deleted_at",
            "created_at",
          ],
          rows: peopleRows.map((row) => {
            const name = splitName(row.fullName);
            const card = bestCertification(cardsByPerson.get(row.id) ?? []);
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
            // Staff-only in practice — set from the team settings form — but
            // the column lives on every row (issue #708), so it dumps here
            // like every other fact this file carries regardless of who it's
            // ever actually populated for.
            "spoken_languages",
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
            // A merged-away row remains in the normalized export as a
            // redirect, so an audit or destination import can preserve the
            // original person id without resurrecting the duplicate.
            "merged_into_person_id",
            "merged_at",
            "merged_by_person_id",
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
            row.spokenLanguages.length > 0 ? [...row.spokenLanguages].sort().join("; ") : null,
            row.courtesyEmailOptOutAt,
            row.noCertificationDeclaredAt,
            row.noCertificationClearedAt,
            row.noCertificationClearedByPersonId,
            row.deletedAt,
            row.anonymizedAt,
            row.anonymizedByPersonId,
            row.mergedIntoPersonId,
            row.mergedAt,
            row.mergedByPersonId,
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
            // The number the *diver* typed, which is never the number above: one
            // is a claim and one is what the shop holds, and a file that
            // merged them would launder the first into the second on the way
            // back in (issue #630).
            "declared_identifier",
            "status",
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
            // A third provenance, alongside imported_at and self_declared_at
            // above: a non-null issued_by_shop_at means this shop's own
            // instructor certified the diver from a course session's roster
            // (issue #717), never a captured or self-declared card.
            // issued_from_trip_id names that session; issued_by_person_id
            // names the instructor. Same reasoning as the other two
            // provenance stamps — dropping any of the three from the export
            // would launder one kind of card into another on the way back in.
            "issued_by_shop_at",
            "issued_from_trip_id",
            "issued_by_person_id",
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
            row.declaredIdentifier,
            row.status,
            row.reviewNote,
            row.reviewedAt,
            row.reviewedByPersonId,
            row.importedAt,
            row.importedFromLabel,
            row.selfDeclaredAt,
            row.issuedByShopAt,
            row.issuedFromTripId,
            row.issuedByPersonId,
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
            // Where this departure meets, when it isn't the shop's own front
            // door (issue #704 slice 2) — both empty means "the shop".
            "meeting_point_label",
            "meeting_point_address",
            "arrival_landmark",
            "arrival_parking_note",
            "arrival_transit_note",
            "arrival_look_for",
            "arrival_first_interaction",
            "arrival_photo_url",
            "is_private",
            // The shop's own answer about this departure, not a derived fact,
            // so it leaves with the shop (issue #973).
            "self_guided",
            // The bundle carries deleted departures (they are still the shop's
            // rows), so it has to carry the stamp that says which — a file that
            // hands back a deleted departure looking live is worse than one
            // that left it out.
            "deleted_at",
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
            row.meetingPointLabel,
            row.meetingPointAddress,
            row.arrivalLandmark,
            row.arrivalParkingNote,
            row.arrivalTransitNote,
            row.arrivalLookFor,
            row.arrivalFirstInteraction,
            row.arrivalPhotoUrl,
            row.isPrivate,
            row.selfGuided,
            row.deletedAt,
            row.createdAt,
          ]),
          note: EXPORT_FILE_NOTES["trips.csv"],
        },
        {
          file: "trip_change_events.csv",
          header: [
            "id",
            "trip_id",
            "trip_title",
            "trip_starts_at",
            "kind",
            "source",
            "before_value",
            "after_value",
            "actor_person_id",
            "actor_name",
            "occurred_at",
            "seq",
          ],
          rows: tripChangeEventRows.map((row) => [
            row.id,
            row.tripId,
            tripTitle.get(row.tripId),
            tripStartsAt.get(row.tripId),
            row.kind,
            row.source,
            row.beforeValue ? JSON.stringify(row.beforeValue) : null,
            JSON.stringify(row.afterValue),
            row.actorPersonId,
            row.actorPersonId ? personName.get(row.actorPersonId) : null,
            row.occurredAt,
            row.seq,
          ]),
          note: EXPORT_FILE_NOTES["trip_change_events.csv"],
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
          file: "crew_availability_blocks.csv",
          header: [
            "id",
            "person_id",
            "person_name",
            "starts_on",
            "ends_on",
            "note",
            "created_by_person_id",
            "created_by_name",
            "created_at",
          ],
          rows: crewAwayRows.map((row) => [
            row.id,
            row.personId,
            personName.get(row.personId),
            row.startsOn,
            row.endsOn,
            row.note,
            row.createdByPersonId,
            personName.get(row.createdByPersonId),
            row.createdAt,
          ]),
          note: EXPORT_FILE_NOTES["crew_availability_blocks.csv"],
        },
        {
          file: "crew_assignment_requests.csv",
          header: [
            "id",
            "trip_id",
            "trip_title",
            "person_id",
            "person_name",
            "requested_at",
            "decision",
            "decided_at",
            "decided_by_person_id",
            "decided_by_name",
            "created_at",
          ],
          rows: crewRequestRows.map((row) => [
            row.id,
            row.tripId,
            tripTitle.get(row.tripId),
            row.personId,
            personName.get(row.personId),
            row.requestedAt,
            row.decision,
            row.decidedAt,
            row.decidedByPersonId,
            row.decidedByPersonId ? personName.get(row.decidedByPersonId) : null,
            row.createdAt,
          ]),
          note: EXPORT_FILE_NOTES["crew_assignment_requests.csv"],
        },
        {
          file: "staff_credentials.csv",
          header: [
            "id",
            "person_id",
            "person_name",
            "kind",
            "name",
            "issuing_body",
            "identifier",
            "issued_at",
            "renews_at",
            "status",
            "review_note",
            "reviewed_at",
            "reviewed_by_person_id",
            "deleted_at",
            "deleted_by_person_id",
            "created_at",
            "updated_at",
          ],
          rows: staffCredentialRows.map((row) => [
            row.id,
            row.personId,
            personName.get(row.personId),
            row.kind,
            row.name,
            row.issuingBody,
            row.identifier,
            row.issuedAt,
            row.renewsAt,
            row.status,
            row.reviewNote,
            row.reviewedAt,
            row.reviewedByPersonId,
            row.deletedAt,
            row.deletedByPersonId,
            row.createdAt,
            row.updatedAt,
          ]),
          note: EXPORT_FILE_NOTES["staff_credentials.csv"],
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
            // The diver's own answer to "when did you last dive?" (ADR
            // 20260821-currency-is-what-catches-people). A statement they made
            // about themselves, on the seat they made it for — the same kind of
            // record as `group_preference` beside it, and a shop moving its data
            // elsewhere should not have to ask every returning diver again.
            "last_dived_band",
            // The party structure a shop booked (ADR 20260804-seat-claim-links).
            // Both are real records of what happened to a seat, so both travel:
            // `party_lead_booking_id` is a booking id from this same file's `id`
            // column, and `claimed_at` sits alongside `conditions_briefed_at` as
            // another plain fact about the seat. Dropping either would let a shop
            // export a party of six and get back six unrelated singles.
            "party_lead_booking_id",
            "claimed_at",
            "hotel_pickup_location",
            "pickup_time",
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
              row.lastDivedBand,
              row.partyLeadBookingId,
              row.claimedAt,
              row.hotelPickupLocation,
              row.pickupTime,
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
          file: "trip_help_requests.csv",
          header: [
            "id",
            "trip_id",
            "trip_title",
            "trip_starts_at",
            "booking_id",
            "person_id",
            "person_name",
            "kind",
            "status",
            "created_at",
            "updated_at",
            "acknowledged_at",
            "handled_at",
            "resolved_by_person_id",
            "resolved_by_name",
          ],
          rows: tripHelpRequestRows.map((row) => {
            const personId = bookingPerson.get(row.bookingId) ?? null;
            return [
              row.id,
              row.tripId,
              tripTitle.get(row.tripId),
              tripStartsAt.get(row.tripId),
              row.bookingId,
              personId,
              personId ? personName.get(personId) : null,
              row.kind,
              row.status,
              row.createdAt,
              row.updatedAt,
              row.acknowledgedAt,
              row.handledAt,
              row.resolvedByPersonId,
              row.resolvedByPersonId ? personName.get(row.resolvedByPersonId) : null,
            ];
          }),
          note: EXPORT_FILE_NOTES["trip_help_requests.csv"],
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
            "pass_through_cents",
            "tax_enabled",
            "tax_cents",
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
            row.passThroughCents,
            row.taxEnabled,
            row.taxCents,
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
          header: [
            "checkout_id",
            "booking_id",
            "person_id",
            "person_name",
            "trip_cents",
            "gear_cents",
            "pass_through_cents",
            "tax_cents",
          ],
          rows: checkoutBookingRows.map((row) => {
            const personId = bookingPerson.get(row.bookingId) ?? null;
            return [
              row.checkoutId,
              row.bookingId,
              personId,
              personId ? personName.get(personId) : null,
              row.tripCents,
              row.gearCents,
              row.passThroughCents,
              row.taxCents,
            ];
          }),
          note: EXPORT_FILE_NOTES["booking_checkout_bookings.csv"],
        },
        {
          file: "executed_dives.csv",
          header: [
            "id",
            "trip_id",
            "trip_title",
            "dive_number",
            "actual_site_id",
            "actual_site_name",
            "entered_at",
            "exited_at",
            "max_depth_meters",
            "observed_conditions",
            "not_recorded",
            "recorded_by_person_id",
            "deleted_at",
            "created_at",
            "updated_at",
          ],
          rows: executedDiveRows.map((row) => [
            row.id,
            row.tripId,
            tripTitle.get(row.tripId),
            row.diveNumber,
            row.actualSiteId,
            row.actualSiteId ? siteName.get(row.actualSiteId) : null,
            row.enteredAt,
            row.exitedAt,
            row.maxDepthMeters,
            JSON.stringify(row.observedConditions),
            JSON.stringify(row.notRecorded),
            row.recordedByPersonId,
            row.deletedAt,
            row.createdAt,
            row.updatedAt,
          ]),
          note: EXPORT_FILE_NOTES["executed_dives.csv"],
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
          header: [
            "id",
            "title",
            "version",
            "material_generation",
            "deleted_at",
            "created_at",
            "body",
          ],
          rows: templateRows.map((row) => [
            row.id,
            row.title,
            row.version,
            row.materialGeneration,
            row.deletedAt,
            row.createdAt,
            row.body,
          ]),
          note: EXPORT_FILE_NOTES["waiver_templates.csv"],
        },
        {
          file: "waiver_materiality_decisions.csv",
          header: [
            "id",
            "template_id",
            "template_title",
            "material",
            "actor_person_id",
            "actor_name",
            "decided_at",
            "seq",
          ],
          rows: waiverMaterialityRows.map((row) => [
            row.id,
            row.templateId,
            templateRows.find((template) => template.id === row.templateId)?.title,
            row.material,
            row.actorPersonId,
            personName.get(row.actorPersonId),
            row.decidedAt,
            row.seq,
          ]),
          note: EXPORT_FILE_NOTES["waiver_materiality_decisions.csv"],
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
            "template_generation",
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
            // The physician clearance that ends a medical hold (issue #1252).
            // Its *document* is deliberately not here — see EXCLUDED_COLUMNS in
            // src/db/export.test.ts — but the fact and its accountable staff
            // member are the shop's own evidence, and a restore that lost them
            // would re-block every cleared diver with no record of who cleared
            // them or when the physician evaluated them.
            "medical_cleared_at",
            "medical_cleared_by_person_id",
            "medical_cleared_by_name",
            "medical_clearance_evaluated_on",
            "medical_clearance_physician_name",
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
            row.templateGeneration,
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
            row.medicalClearedAt,
            row.medicalClearedByPersonId,
            row.medicalClearedByPersonId ? personName.get(row.medicalClearedByPersonId) : null,
            row.medicalClearanceEvaluatedOn,
            row.medicalClearancePhysicianName,
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
          file: "dive_support_needs.csv",
          header: [
            "person_id",
            "person_name",
            "support_divers_needed",
            "support_divers_provided_by",
            "needs_boarding_assistance",
            "needs_water_lift",
            "briefing_in_sign",
            "briefing_in_writing",
            "briefing_aloud",
            "briefing_by_signals",
            "equipment_adaptation",
            "dives_with_name",
            // When the diver last answered. Every boolean beside it defaults to
            // false, so without this an all-false row and a row nobody ever
            // filled in read identically — and "nothing needed" and "nobody
            // asked" are different facts.
            "stated_at",
            "updated_at",
          ],
          rows: supportNeedsRows.map((row) => [
            row.personId,
            personName.get(row.personId),
            row.supportDiversNeeded,
            row.supportDiversProvidedBy,
            row.needsBoardingAssistance,
            row.needsWaterLift,
            row.briefingInSign,
            row.briefingInWriting,
            row.briefingAloud,
            row.briefingBySignals,
            row.equipmentAdaptation,
            row.divesWithName,
            row.statedAt,
            row.updatedAt,
          ]),
          note: EXPORT_FILE_NOTES["dive_support_needs.csv"],
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
            "deleted_at",
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
            row.deletedAt,
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
            "next_due_dives",
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
            row.nextDueDives,
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
            "person_id",
            "person_name",
            "reserved_from",
            "reserved_until",
            "checked_out_at",
            "returned_at",
            "return_note",
            "created_at",
          ],
          rows: gearReservationRows.map((row) => {
            const holderPersonId =
              row.personId ?? (row.bookingId ? (bookingPerson.get(row.bookingId) ?? null) : null);
            return [
              row.id,
              row.gearItemId,
              gearItemLabel.get(row.gearItemId),
              row.bookingId,
              row.personId,
              holderPersonId ? personName.get(holderPersonId) : null,
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
          file: "closeout_leftover_decisions.csv",
          header: [
            "id",
            "shop_day",
            "action_id",
            "decision",
            "actor_person_id",
            "actor_name",
            "decided_at",
            "seq",
          ],
          rows: closeoutLeftoverDecisionRows.map((row) => [
            row.id,
            row.shopDay,
            row.actionId,
            row.decision,
            row.actorPersonId,
            personName.get(row.actorPersonId),
            row.decidedAt,
            row.seq,
          ]),
          note: EXPORT_FILE_NOTES["closeout_leftover_decisions.csv"],
        },
        {
          file: "pre_departure_checklist_items.csv",
          header: ["id", "label", "sort_order", "deleted_at", "created_at", "updated_at"],
          rows: checklistItemRows.map((row) => [
            row.id,
            row.label,
            row.sortOrder,
            row.deletedAt,
            row.createdAt,
            row.updatedAt,
          ]),
          note: EXPORT_FILE_NOTES["pre_departure_checklist_items.csv"],
        },
        {
          file: "pre_departure_check_events.csv",
          header: [
            "id",
            "trip_id",
            "checklist_item_id",
            "checklist_item_label",
            "status",
            "source",
            "client_event_id",
            "note",
            "recorded_by_person_id",
            "recorded_by_name",
            "occurred_at",
            "created_at",
          ],
          rows: checklistEventRows.map((row) => [
            row.id,
            row.tripId,
            row.checklistItemId,
            checklistItemLabel.get(row.checklistItemId),
            row.status,
            row.source,
            row.clientEventId,
            row.note,
            row.recordedByPersonId,
            personName.get(row.recordedByPersonId),
            row.occurredAt,
            row.createdAt,
          ]),
          note: EXPORT_FILE_NOTES["pre_departure_check_events.csv"],
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
            "subject_person_id",
            "subject_name",
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
            row.subjectPersonId,
            row.subjectPersonId ? personName.get(row.subjectPersonId) : null,
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
            "pass_through_cents",
            "tax_cents",
            "amount_paid_cents",
            "refunded_cents",
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
            row.passThroughCents,
            row.taxCents,
            row.amountPaidCents,
            row.refundedCents,
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
            "conservation_note",
            "fit_tone",
            "fit_note",
            "conservation_note",
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
            row.conservationNote,
            row.fitTone,
            row.fitNote,
            row.conservationNote,
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
          file: "dive_packages.csv",
          header: [
            "id",
            "name",
            "dive_count",
            "price_cents",
            "scope",
            "valid_until",
            "deleted_at",
            "created_by_person_id",
            "created_at",
          ],
          rows: divePackageRows.map((row) => [
            row.id,
            row.name,
            row.diveCount,
            row.priceCents,
            row.scope,
            row.validUntil,
            row.deletedAt,
            row.createdByPersonId,
            row.createdAt,
          ]),
          note: EXPORT_FILE_NOTES["dive_packages.csv"],
        },
        {
          file: "dive_package_entitlements.csv",
          header: [
            "id",
            "package_id",
            "person_id",
            "order_id",
            "booking_id",
            "consumed_at",
            "expires_at",
            "created_at",
          ],
          rows: entitlementRows.map((row) => [
            row.id,
            row.packageId,
            row.personId,
            row.orderId,
            row.bookingId,
            row.consumedAt,
            row.expiresAt,
            row.createdAt,
          ]),
          note: EXPORT_FILE_NOTES["dive_package_entitlements.csv"],
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

/**
 * Everything this shop holds about **one** diver — the subject-access-request
 * answer #726 asked for (ADR 20260824-diver-record-export). `loadShopExportBundleInput`
 * above is the whole shop; this is a where-clause and a smaller bundle over
 * the same tables, never a second exporter, per the issue's own instruction.
 *
 * ## The shared-row decisions
 *
 * The hard part of a per-diver export is never the diver's own rows — it is
 * the rows several people share. Each of the following was a deliberate call,
 * not a default, because a bundle that leaks another diver's name is the
 * failure this feature exists to prevent:
 *
 * - **A party booking's `party_lead_booking_id`** points at a *different*
 *   diver's booking row. It carries no name on its own, but it is a foreign
 *   key this diver has no business holding, so it is blanked in `bookings.csv`
 *   rather than exported as-is.
 * - **A buddy team's other members** live as separate rows in
 *   `buddy_pair_members`, keyed by a different `booking_id`/`crew_person_id`.
 *   Filtering to this diver's own bookings (and, if they are also staff, their
 *   own `crew_person_id`) naturally yields only their own membership row per
 *   team — never another member's — so `buddy_pairs.csv` is included as-is.
 * - **Roll-call `recorded_by`, order `created_by`, buddy-pair `paired_by`,
 *   waiver `recorded_by`** are staff, not other divers. Included by name, on
 *   the same rule the shop's own bundle uses: the shop's record of who did
 *   what is the shop's own, not a third party's.
 * - **`internal_notes`** is excluded outright. Its own note in the shop bundle
 *   already says why: "Never shown to a diver, and never part of any gate" —
 *   and its `body` is free text that can name a *different* diver by name
 *   (`anonymize.ts`'s erasure sweep needs a fuzzy word-boundary regex over
 *   exactly this column for exactly this reason).
 * - **`activity_events`** is excluded outright for the same reason at larger
 *   scale: its `message` column is English prose generated at write time that
 *   routinely interpolates a full name — often someone else's, on a shared
 *   booking or a roll-call line. Safely redacting it needs the same
 *   name-matching sweep the erasure path uses, which is expensive to
 *   replicate correctly here; this is recorded as a follow-up rather than
 *   reinvented under this diff.
 * - **`booking_checkouts`** is excluded outright. One checkout attempt can
 *   cover an entire party sharing one Stripe session, so `customer_email` may
 *   belong to whoever submitted the payment rather than this diver, and the
 *   totals are the party's, not theirs. `booking_checkout_bookings.csv` — the
 *   per-seat line within a checkout — carries none of that risk (it is
 *   already one row per person) and is included.
 * - **Shop-wide configuration** (the trip catalog, the course catalog, dive
 *   sites, gear fleet, promo codes) never named this diver in the first
 *   place and is out of scope by construction, not by a redaction.
 * - **`orders.description` / `order_line_items.description`** are also
 *   staff-typed free text (the invoice form's own note field) and dropped for
 *   the same reason `internal_notes` is — found in security review rather
 *   than the first pass, and covered by a regression test that builds an
 *   order carrying another diver's name in that field.
 *
 * ## What is included but incomplete on purpose
 *
 * `waiver_records.csv` **omits `medical_answers`.** The shop-wide export's own
 * comment on that column doesn't apply the other way: whether a subject access
 * request should receive the diver's own medical answers is a real question,
 * not an engineering default, and it belongs with H-01/H-03's legal review —
 * see `docs/product/human-decisions.md`. Every other column of a diver's own
 * signed evidence (status, signature, timestamps, template text) ships now.
 * The same hold extends to `photoUrls`: an imported record's
 * `importSourceMedicalDocumentUrl` (a re-stored scan of the same medical
 * intake form) is never bundled, while `importSourceDocumentUrl` (the general
 * signed release) is — a scanned document is medical evidence with a file
 * extension rather than a JSON key, and the JSON column being withheld does
 * not by itself withhold the document it came with.
 *
 * ## Tenant + subject scoping
 *
 * Every query below is scoped to `shopId` **and** to this `personId` (or to a
 * booking/order/review id already proven to belong to them) — there is no
 * query in this function that reads a table by `shopId` alone.
 */
export async function loadDiverExportBundleInput(
  db: AppDb,
  shopId: string,
  personId: string,
  _now: Date = nowDate(),
): Promise<DiverExportBundleInput | null> {
  return db.transaction(
    async (tx) => {
      const [person] = await tx
        .select()
        .from(people)
        .where(and(eq(people.id, personId), eq(people.shopId, shopId)))
        .limit(1);
      if (!person) return null;
      const [shop] = await tx.select().from(shops).where(eq(shops.id, shopId)).limit(1);
      if (!shop) return null;

      // The spine every via-booking table below joins against.
      // diveday:allow-deleted-trips: a booking on a departure the shop later
      // deleted is still the diver's own booking history — dropping it from
      // their own export would be exactly the "migration loses data" failure
      // the shop bundle's own rule refuses, applied to a bundle of one.
      const bookingRows = await tx
        .select()
        .from(bookings)
        .where(and(eq(bookings.shopId, shopId), eq(bookings.personId, personId)))
        .orderBy(asc(bookings.createdAt), asc(bookings.id));
      const bookingIds = bookingRows.map((row) => row.id);
      const tripIds = [...new Set(bookingRows.map((row) => row.tripId))];
      const tripRows = tripIds.length
        ? await tx
            .select()
            .from(trips)
            .where(and(inArray(trips.id, tripIds), eq(trips.shopId, shopId)))
        : [];
      const tripTitle = new Map(tripRows.map((row) => [row.id, row.title]));
      const tripStartsAt = new Map(tripRows.map((row) => [row.id, row.startsAt]));

      const paymentRows = bookingIds.length
        ? await tx
            .select()
            .from(bookingPayments)
            .where(
              and(
                eq(bookingPayments.shopId, shopId),
                inArray(bookingPayments.bookingId, bookingIds),
              ),
            )
        : [];
      const paymentByBooking = new Map(paymentRows.map((row) => [row.bookingId, row]));

      // Everyone this bundle might need to *name* besides the diver — a
      // staffer who recorded a roll call, moderated a review, or paired a
      // buddy team. Used only to resolve a name string onto the diver's own
      // rows below; no other person's row is ever written to a file (see the
      // shared-row decisions above).
      const staffRows = await tx.select().from(people).where(eq(people.shopId, shopId));
      const personName = new Map(staffRows.map((row) => [row.id, row.fullName]));

      const certificationRows = await tx
        .select()
        .from(certifications)
        .where(and(eq(certifications.shopId, shopId), eq(certifications.personId, personId)))
        .orderBy(asc(certifications.createdAt), asc(certifications.id));

      const specialtyRows = await tx
        .select()
        .from(specialtyCertifications)
        .where(
          and(
            eq(specialtyCertifications.shopId, shopId),
            eq(specialtyCertifications.personId, personId),
          ),
        )
        .orderBy(asc(specialtyCertifications.createdAt), asc(specialtyCertifications.id));

      const nitroxRows = await tx
        .select()
        .from(nitroxCertifications)
        .where(
          and(eq(nitroxCertifications.shopId, shopId), eq(nitroxCertifications.personId, personId)),
        )
        .orderBy(asc(nitroxCertifications.createdAt), asc(nitroxCertifications.id));

      const waitlistRows = await tx
        .select()
        .from(tripWaitlistEntries)
        .where(
          and(eq(tripWaitlistEntries.shopId, shopId), eq(tripWaitlistEntries.personId, personId)),
        )
        .orderBy(asc(tripWaitlistEntries.createdAt), asc(tripWaitlistEntries.id));

      const invitationRows = await tx
        .select()
        .from(tripInvitations)
        .where(and(eq(tripInvitations.shopId, shopId), eq(tripInvitations.personId, personId)))
        .orderBy(asc(tripInvitations.createdAt), asc(tripInvitations.id));

      const lastMinuteListRows = await tx
        .select()
        .from(lastMinuteListEntries)
        .where(
          and(
            eq(lastMinuteListEntries.shopId, shopId),
            eq(lastMinuteListEntries.personId, personId),
          ),
        )
        .orderBy(asc(lastMinuteListEntries.createdAt), asc(lastMinuteListEntries.id));

      const lastMinutePromoRecipientRows = await tx
        .select()
        .from(tripLastMinutePromoRecipients)
        .where(
          and(
            eq(tripLastMinutePromoRecipients.shopId, shopId),
            eq(tripLastMinutePromoRecipients.personId, personId),
          ),
        )
        .orderBy(
          asc(tripLastMinutePromoRecipients.createdAt),
          asc(tripLastMinutePromoRecipients.id),
        );

      const paymentEventRows = bookingIds.length
        ? await tx
            .select()
            .from(bookingPaymentEvents)
            .where(
              and(
                eq(bookingPaymentEvents.shopId, shopId),
                inArray(bookingPaymentEvents.bookingId, bookingIds),
              ),
            )
            .orderBy(asc(bookingPaymentEvents.occurredAt), asc(bookingPaymentEvents.id))
        : [];

      const checkoutBookingRows = bookingIds.length
        ? await tx
            .select()
            .from(bookingCheckoutBookings)
            .where(
              and(
                eq(bookingCheckoutBookings.shopId, shopId),
                inArray(bookingCheckoutBookings.bookingId, bookingIds),
              ),
            )
            .orderBy(
              asc(bookingCheckoutBookings.checkoutId),
              asc(bookingCheckoutBookings.bookingId),
            )
        : [];

      const rollCallRows = bookingIds.length
        ? await tx
            .select()
            .from(rollCallEvents)
            .where(
              and(eq(rollCallEvents.shopId, shopId), inArray(rollCallEvents.bookingId, bookingIds)),
            )
            .orderBy(asc(rollCallEvents.occurredAt), asc(rollCallEvents.seq))
        : [];

      // Either this diver's own seat, or — if they are also a staff member —
      // a team they were recorded as crewing. Two rows can never collide: a
      // member row is one or the other, never both.
      const buddyPairRows = await tx
        .select()
        .from(buddyPairMembers)
        .where(
          and(
            eq(buddyPairMembers.shopId, shopId),
            or(
              bookingIds.length ? inArray(buddyPairMembers.bookingId, bookingIds) : undefined,
              eq(buddyPairMembers.crewPersonId, personId),
            ),
          ),
        )
        .orderBy(asc(buddyPairMembers.createdAt), asc(buddyPairMembers.pairId));

      const notificationRows = bookingIds.length
        ? await tx
            .select()
            .from(notificationDeliveries)
            .where(
              and(
                eq(notificationDeliveries.shopId, shopId),
                inArray(notificationDeliveries.bookingId, bookingIds),
              ),
            )
            .orderBy(asc(notificationDeliveries.attemptedAt), asc(notificationDeliveries.id))
        : [];

      const orderRows = await tx
        .select()
        .from(orders)
        .where(and(eq(orders.shopId, shopId), eq(orders.personId, personId)))
        .orderBy(asc(orders.createdAt), asc(orders.id));
      const orderIds = orderRows.map((row) => row.id);
      const orderLineRows = orderIds.length
        ? await tx
            .select()
            .from(orderLineItems)
            .where(
              and(eq(orderLineItems.shopId, shopId), inArray(orderLineItems.orderId, orderIds)),
            )
            .orderBy(
              asc(orderLineItems.orderId),
              asc(orderLineItems.createdAt),
              asc(orderLineItems.id),
            )
        : [];

      const tipRows = bookingIds.length
        ? await tx
            .select()
            .from(tips)
            .where(and(eq(tips.shopId, shopId), inArray(tips.bookingId, bookingIds)))
            .orderBy(asc(tips.createdAt), asc(tips.id))
        : [];

      const recapPhotoRows = bookingIds.length
        ? await tx
            .select()
            .from(recapPhotos)
            .where(and(eq(recapPhotos.shopId, shopId), inArray(recapPhotos.bookingId, bookingIds)))
            .orderBy(asc(recapPhotos.createdAt), asc(recapPhotos.id))
        : [];

      const reviewRows = await tx
        .select()
        .from(tripReviews)
        .where(and(eq(tripReviews.shopId, shopId), eq(tripReviews.personId, personId)))
        .orderBy(asc(tripReviews.createdAt), asc(tripReviews.id));
      const reviewIds = reviewRows.map((row) => row.id);
      const reviewModerationRows = reviewIds.length
        ? await tx
            .select()
            .from(reviewModerationEvents)
            .where(
              and(
                eq(reviewModerationEvents.shopId, shopId),
                inArray(reviewModerationEvents.reviewId, reviewIds),
              ),
            )
            .orderBy(asc(reviewModerationEvents.occurredAt), asc(reviewModerationEvents.id))
        : [];

      const entitlementRows = await tx
        .select()
        .from(divePackageEntitlements)
        .where(
          and(
            eq(divePackageEntitlements.shopId, shopId),
            eq(divePackageEntitlements.personId, personId),
          ),
        )
        .orderBy(asc(divePackageEntitlements.createdAt), asc(divePackageEntitlements.id));
      const packageIds = [...new Set(entitlementRows.map((row) => row.packageId))];
      const packageRows = packageIds.length
        ? await tx
            .select()
            .from(divePackages)
            .where(and(inArray(divePackages.id, packageIds), eq(divePackages.shopId, shopId)))
        : [];
      const packageName = new Map(packageRows.map((row) => [row.id, row.name]));

      const rentalFitRows = await tx
        .select()
        .from(rentalFitProfiles)
        .where(and(eq(rentalFitProfiles.shopId, shopId), eq(rentalFitProfiles.personId, personId)));

      const supportNeedsRows = await tx
        .select()
        .from(diveSupportNeeds)
        .where(and(eq(diveSupportNeeds.shopId, shopId), eq(diveSupportNeeds.personId, personId)));

      const gearReservationRows = await tx
        .select()
        .from(gearReservations)
        .where(
          and(
            eq(gearReservations.shopId, shopId),
            or(
              bookingIds.length ? inArray(gearReservations.bookingId, bookingIds) : undefined,
              eq(gearReservations.personId, personId),
            ),
          ),
        )
        .orderBy(
          asc(gearReservations.reservedFrom),
          asc(gearReservations.createdAt),
          asc(gearReservations.id),
        );
      const gearItemIds = [...new Set(gearReservationRows.map((row) => row.gearItemId))];
      const gearItemRows = gearItemIds.length
        ? await tx
            .select()
            .from(gearItems)
            .where(and(inArray(gearItems.id, gearItemIds), eq(gearItems.shopId, shopId)))
        : [];
      const gearItemLabel = new Map(gearItemRows.map((row) => [row.id, row.label]));

      const priorVisitRows = await tx
        .select()
        .from(priorVisits)
        .where(and(eq(priorVisits.shopId, shopId), eq(priorVisits.personId, personId)))
        .orderBy(asc(priorVisits.visitedOn), asc(priorVisits.id));

      const importedPaymentHistoryRows = await tx
        .select()
        .from(importedPaymentHistory)
        .where(
          and(
            eq(importedPaymentHistory.shopId, shopId),
            eq(importedPaymentHistory.personId, personId),
          ),
        )
        .orderBy(asc(importedPaymentHistory.occurredOn), asc(importedPaymentHistory.id));

      const waiverRows = await tx
        .select()
        .from(waiverRecords)
        .where(and(eq(waiverRecords.shopId, shopId), eq(waiverRecords.personId, personId)))
        .orderBy(asc(waiverRecords.createdAt), asc(waiverRecords.id));

      const inquiryRows = await tx
        .select()
        .from(courseInquiries)
        .where(and(eq(courseInquiries.shopId, shopId), eq(courseInquiries.personId, personId)))
        .orderBy(asc(courseInquiries.createdAt), asc(courseInquiries.id));
      const inquiryCourseIds = [
        ...new Set(inquiryRows.flatMap((row) => (row.courseId ? [row.courseId] : []))),
      ];
      const inquiryCourseRows = inquiryCourseIds.length
        ? await tx
            .select()
            .from(courses)
            .where(and(inArray(courses.id, inquiryCourseIds), eq(courses.shopId, shopId)))
        : [];
      const courseTitle = new Map(inquiryCourseRows.map((row) => [row.id, row.title]));

      const photoUrls = [
        ...recapPhotoRows.map((row) => row.imageUrl),
        // importSourceDocumentUrl only — never importSourceMedicalDocumentUrl.
        // A re-stored scanned intake form is medical evidence with a
        // file extension rather than a JSON key, and bundling it here would
        // hand a diver's medical document out from underneath H-50's still-open
        // question of whether they should have it — the same withholding
        // medical_answers gets above, extended to the form the medical answers
        // actually shipped on when the waiver was imported.
        ...waiverRows.flatMap((row) =>
          row.importSourceDocumentUrl ? [row.importSourceDocumentUrl] : [],
        ),
        ...importedPaymentHistoryRows.map((row) => row.receiptDocumentUrl),
      ].filter((url): url is string => Boolean(url));

      const tables: ExportTable[] = [
        {
          file: "profile.csv",
          header: [
            "id",
            "full_name",
            "email",
            "phone",
            "date_of_birth",
            "dive_insurance",
            "emergency_contact_name",
            "emergency_contact_phone",
            "courtesy_email_opt_out_at",
            "no_certification_declared_at",
            "no_certification_cleared_at",
            "deleted_at",
            "created_at",
          ],
          rows: [
            [
              person.id,
              person.fullName,
              person.email,
              person.phone,
              person.dateOfBirth,
              person.diveInsurance,
              person.emergencyContactName,
              person.emergencyContactPhone,
              person.courtesyEmailOptOutAt,
              person.noCertificationDeclaredAt,
              person.noCertificationClearedAt,
              person.deletedAt,
              person.createdAt,
            ],
          ],
          note: "This diver's own contact and profile record.",
        },
        {
          file: "certifications.csv",
          header: [
            "id",
            "agency",
            "level",
            "identifier",
            "declared_identifier",
            "status",
            "review_note",
            "reviewed_at",
            "reviewed_by_name",
            "imported_at",
            "imported_from_label",
            "self_declared_at",
            "deleted_at",
            "created_at",
          ],
          rows: certificationRows.map((row) => [
            row.id,
            row.agency,
            row.level,
            row.identifier,
            row.declaredIdentifier,
            row.status,
            row.reviewNote,
            row.reviewedAt,
            row.reviewedByPersonId ? personName.get(row.reviewedByPersonId) : null,
            row.importedAt,
            row.importedFromLabel,
            row.selfDeclaredAt,
            row.deletedAt,
            row.createdAt,
          ]),
          note: "Certification records this shop holds on file, with their verification status.",
        },
        {
          file: "specialty_certifications.csv",
          header: [
            "id",
            "agency",
            "specialty",
            "identifier",
            "status",
            "review_note",
            "reviewed_at",
            "reviewed_by_name",
            "deleted_at",
            "created_at",
          ],
          rows: specialtyRows.map((row) => [
            row.id,
            row.agency,
            row.specialty,
            row.identifier,
            row.status,
            row.reviewNote,
            row.reviewedAt,
            row.reviewedByPersonId ? personName.get(row.reviewedByPersonId) : null,
            row.deletedAt,
            row.createdAt,
          ]),
          note: "Specialty certifications (deep, wreck, night, drysuit) with their verification status.",
        },
        {
          file: "nitrox_certifications.csv",
          header: [
            "id",
            "agency",
            "identifier",
            "status",
            "review_note",
            "reviewed_at",
            "reviewed_by_name",
            "imported_at",
            "imported_from_label",
            "self_declared_at",
            "deleted_at",
            "created_at",
          ],
          rows: nitroxRows.map((row) => [
            row.id,
            row.agency,
            row.identifier,
            row.status,
            row.reviewNote,
            row.reviewedAt,
            row.reviewedByPersonId ? personName.get(row.reviewedByPersonId) : null,
            row.importedAt,
            row.importedFromLabel,
            row.selfDeclaredAt,
            row.deletedAt,
            row.createdAt,
          ]),
          note: "Nitrox (EANx) certification with its verification status.",
        },
        {
          file: "bookings.csv",
          header: [
            "id",
            "trip_title",
            "trip_starts_at",
            "status",
            "wants_nitrox",
            "conditions_briefed_at",
            "group_preference",
            "last_dived_band",
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
              tripTitle.get(row.tripId),
              tripStartsAt.get(row.tripId),
              row.status,
              row.wantsNitrox,
              row.conditionsBriefedAt,
              row.groupPreference,
              row.lastDivedBand,
              row.claimedAt,
              payment?.status ?? "unpaid",
              payment?.amountCents,
              payment?.currency,
              payment?.provider,
              row.createdAt,
            ];
          }),
          // party_lead_booking_id is deliberately not a column here: on a
          // shared booking it is another diver's booking id, and it is a
          // foreign key this diver has no reason to hold — see the module
          // docblock's shared-row decisions.
          note: "Every booking this diver has held at this shop, with its current payment state.",
        },
        {
          file: "waitlist_entries.csv",
          header: ["id", "trip_title", "trip_starts_at", "invited_at", "created_at"],
          rows: waitlistRows.map((row) => [
            row.id,
            tripTitle.get(row.tripId),
            tripStartsAt.get(row.tripId),
            row.invitedAt,
            row.createdAt,
          ]),
          note: "Full trips this diver joined the wait list for.",
        },
        {
          file: "trip_invitations.csv",
          header: ["id", "trip_title", "trip_starts_at", "source", "invited_at", "created_at"],
          rows: invitationRows.map((row) => [
            row.id,
            tripTitle.get(row.tripId),
            tripStartsAt.get(row.tripId),
            row.source,
            row.invitedAt,
            row.createdAt,
          ]),
          note: "Staff outreach inviting this diver to a departure without claiming a seat.",
        },
        {
          file: "last_minute_list.csv",
          header: ["id", "available_from", "available_until", "unsubscribed_at", "created_at"],
          rows: lastMinuteListRows.map((row) => [
            row.id,
            row.availableFrom,
            row.availableUntil,
            row.unsubscribedAt,
            row.createdAt,
          ]),
          note: "This diver's opt-in to hear about last-minute deals shop-wide, and the date range they gave.",
        },
        {
          file: "trip_last_minute_promo_recipients.csv",
          header: ["id", "trip_promo_id", "email", "created_at"],
          rows: lastMinutePromoRecipientRows.map((row) => [
            row.id,
            row.tripPromoId,
            row.email,
            row.createdAt,
          ]),
          note: "Last-minute deal blasts this diver was sent.",
        },
        {
          file: "booking_payment_events.csv",
          header: [
            "id",
            "booking_id",
            "status",
            "previous_status",
            "amount_cents",
            "currency",
            "provider",
            "operation",
            "occurred_at",
          ],
          rows: paymentEventRows.map((row) => [
            row.id,
            row.bookingId,
            row.status,
            row.previousStatus,
            row.amountCents,
            row.currency,
            row.provider,
            row.operation,
            row.occurredAt,
          ]),
          note: "Every recorded change to this diver's payment state, oldest first.",
        },
        {
          file: "booking_checkout_bookings.csv",
          header: ["checkout_id", "booking_id", "trip_cents", "gear_cents"],
          rows: checkoutBookingRows.map((row) => [
            row.checkoutId,
            row.bookingId,
            row.tripCents,
            row.gearCents,
          ]),
          // The checkout attempt itself (booking_checkouts.csv in the shop
          // bundle) is not included: one attempt can cover a whole party
          // sharing a single Stripe session, so its customer_email and totals
          // may not be this diver's — see the module docblock. This is only
          // this diver's own seat within any such attempt.
          note: "Rental gear charged on this diver's own seat within a checkout attempt.",
        },
        {
          file: "roll_call_events.csv",
          header: [
            "id",
            "trip_title",
            "trip_starts_at",
            "booking_id",
            "status",
            "checkpoint",
            "recorded_by_name",
            "occurred_at",
          ],
          rows: rollCallRows.map((row) => [
            row.id,
            tripTitle.get(row.tripId),
            tripStartsAt.get(row.tripId),
            row.bookingId,
            row.status,
            row.checkpoint,
            personName.get(row.recordedByPersonId),
            row.occurredAt,
          ]),
          // `note` (a free-text field staff can type at the rail) is
          // deliberately not a column here — see activity_events in "Not
          // included": free text on this table can name a different diver, and
          // safely redacting it needs the same sweep the erasure path uses.
          note: "This diver's own boarding and roll-call record.",
        },
        {
          file: "buddy_pairs.csv",
          header: [
            "pair_id",
            "trip_title",
            "trip_starts_at",
            "member_kind",
            "paired_by_name",
            "created_at",
          ],
          rows: buddyPairRows.map((row) => [
            row.pairId,
            tripTitle.get(row.tripId),
            tripStartsAt.get(row.tripId),
            row.bookingId ? "diver" : "crew",
            personName.get(row.pairedByPersonId),
            row.createdAt,
          ]),
          // Only this diver's own membership row per team: filtered to their
          // own bookings/crew id, so another member's row is never selected in
          // the first place — see the module docblock.
          note: "Buddy teams this diver was recorded on. Other members are not named here.",
        },
        {
          file: "waiver_templates.csv",
          header: ["id", "title", "version", "body"],
          // waiverRecords.templateBody is the text as signed — a snapshot at
          // signing time, never the live waiverTemplates row, which a shop can
          // go on editing after this diver signed. One row per distinct
          // template this diver actually agreed to.
          rows: (() => {
            const templateIds = [...new Set(waiverRows.map((row) => row.templateId))];
            return templateIds.map((id) => {
              const row = waiverRows.find((waiver) => waiver.templateId === id);
              return [id, row?.templateTitle, row?.templateVersion, row?.templateBody];
            });
          })(),
          note: "The exact wording of each release this diver signed, by version, as it read the moment they signed it.",
        },
        {
          file: "waiver_records.csv",
          header: [
            "id",
            "booking_id",
            "template_title",
            "template_version",
            "status",
            "signed_name",
            "signature_method",
            "recorded_by_name",
            "started_at",
            "consented_at",
            "signed_at",
            "completed_at",
            "medical_review_required",
            // The clearance is the diver's own fact — a physician evaluated
            // them and the shop recorded it — so it belongs in their bundle
            // even though the answers behind it do not. The staff member who
            // recorded it is named for the same reason `recorded_by_name` is.
            "medical_cleared_at",
            "medical_cleared_by_name",
            "medical_clearance_evaluated_on",
            "medical_clearance_physician_name",
            "superseded_at",
            "expires_at",
            "created_at",
          ],
          // medical_answers is deliberately absent — see the module docblock.
          rows: waiverRows.map((row) => [
            row.id,
            row.bookingId,
            row.templateTitle,
            row.templateVersion,
            row.status,
            row.signedName,
            row.signatureMethod,
            row.recordedByPersonId ? personName.get(row.recordedByPersonId) : null,
            row.startedAt,
            row.consentedAt,
            row.signedAt,
            row.completedAt,
            row.medicalReviewRequired,
            row.medicalClearedAt,
            row.medicalClearedByPersonId ? personName.get(row.medicalClearedByPersonId) : null,
            row.medicalClearanceEvaluatedOn,
            row.medicalClearancePhysicianName,
            row.supersededAt,
            row.expiresAt,
            row.createdAt,
          ]),
          note: "Waiver evidence this diver signed. Medical answers are withheld pending a legal review of subject-access scope (docs/product/human-decisions.md).",
        },
        {
          file: "rental_fit.csv",
          header: [
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
            "updated_at",
          ],
          rows: rentalFitRows.map((row) => [
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
            row.updatedAt,
          ]),
          note: "This diver's rental kit and sizes on file.",
        },
        {
          file: "dive_support_needs.csv",
          header: [
            "support_divers_needed",
            "support_divers_provided_by",
            "needs_boarding_assistance",
            "needs_water_lift",
            "briefing_in_sign",
            "briefing_in_writing",
            "briefing_aloud",
            "briefing_by_signals",
            "equipment_adaptation",
            "dives_with_name",
            "stated_at",
            "updated_at",
          ],
          rows: supportNeedsRows.map((row) => [
            row.supportDiversNeeded,
            row.supportDiversProvidedBy,
            row.needsBoardingAssistance,
            row.needsWaterLift,
            row.briefingInSign,
            row.briefingInWriting,
            row.briefingAloud,
            row.briefingBySignals,
            row.equipmentAdaptation,
            row.divesWithName,
            row.statedAt,
            row.updatedAt,
          ]),
          note: "What you told this shop your dive needs set up. Answered on your own readiness page, and about the dive rather than about you — this shop holds no condition, classification or medical answer from you here, and nothing in it can refuse you a seat or a place on a boat.",
        },
        {
          file: "gear_reservations.csv",
          header: [
            "id",
            "gear_item_label",
            "booking_id",
            "person_id",
            "reserved_from",
            "reserved_until",
            "checked_out_at",
            "returned_at",
            "created_at",
          ],
          rows: gearReservationRows.map((row) => [
            row.id,
            gearItemLabel.get(row.gearItemId),
            row.bookingId,
            row.personId,
            row.reservedFrom,
            row.reservedUntil,
            row.checkedOutAt,
            row.returnedAt,
            row.createdAt,
          ]),
          note: "Rental gear reserved for this diver's own seats.",
        },
        {
          file: "prior_visits.csv",
          header: [
            "id",
            "visited_on",
            "title",
            "status_label",
            "amount_label",
            "source_label",
            "imported_at",
          ],
          rows: priorVisitRows.map((row) => [
            row.id,
            row.visitedOn,
            row.title,
            row.statusLabel,
            row.amountLabel,
            row.sourceLabel,
            row.importedAt,
          ]),
          note: "Visit history the shop imported from its previous system for this diver.",
        },
        {
          file: "imported_payment_history.csv",
          header: [
            "id",
            "occurred_on",
            "direction",
            "title",
            "status_label",
            "amount_label",
            "amount_cents",
            "currency",
            "imported_at",
          ],
          rows: importedPaymentHistoryRows.map((row) => [
            row.id,
            row.occurredOn,
            row.direction,
            row.title,
            row.statusLabel,
            row.amountLabel,
            row.amountCents,
            row.currency,
            row.importedAt,
          ]),
          note: "Payment source history the shop imported from its previous system for this diver.",
        },
        {
          file: "notification_deliveries.csv",
          header: ["id", "booking_id", "kind", "status", "provider_status", "attempted_at"],
          rows: notificationRows.map((row) => [
            row.id,
            row.bookingId,
            row.kind,
            row.status,
            row.providerStatus,
            row.attemptedAt,
          ]),
          note: "Whether this diver actually got each message the shop sent them — confirmation, waiver request, reminder, recap.",
        },
        {
          file: "orders.csv",
          header: [
            "id",
            "booking_id",
            "created_by_name",
            "status",
            "currency",
            "total_cents",
            "amount_paid_cents",
            "refunded_cents",
            "paid_at",
            "refunded_at",
            "created_at",
          ],
          // description is staff-typed free text (the invoice form's own note
          // field) and dropped for the same reason internal_notes and
          // activity_events are — see the module docblock.
          rows: orderRows.map((row) => [
            row.id,
            row.bookingId,
            row.createdByPersonId ? personName.get(row.createdByPersonId) : null,
            row.status,
            row.currency,
            row.totalCents,
            row.amountPaidCents,
            row.refundedCents,
            row.paidAt,
            row.refundedAt,
            row.createdAt,
          ]),
          note: "Orders this shop issued to this diver.",
        },
        {
          file: "order_line_items.csv",
          header: ["order_id", "kind", "quantity", "unit_amount_cents", "created_at"],
          // description is also staff-typed free text on this form; the same
          // exclusion, same reason.
          rows: orderLineRows.map((row) => [
            row.orderId,
            row.kind,
            row.quantity,
            row.unitAmountCents,
            row.createdAt,
          ]),
          note: "The lines on each of this diver's orders.",
        },
        {
          file: "tips.csv",
          header: [
            "id",
            "booking_id",
            "status",
            "currency",
            "amount_cents",
            "completed_at",
            "created_at",
          ],
          rows: tipRows.map((row) => [
            row.id,
            row.bookingId,
            row.status,
            row.currency,
            row.amountCents,
            row.completedAt,
            row.createdAt,
          ]),
          note: "Crew tips this diver started from their own post-trip recap page.",
        },
        {
          file: "recap_photos.csv",
          header: ["id", "booking_id", "image_url", "caption", "created_at"],
          rows: recapPhotoRows.map((row) => [
            row.id,
            row.bookingId,
            row.imageUrl,
            row.caption,
            row.createdAt,
          ]),
          note: "Photos this diver attached to their own post-trip recap pages.",
        },
        {
          file: "trip_reviews.csv",
          header: [
            "id",
            "booking_id",
            "rating",
            "comment",
            "is_published",
            "published_at",
            "created_at",
          ],
          rows: reviewRows.map((row) => [
            row.id,
            row.bookingId,
            row.rating,
            row.comment,
            row.isPublished,
            row.publishedAt,
            row.createdAt,
          ]),
          note: "This diver's own trip reviews.",
        },
        {
          file: "review_moderation_events.csv",
          header: [
            "id",
            "review_id",
            "action",
            "reason",
            "reason_note",
            "recorded_by_name",
            "occurred_at",
          ],
          rows: reviewModerationRows.map((row) => [
            row.id,
            row.reviewId,
            row.action,
            row.reason,
            row.reasonNote,
            personName.get(row.recordedByPersonId),
            row.occurredAt,
          ]),
          note: "Every time staff published or hid one of this diver's reviews, and why.",
        },
        {
          file: "dive_package_entitlements.csv",
          header: ["id", "package_name", "booking_id", "consumed_at", "expires_at", "created_at"],
          rows: entitlementRows.map((row) => [
            row.id,
            packageName.get(row.packageId),
            row.bookingId,
            row.consumedAt,
            row.expiresAt,
            row.createdAt,
          ]),
          note: "Prepaid dives this diver bought — spent and still owed.",
        },
        {
          file: "course_inquiries.csv",
          header: [
            "id",
            "course_title",
            "interest",
            "experience_level",
            "timing",
            "message",
            "created_at",
          ],
          rows: inquiryRows.map((row) => [
            row.id,
            row.courseId ? courseTitle.get(row.courseId) : null,
            row.interest,
            row.experienceLevel,
            row.timing,
            row.message,
            row.createdAt,
          ]),
          note: "Course leads this diver submitted through the shop's public page.",
        },
      ];

      return {
        shopName: shop.name,
        shopSlug: shop.slug,
        timezone: shop.timezone,
        diverName: person.fullName,
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
    // diveday:allow-deleted-trips: this counts what the bundle above writes, and
    // the bundle writes every row the shop owns. A count that filtered would
    // disagree with its own file.
    "trips.csv": await countOf(
      db.select({ n: count() }).from(trips).where(eq(trips.shopId, shopId)),
    ),
    "trip_change_events.csv": await countOf(
      db.select({ n: count() }).from(tripChangeEvents).where(eq(tripChangeEvents.shopId, shopId)),
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
    "crew_availability_blocks.csv": await countOf(
      db
        .select({ n: count() })
        .from(crewAvailabilityBlocks)
        .where(
          and(eq(crewAvailabilityBlocks.shopId, shopId), isNull(crewAvailabilityBlocks.deletedAt)),
        ),
    ),
    "crew_assignment_requests.csv": await countOf(
      db
        .select({ n: count() })
        .from(crewAssignmentRequests)
        .where(
          and(eq(crewAssignmentRequests.shopId, shopId), isNull(crewAssignmentRequests.deletedAt)),
        ),
    ),
    "staff_credentials.csv": await countOf(
      db.select({ n: count() }).from(staffCredentials).where(eq(staffCredentials.shopId, shopId)),
    ),
    "bookings.csv": await countOf(
      db.select({ n: count() }).from(bookings).where(eq(bookings.shopId, shopId)),
    ),
    "trip_help_requests.csv": await countOf(
      db.select({ n: count() }).from(tripHelpRequests).where(eq(tripHelpRequests.shopId, shopId)),
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
    "executed_dives.csv": await countOf(
      db.select({ n: count() }).from(executedDives).where(eq(executedDives.shopId, shopId)),
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
    "waiver_materiality_decisions.csv": await countOf(
      db
        .select({ n: count() })
        .from(waiverMaterialityDecisions)
        .where(eq(waiverMaterialityDecisions.shopId, shopId)),
    ),
    "waiver_records.csv": await countOf(
      db.select({ n: count() }).from(waiverRecords).where(eq(waiverRecords.shopId, shopId)),
    ),
    "rental_fit.csv": await countOf(
      db.select({ n: count() }).from(rentalFitProfiles).where(eq(rentalFitProfiles.shopId, shopId)),
    ),
    "dive_support_needs.csv": await countOf(
      db.select({ n: count() }).from(diveSupportNeeds).where(eq(diveSupportNeeds.shopId, shopId)),
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
    "closeout_leftover_decisions.csv": await countOf(
      db
        .select({ n: count() })
        .from(closeoutLeftoverDecisions)
        .where(eq(closeoutLeftoverDecisions.shopId, shopId)),
    ),
    "pre_departure_checklist_items.csv": await countOf(
      db
        .select({ n: count() })
        .from(preDepartureChecklistItems)
        .where(eq(preDepartureChecklistItems.shopId, shopId)),
    ),
    "pre_departure_check_events.csv": await countOf(
      db
        .select({ n: count() })
        .from(preDepartureCheckEvents)
        .where(eq(preDepartureCheckEvents.shopId, shopId)),
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
    "dive_packages.csv": await countOf(
      db.select({ n: count() }).from(divePackages).where(eq(divePackages.shopId, shopId)),
    ),
    "dive_package_entitlements.csv": await countOf(
      db
        .select({ n: count() })
        .from(divePackageEntitlements)
        .where(eq(divePackageEntitlements.shopId, shopId)),
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
