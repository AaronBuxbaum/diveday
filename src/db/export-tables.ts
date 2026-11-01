import { and, asc, count, eq, inArray, type SQL } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import type { CsvValue, ExportTable } from "@/lib/export";
import type { DbExecutor } from "./client";
import {
  activityEvents,
  boatSnags,
  boats,
  bookingArrivalEvents,
  bookingCheckoutBookings,
  bookingCheckouts,
  bookingPaymentEvents,
  bookingPayments,
  buddyPairMembers,
  certificationJuniorReviews,
  certifications,
  courseFormRecords,
  courseFormRequirements,
  courseForms,
  courseFormVersions,
  courses,
  crewAwayAcknowledgements,
  customerGearItems,
  customerGearReminderSettings,
  dateRequestOfferBookings,
  departureBoatSafetySnapshots,
  divePackageEntitlements,
  divePackages,
  diveSiteCreatures,
  diveSites,
  executedDives,
  gearItems,
  gearReservations,
  gearServiceEvents,
  importedPaymentHistory,
  incidentReportAddenda,
  incidentReportPeople,
  incidentReports,
  interests,
  internalNotes,
  nitroxCertifications,
  notificationDeliveries,
  orderLineItems,
  orders,
  people,
  preDepartureCheckEvents,
  preDepartureChecklistItems,
  priorVisits,
  recapPhotos,
  rentalFitProfiles,
  rollCallCrewEvents,
  rollCallEvents,
  shopPromoCodes,
  shopPromoRedemptions,
  shopTextTranslations,
  specialtyCertifications,
  staffCredentialHistory,
  staffCredentials,
  tips,
  tripChangeEvents,
  tripHelpRequests,
  tripLastMinutePromos,
  tripLenses,
  tripRequirements,
  tripSeries,
  tripSeriesCrew,
  tripSeriesSkips,
  tripSightings,
  tripStageEvents,
  waiverMaterialityDecisions,
  waiverRecords,
  waiverTemplates,
  workOrderBills,
  workOrderCare,
  workOrderEvents,
  workOrderItems,
  workOrderLines,
  workOrders,
} from "./schema";

/**
 * **The tables the export bundles read whole**, one entry per table: which
 * table, the total order its rows are written in, and the columns that scope
 * a read to one shop — and, where the per-diver bundle reads the same table,
 * to one person or to that person's bookings.
 *
 * Both bundles in `./export.ts` read through this list with one reader,
 * {@link readScoped}: a shop scope takes every entry by `shopColumn` alone,
 * and a diver scope takes the entries it shares by `personColumn` or
 * `bookingColumn` *and* `shopColumn`. One list means the two bundles cannot
 * disagree about a table's row order, and a reader can see in one place which
 * tables a diver's own bundle draws on (`erasure-coverage.test.ts` holds that
 * set against the erasure path).
 *
 * Only the plain `select * from t where shop_id = $1 order by …` reads live
 * here. A read that joins, filters on anything else, or shapes its columns
 * stays written out in the loader, where the reason for its shape is next to
 * it — `trips` among them on purpose, since `scripts/check-live-trips.mjs`
 * can only see a read of `trips` that names the table at the query.
 */
export type ExportTableRead = {
  table: PgTable;
  /** The total order rows are written in. Empty only where the loader reorders. */
  order: SQL[];
  scope: {
    shopColumn: AnyPgColumn;
    /** The diver bundle reads this table by `personColumn = personId`. */
    personColumn?: AnyPgColumn;
    /** The diver bundle reads this table by `bookingColumn in (their bookings)`. */
    bookingColumn?: AnyPgColumn;
  };
};

export const EXPORT_TABLES = {
  people: {
    table: people,
    order: [asc(people.createdAt), asc(people.id)],
    scope: { shopColumn: people.shopId },
  },
  diveSites: {
    table: diveSites,
    order: [asc(diveSites.createdAt), asc(diveSites.id)],
    scope: { shopColumn: diveSites.shopId },
  },
  diveSiteCreatures: {
    table: diveSiteCreatures,
    // The order the shop put its field guide in, then id — the same total
    // order `listDiveSiteCreatures` reads, so an export and a briefing can
    // never disagree about which face comes first.
    order: [
      asc(diveSiteCreatures.diveSiteId),
      asc(diveSiteCreatures.position),
      asc(diveSiteCreatures.id),
    ],
    scope: { shopColumn: diveSiteCreatures.shopId },
  },
  recapPhotos: {
    table: recapPhotos,
    order: [asc(recapPhotos.createdAt), asc(recapPhotos.id)],
    scope: { shopColumn: recapPhotos.shopId, bookingColumn: recapPhotos.bookingId },
  },
  shopPromoCodes: {
    table: shopPromoCodes,
    order: [asc(shopPromoCodes.createdAt), asc(shopPromoCodes.id)],
    scope: { shopColumn: shopPromoCodes.shopId },
  },
  // The shop's own price list of prepaid packages, and every dive a diver
  // has bought and not yet taken (ADR
  // 20260822-a-package-is-entitlements-not-money). Both are shop records by
  // the export rule's own test — neither is a credential, an infrastructure
  // pointer, nor DiveDay's bookkeeping about its own machinery — and the
  // entitlements are the sharper of the two: they are money a diver has
  // already handed over, so a bundle without them describes a shop that
  // owes nobody anything.
  divePackages: {
    table: divePackages,
    order: [asc(divePackages.createdAt), asc(divePackages.id)],
    scope: { shopColumn: divePackages.shopId },
  },
  divePackageEntitlements: {
    table: divePackageEntitlements,
    order: [asc(divePackageEntitlements.createdAt), asc(divePackageEntitlements.id)],
    scope: {
      shopColumn: divePackageEntitlements.shopId,
      personColumn: divePackageEntitlements.personId,
    },
  },
  courses: {
    table: courses,
    order: [asc(courses.createdAt), asc(courses.id)],
    scope: { shopColumn: courses.shopId },
  },
  tripSeries: {
    table: tripSeries,
    order: [asc(tripSeries.createdAt), asc(tripSeries.id)],
    scope: { shopColumn: tripSeries.shopId },
  },
  tripSeriesCrew: {
    table: tripSeriesCrew,
    order: [asc(tripSeriesCrew.seriesId), asc(tripSeriesCrew.personId)],
    scope: { shopColumn: tripSeriesCrew.shopId },
  },
  tripSeriesSkips: {
    table: tripSeriesSkips,
    order: [asc(tripSeriesSkips.createdAt), asc(tripSeriesSkips.id)],
    scope: { shopColumn: tripSeriesSkips.shopId },
  },
  // Everyone who wanted a seat, every scope in one file (ADR
  // 20261017-one-interest-with-a-scope). A date interest may carry no person: it is in
  // the shop's bundle and in no diver's, which is the person-scope rule.
  interests: {
    table: interests,
    order: [asc(interests.askedAt), asc(interests.id)],
    scope: { shopColumn: interests.shopId, personColumn: interests.personId },
  },
  dateRequestOfferBookings: {
    table: dateRequestOfferBookings,
    order: [asc(dateRequestOfferBookings.interestId), asc(dateRequestOfferBookings.bookingId)],
    scope: { shopColumn: dateRequestOfferBookings.shopId },
  },
  tripLastMinutePromos: {
    table: tripLastMinutePromos,
    order: [asc(tripLastMinutePromos.createdAt), asc(tripLastMinutePromos.id)],
    scope: { shopColumn: tripLastMinutePromos.shopId },
  },
  orders: {
    table: orders,
    order: [asc(orders.createdAt), asc(orders.id)],
    scope: { shopColumn: orders.shopId, personColumn: orders.personId },
  },
  orderLineItems: {
    table: orderLineItems,
    order: [asc(orderLineItems.orderId), asc(orderLineItems.createdAt), asc(orderLineItems.id)],
    scope: { shopColumn: orderLineItems.shopId },
  },
  // Which order billed which service ticket, and a customer piece's reminder
  // switch (ADR 20261008-work-order-follow-up). Shop-scoped only: neither
  // names a person, and both are read beside the ticket and the piece.
  workOrderBills: {
    table: workOrderBills,
    order: [asc(workOrderBills.createdAt), asc(workOrderBills.id)],
    scope: { shopColumn: workOrderBills.shopId },
  },
  customerGearReminderSettings: {
    table: customerGearReminderSettings,
    order: [asc(customerGearReminderSettings.createdAt), asc(customerGearReminderSettings.id)],
    scope: { shopColumn: customerGearReminderSettings.shopId },
  },
  tripChangeEvents: {
    table: tripChangeEvents,
    order: [asc(tripChangeEvents.occurredAt), asc(tripChangeEvents.seq), asc(tripChangeEvents.id)],
    scope: { shopColumn: tripChangeEvents.shopId },
  },
  tripStageEvents: {
    table: tripStageEvents,
    order: [asc(tripStageEvents.recordedAt), asc(tripStageEvents.seq), asc(tripStageEvents.id)],
    scope: { shopColumn: tripStageEvents.shopId },
  },
  tripRequirements: {
    table: tripRequirements,
    order: [],
    scope: { shopColumn: tripRequirements.shopId },
  },
  // Incident reports (ADR 20261012-incident-reports). Shop bundle only: the
  // diver's own bundle leaves them out by decision (H-20261013-incident-report-erasure).
  incidentReports: {
    table: incidentReports,
    order: [asc(incidentReports.createdAt), asc(incidentReports.id)],
    scope: { shopColumn: incidentReports.shopId },
  },
  incidentReportPeople: {
    table: incidentReportPeople,
    order: [asc(incidentReportPeople.createdAt), asc(incidentReportPeople.id)],
    scope: { shopColumn: incidentReportPeople.shopId },
  },
  incidentReportAddenda: {
    table: incidentReportAddenda,
    order: [asc(incidentReportAddenda.createdAt), asc(incidentReportAddenda.id)],
    scope: { shopColumn: incidentReportAddenda.shopId },
  },
  staffCredentialHistory: {
    table: staffCredentialHistory,
    order: [asc(staffCredentialHistory.seq)],
    scope: { shopColumn: staffCredentialHistory.shopId },
  },
  staffCredentials: {
    table: staffCredentials,
    order: [asc(staffCredentials.createdAt), asc(staffCredentials.id)],
    scope: { shopColumn: staffCredentials.shopId },
  },
  tripHelpRequests: {
    table: tripHelpRequests,
    order: [asc(tripHelpRequests.createdAt), asc(tripHelpRequests.id)],
    scope: { shopColumn: tripHelpRequests.shopId },
  },
  tips: {
    table: tips,
    order: [asc(tips.createdAt), asc(tips.id)],
    scope: { shopColumn: tips.shopId, bookingColumn: tips.bookingId },
  },
  bookingPayments: {
    table: bookingPayments,
    order: [],
    scope: { shopColumn: bookingPayments.shopId, bookingColumn: bookingPayments.bookingId },
  },
  // The history behind those current rows. `booking_payments` folds into
  // bookings.csv as one payment_* column set — the state as it stands —
  // and refunds overwrite it in place, so without this file the bundle
  // carries a balance and no story. Oldest first, so a reader replaying
  // the file in order arrives at the folded row.
  bookingPaymentEvents: {
    table: bookingPaymentEvents,
    order: [asc(bookingPaymentEvents.occurredAt), asc(bookingPaymentEvents.id)],
    scope: {
      shopColumn: bookingPaymentEvents.shopId,
      bookingColumn: bookingPaymentEvents.bookingId,
    },
  },
  // What the shop *asked* for, next to what it was paid. `booking_payments`
  // folds into bookings.csv and `booking_payment_events` says how that
  // state moved; neither can show an attempt that was never finished, and
  // an abandoned checkout is a real fact about a diver who reached the
  // payment page. Oldest first, like the other append-shaped files.
  bookingCheckouts: {
    table: bookingCheckouts,
    order: [asc(bookingCheckouts.createdAt), asc(bookingCheckouts.id)],
    scope: { shopColumn: bookingCheckouts.shopId },
  },
  executedDives: {
    table: executedDives,
    order: [asc(executedDives.tripId), asc(executedDives.diveNumber)],
    scope: { shopColumn: executedDives.shopId },
  },
  // The crew's own tally beside the dive log it sits under. Ordered by
  // departure then site then species, so a reader walking the file stays
  // inside one day and one reef.
  tripSightings: {
    table: tripSightings,
    order: [
      asc(tripSightings.tripId),
      asc(tripSightings.diveSiteName),
      asc(tripSightings.speciesSlug),
    ],
    scope: { shopColumn: tripSightings.shopId },
  },
  // Which seats each of those attempts was paying for. Ordered by checkout
  // then booking so a reader walking the file stays inside one attempt.
  bookingCheckoutBookings: {
    table: bookingCheckoutBookings,
    order: [asc(bookingCheckoutBookings.checkoutId), asc(bookingCheckoutBookings.bookingId)],
    scope: {
      shopColumn: bookingCheckoutBookings.shopId,
      bookingColumn: bookingCheckoutBookings.bookingId,
    },
  },
  shopPromoRedemptions: {
    table: shopPromoRedemptions,
    order: [asc(shopPromoRedemptions.redeemedAt), asc(shopPromoRedemptions.id)],
    scope: { shopColumn: shopPromoRedemptions.shopId },
  },
  internalNotes: {
    table: internalNotes,
    order: [asc(internalNotes.createdAt), asc(internalNotes.id)],
    scope: { shopColumn: internalNotes.shopId },
  },
  // `seq` is the tiebreaker, not `id`: it is the column the in-product feed
  // already orders by within a single timestamp, so the exported file reads
  // in the order the shop saw the events happen.
  activityEvents: {
    table: activityEvents,
    order: [asc(activityEvents.occurredAt), asc(activityEvents.seq)],
    scope: { shopColumn: activityEvents.shopId },
  },
  // One row per (booking, kind) by unique index — a resend overwrites in
  // place — so this is the standing outcome per message, not a send log.
  notificationDeliveries: {
    table: notificationDeliveries,
    order: [asc(notificationDeliveries.attemptedAt), asc(notificationDeliveries.id)],
    scope: {
      shopColumn: notificationDeliveries.shopId,
      bookingColumn: notificationDeliveries.bookingId,
    },
  },
  // The counter's own trail, oldest first for the same reason roll call's
  // is: it is replayed, and `occurred_at` ties under a batched offline
  // sync.
  bookingArrivalEvents: {
    table: bookingArrivalEvents,
    order: [asc(bookingArrivalEvents.occurredAt), asc(bookingArrivalEvents.seq)],
    scope: {
      shopColumn: bookingArrivalEvents.shopId,
      bookingColumn: bookingArrivalEvents.bookingId,
    },
  },
  rollCallEvents: {
    table: rollCallEvents,
    // `seq`, not `id`: the id is a random uuid, so two events sharing an
    // `occurred_at` came out in a different order every export — of the one
    // file a shop is meant to be able to diff against last week's.
    order: [asc(rollCallEvents.occurredAt), asc(rollCallEvents.seq)],
    scope: { shopColumn: rollCallEvents.shopId, bookingColumn: rollCallEvents.bookingId },
  },
  // The crew half: who, not just how many. Same oldest-first ordering, same
  // append-only replay rule as the diver events.
  rollCallCrewEvents: {
    table: rollCallCrewEvents,
    order: [asc(rollCallCrewEvents.occurredAt), asc(rollCallCrewEvents.seq)],
    scope: { shopColumn: rollCallCrewEvents.shopId },
  },
  // Buddy teams standing at export time — not a history: dissolving a team
  // deletes the rows, and the trail that outlives them (`buddy_team_events`)
  // is an in-product operational record, deliberately not exported
  // (ADR 20260804-buddy-teams).
  buddyPairMembers: {
    table: buddyPairMembers,
    // Ordered after the read, by team (`sortBuddyMemberRowsByTeam`, issue
    // #1795): a team's order needs its members' names, which this plain read
    // does not have.
    order: [],
    scope: { shopColumn: buddyPairMembers.shopId },
  },
  certifications: {
    table: certifications,
    order: [asc(certifications.createdAt), asc(certifications.id)],
    scope: { shopColumn: certifications.shopId, personColumn: certifications.personId },
  },
  certificationJuniorReviews: {
    table: certificationJuniorReviews,
    order: [asc(certificationJuniorReviews.recordedAt), asc(certificationJuniorReviews.id)],
    scope: {
      shopColumn: certificationJuniorReviews.shopId,
      personColumn: certificationJuniorReviews.personId,
    },
  },
  specialtyCertifications: {
    table: specialtyCertifications,
    order: [asc(specialtyCertifications.createdAt), asc(specialtyCertifications.id)],
    scope: {
      shopColumn: specialtyCertifications.shopId,
      personColumn: specialtyCertifications.personId,
    },
  },
  nitroxCertifications: {
    table: nitroxCertifications,
    order: [asc(nitroxCertifications.createdAt), asc(nitroxCertifications.id)],
    scope: { shopColumn: nitroxCertifications.shopId, personColumn: nitroxCertifications.personId },
  },
  waiverTemplates: {
    table: waiverTemplates,
    order: [asc(waiverTemplates.title), asc(waiverTemplates.version)],
    scope: { shopColumn: waiverTemplates.shopId },
  },
  waiverMaterialityDecisions: {
    table: waiverMaterialityDecisions,
    order: [asc(waiverMaterialityDecisions.seq)],
    scope: { shopColumn: waiverMaterialityDecisions.shopId },
  },
  waiverRecords: {
    table: waiverRecords,
    order: [asc(waiverRecords.createdAt), asc(waiverRecords.id)],
    scope: { shopColumn: waiverRecords.shopId, personColumn: waiverRecords.personId },
  },
  // Course forms (ADR 20261008-course-forms): the shop's forms, every version
  // of their words, which course asks for which, and each signed record.
  courseForms: {
    table: courseForms,
    order: [asc(courseForms.createdAt), asc(courseForms.id)],
    scope: { shopColumn: courseForms.shopId },
  },
  courseFormVersions: {
    table: courseFormVersions,
    order: [asc(courseFormVersions.formId), asc(courseFormVersions.version)],
    scope: { shopColumn: courseFormVersions.shopId },
  },
  courseFormRequirements: {
    table: courseFormRequirements,
    order: [
      asc(courseFormRequirements.courseId),
      asc(courseFormRequirements.position),
      asc(courseFormRequirements.id),
    ],
    scope: { shopColumn: courseFormRequirements.shopId },
  },
  courseFormRecords: {
    table: courseFormRecords,
    order: [asc(courseFormRecords.createdAt), asc(courseFormRecords.id)],
    scope: { shopColumn: courseFormRecords.shopId, personColumn: courseFormRecords.personId },
  },
  rentalFitProfiles: {
    table: rentalFitProfiles,
    order: [asc(rentalFitProfiles.createdAt), asc(rentalFitProfiles.id)],
    scope: { shopColumn: rentalFitProfiles.shopId, personColumn: rentalFitProfiles.personId },
  },
  gearItems: {
    table: gearItems,
    order: [asc(gearItems.kind), asc(gearItems.label)],
    scope: { shopColumn: gearItems.shopId },
  },
  gearServiceEvents: {
    table: gearServiceEvents,
    // The id tiebreaker keeps the bundle diffable when a batch write
    // lands several events on one timestamp (see rollCallEvents above).
    order: [
      asc(gearServiceEvents.servicedOn),
      asc(gearServiceEvents.createdAt),
      asc(gearServiceEvents.id),
    ],
    scope: { shopColumn: gearServiceEvents.shopId },
  },
  gearReservations: {
    table: gearReservations,
    order: [
      asc(gearReservations.reservedFrom),
      asc(gearReservations.createdAt),
      asc(gearReservations.id),
    ],
    scope: { shopColumn: gearReservations.shopId },
  },
  // The bench (ADR 20261008-gear-work-orders). A diver's own pieces and the
  // tickets about them are theirs as well as the shop's, so both carry a
  // `personColumn` and travel in a diver's own bundle; the lines, the
  // piece-to-ticket joins and the status trail are read with their ticket.
  customerGearItems: {
    table: customerGearItems,
    order: [asc(customerGearItems.createdAt), asc(customerGearItems.id)],
    scope: { shopColumn: customerGearItems.shopId, personColumn: customerGearItems.personId },
  },
  workOrders: {
    table: workOrders,
    order: [asc(workOrders.receivedAt), asc(workOrders.id)],
    scope: { shopColumn: workOrders.shopId, personColumn: workOrders.personId },
  },
  workOrderItems: {
    table: workOrderItems,
    order: [asc(workOrderItems.createdAt), asc(workOrderItems.id)],
    scope: { shopColumn: workOrderItems.shopId },
  },
  workOrderLines: {
    table: workOrderLines,
    order: [asc(workOrderLines.createdAt), asc(workOrderLines.id)],
    scope: { shopColumn: workOrderLines.shopId },
  },
  workOrderCare: {
    table: workOrderCare,
    order: [asc(workOrderCare.createdAt), asc(workOrderCare.id)],
    scope: { shopColumn: workOrderCare.shopId },
  },
  workOrderEvents: {
    table: workOrderEvents,
    order: [asc(workOrderEvents.seq)],
    scope: { shopColumn: workOrderEvents.shopId },
  },
  preDepartureChecklistItems: {
    table: preDepartureChecklistItems,
    order: [asc(preDepartureChecklistItems.sortOrder), asc(preDepartureChecklistItems.createdAt)],
    scope: { shopColumn: preDepartureChecklistItems.shopId },
  },
  preDepartureCheckEvents: {
    table: preDepartureCheckEvents,
    order: [
      asc(preDepartureCheckEvents.occurredAt),
      asc(preDepartureCheckEvents.createdAt),
      asc(preDepartureCheckEvents.seq),
    ],
    scope: { shopColumn: preDepartureCheckEvents.shopId },
  },
  boatSnags: {
    table: boatSnags,
    order: [asc(boatSnags.notedAt), asc(boatSnags.id)],
    scope: { shopColumn: boatSnags.shopId },
  },
  // Every "working it anyway", live or taken back (#2678, records review S2).
  crewAwayAcknowledgements: {
    table: crewAwayAcknowledgements,
    order: [asc(crewAwayAcknowledgements.createdAt), asc(crewAwayAcknowledgements.id)],
    scope: { shopColumn: crewAwayAcknowledgements.shopId },
  },
  departureBoatSafetySnapshots: {
    table: departureBoatSafetySnapshots,
    order: [asc(departureBoatSafetySnapshots.capturedAt), asc(departureBoatSafetySnapshots.id)],
    scope: { shopColumn: departureBoatSafetySnapshots.shopId },
  },
  priorVisits: {
    table: priorVisits,
    order: [asc(priorVisits.visitedOn), asc(priorVisits.id)],
    scope: { shopColumn: priorVisits.shopId, personColumn: priorVisits.personId },
  },
  importedPaymentHistory: {
    table: importedPaymentHistory,
    order: [asc(importedPaymentHistory.occurredOn), asc(importedPaymentHistory.id)],
    scope: {
      shopColumn: importedPaymentHistory.shopId,
      personColumn: importedPaymentHistory.personId,
    },
  },
  boats: {
    table: boats,
    order: [asc(boats.createdAt), asc(boats.id)],
    scope: { shopColumn: boats.shopId },
  },
  // The shop's trip tags. Plainly a shop record — the
  // shop wrote them and its public schedule shows them — so they leave with
  // the shop (ADR 20260904-reef-all-the-way-down, decision 2). Deleted
  // words ride along with their stamp, the same as every other soft-deleted
  // table in this bundle: trips.csv still points at one by lens_id.
  tripLenses: {
    table: tripLenses,
    order: [asc(tripLenses.createdAt), asc(tripLenses.id)],
    scope: { shopColumn: tripLenses.shopId },
  },
  // The shop's own Spanish for its trips, courses and sites (ADR
  // 20261018-claude-assists): written and edited by its staff, so it leaves
  // with the shop.
  shopTextTranslations: {
    table: shopTextTranslations,
    order: [
      asc(shopTextTranslations.subjectKind),
      asc(shopTextTranslations.subjectId),
      asc(shopTextTranslations.field),
      asc(shopTextTranslations.locale),
      asc(shopTextTranslations.id),
    ],
    scope: { shopColumn: shopTextTranslations.shopId },
  },
} satisfies Record<string, ExportTableRead>;

export type ExportTableKey = keyof typeof EXPORT_TABLES;

type Entry<K extends ExportTableKey> = (typeof EXPORT_TABLES)[K];

/** The rows one entry reads: its table's full select shape. */
export type ExportTableRows<K extends ExportTableKey> = Entry<K>["table"]["$inferSelect"][];

/** Entries the per-diver bundle may read by the diver's own person id. */
export type PersonScopedExportTable = {
  [K in ExportTableKey]: Entry<K>["scope"] extends { personColumn: AnyPgColumn } ? K : never;
}[ExportTableKey];

/** Entries the per-diver bundle may read by the diver's own bookings. */
export type BookingScopedExportTable = {
  [K in ExportTableKey]: Entry<K>["scope"] extends { bookingColumn: AnyPgColumn } ? K : never;
}[ExportTableKey];

async function readWhere<K extends ExportTableKey>(
  db: DbExecutor,
  key: K,
  where: (scope: ExportTableRead["scope"]) => SQL | undefined,
): Promise<ExportTableRows<K>> {
  const { table, order, scope } = EXPORT_TABLES[key] as ExportTableRead;
  const filter = where(scope);
  if (filter === undefined) {
    // Drizzle drops an undefined WHERE and reads every tenant's rows.
    throw new Error(`export: ${key} read without a tenant filter`);
  }
  // The entry's table is a union of every table in the list, which drizzle's
  // builder cannot narrow from a key; the row type comes back through
  // `ExportTableRows<K>`, which the entry itself pins.
  const query = db
    .select()
    .from(table as never)
    .where(filter);
  const rows = order.length > 0 ? await query.orderBy(...order) : await query;
  return rows as ExportTableRows<K>;
}

/**
 * **Whose rows a bundle reads** (#2358): one shop's, or one diver's inside it.
 * A diver scope carries the diver's own bookings, read once by the loader, so
 * a table hanging off a seat is read by those seats and nothing wider.
 */
export type ExportScope =
  | { kind: "shop"; shopId: string }
  | { kind: "diver"; shopId: string; personId: string; bookingIds: readonly string[] };

export type ShopExportScope = Extract<ExportScope, { kind: "shop" }>;
export type DiverExportScope = Extract<ExportScope, { kind: "diver" }>;

/** Entries a diver's own bundle may read: by their person id, or by their bookings. */
export type DiverScopedExportTable = PersonScopedExportTable | BookingScopedExportTable;

/**
 * **The one scoped read** both bundles go through: every row of one table
 * inside the scope, in the entry's order.
 *
 * A shop scope filters by the entry's `shopColumn`. A diver scope filters by
 * `shopColumn` *and* the entry's `personColumn`, or its `bookingColumn` against
 * the diver's bookings; an entry with neither cannot be read for a diver at
 * all, which the types refuse and the read throws on, so a diver scope can
 * never fall back to the whole shop. A diver with no bookings costs no query
 * for a booking-scoped table, since an empty `in ()` is not SQL.
 */
export function readScoped<K extends ExportTableKey>(
  db: DbExecutor,
  key: K,
  scope: ShopExportScope,
): Promise<ExportTableRows<K>>;
export function readScoped<K extends DiverScopedExportTable>(
  db: DbExecutor,
  key: K,
  scope: ExportScope,
): Promise<ExportTableRows<K>>;
export async function readScoped<K extends ExportTableKey>(
  db: DbExecutor,
  key: K,
  scope: ExportScope,
): Promise<ExportTableRows<K>> {
  if (scope.kind === "shop") {
    return readWhere(db, key, (columns) => eq(columns.shopColumn, scope.shopId));
  }
  const { personColumn, bookingColumn } = (EXPORT_TABLES[key] as ExportTableRead).scope;
  if (personColumn) {
    return readWhere(db, key, (columns) =>
      and(eq(columns.shopColumn, scope.shopId), eq(personColumn, scope.personId)),
    );
  }
  if (bookingColumn) {
    if (scope.bookingIds.length === 0) return [];
    return readWhere(db, key, (columns) =>
      and(eq(columns.shopColumn, scope.shopId), inArray(bookingColumn, [...scope.bookingIds])),
    );
  }
  throw new Error(`export: ${key} has no diver scope`);
}

/** How many rows {@link readScoped} would return for a shop — the settings page's cheap view. */
export async function countShopScoped(
  db: DbExecutor,
  key: ExportTableKey,
  shopId: string,
): Promise<number> {
  const { table, scope } = EXPORT_TABLES[key] as ExportTableRead;
  const [row] = await db
    .select({ n: count() })
    .from(table as never)
    .where(eq(scope.shopColumn, shopId));
  return row?.n ?? 0;
}

/**
 * **One file of a bundle**: its name, header and README note, and how to build
 * its rows from what the loader read. The bundles are lists of these
 * (`./export-shop-files`, `./export-diver-files`), so a file is written in one
 * place and a loader only reads.
 */
export type ExportFileSpec<Context> = {
  file: string;
  header: string[];
  rows: (context: Context) => CsvValue[][];
  note: string;
};

/** Build every file of a bundle, in list order. */
export function buildExportTables<Context>(
  files: readonly ExportFileSpec<Context>[],
  context: Context,
): ExportTable[] {
  return files.map(({ file, header, rows, note }) => ({ file, header, rows: rows(context), note }));
}
