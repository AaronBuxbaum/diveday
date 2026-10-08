import { and, asc, count, eq, inArray, type SQL } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import type { CsvValue, ExportTable } from "@/lib/export";
import type { DbExecutor } from "./client";
import {
  activityEvents,
  boats,
  bookingArrivalEvents,
  bookingCheckoutBookings,
  bookingCheckouts,
  bookingPaymentEvents,
  bookingPayments,
  buddyPairMembers,
  certifications,
  courseInquiries,
  courses,
  customerGearItems,
  customerGearReminderSettings,
  divePackageEntitlements,
  divePackages,
  diveSiteCreatures,
  diveSiteMoments,
  diveSites,
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
  preDepartureCheckEvents,
  preDepartureChecklistItems,
  priorVisits,
  recapPhotos,
  rentalFitProfiles,
  rollCallCrewEvents,
  rollCallEvents,
  shopPromoCodes,
  shopPromoRedemptions,
  specialtyCertifications,
  staffCredentials,
  tips,
  tripChangeEvents,
  tripHelpRequests,
  tripInvitations,
  tripLastMinutePromoRecipients,
  tripLastMinutePromos,
  tripLenses,
  tripRequirements,
  tripSeries,
  tripSeriesSkips,
  tripSightings,
  tripStageEvents,
  tripWaitlistEntries,
  waiverMaterialityDecisions,
  waiverRecords,
  waiverTemplates,
  workOrderBills,
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
 * Both loaders in `./export.ts` read through this list:
 * `loadShopExportBundleInput` takes every entry by `shopColumn` alone, and
 * `loadDiverExportBundleInput` takes the entries it shares by `personColumn`
 * or `bookingColumn` *and* `shopColumn`. One list means the two bundles cannot
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
  diveSiteMoments: {
    table: diveSiteMoments,
    order: [asc(diveSiteMoments.createdAt), asc(diveSiteMoments.id)],
    scope: { shopColumn: diveSiteMoments.shopId },
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
  tripSeriesSkips: {
    table: tripSeriesSkips,
    order: [asc(tripSeriesSkips.createdAt), asc(tripSeriesSkips.id)],
    scope: { shopColumn: tripSeriesSkips.shopId },
  },
  tripWaitlistEntries: {
    table: tripWaitlistEntries,
    order: [asc(tripWaitlistEntries.createdAt), asc(tripWaitlistEntries.id)],
    scope: { shopColumn: tripWaitlistEntries.shopId, personColumn: tripWaitlistEntries.personId },
  },
  lastMinuteListEntries: {
    table: lastMinuteListEntries,
    order: [asc(lastMinuteListEntries.createdAt), asc(lastMinuteListEntries.id)],
    scope: {
      shopColumn: lastMinuteListEntries.shopId,
      personColumn: lastMinuteListEntries.personId,
    },
  },
  tripLastMinutePromos: {
    table: tripLastMinutePromos,
    order: [asc(tripLastMinutePromos.createdAt), asc(tripLastMinutePromos.id)],
    scope: { shopColumn: tripLastMinutePromos.shopId },
  },
  tripLastMinutePromoRecipients: {
    table: tripLastMinutePromoRecipients,
    order: [asc(tripLastMinutePromoRecipients.createdAt), asc(tripLastMinutePromoRecipients.id)],
    scope: {
      shopColumn: tripLastMinutePromoRecipients.shopId,
      personColumn: tripLastMinutePromoRecipients.personId,
    },
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
  courseInquiries: {
    table: courseInquiries,
    order: [asc(courseInquiries.createdAt), asc(courseInquiries.id)],
    scope: { shopColumn: courseInquiries.shopId, personColumn: courseInquiries.personId },
  },
  tripInvitations: {
    table: tripInvitations,
    order: [asc(tripInvitations.createdAt), asc(tripInvitations.id)],
    scope: { shopColumn: tripInvitations.shopId, personColumn: tripInvitations.personId },
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
    order: [asc(buddyPairMembers.createdAt), asc(buddyPairMembers.pairId)],
    scope: { shopColumn: buddyPairMembers.shopId },
  },
  certifications: {
    table: certifications,
    order: [asc(certifications.createdAt), asc(certifications.id)],
    scope: { shopColumn: certifications.shopId, personColumn: certifications.personId },
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

/** Every row of one table that belongs to `shopId`, in the entry's order. */
export function readShopScoped<K extends ExportTableKey>(
  db: DbExecutor,
  key: K,
  shopId: string,
): Promise<ExportTableRows<K>> {
  return readWhere(db, key, (scope) => eq(scope.shopColumn, shopId));
}

/** One person's rows of one table, inside `shopId`, in the entry's order. */
export function readPersonScoped<K extends PersonScopedExportTable>(
  db: DbExecutor,
  key: K,
  shopId: string,
  personId: string,
): Promise<ExportTableRows<K>> {
  return readWhere(db, key, (scope) => {
    if (!scope.personColumn) throw new Error(`${key} has no person scope`);
    return and(eq(scope.shopColumn, shopId), eq(scope.personColumn, personId));
  });
}

/**
 * The rows of one table hanging off `bookingIds`, inside `shopId`, in the
 * entry's order — and no query at all for a diver with no bookings, since an
 * empty `in ()` is not SQL.
 */
export async function readBookingScoped<K extends BookingScopedExportTable>(
  db: DbExecutor,
  key: K,
  shopId: string,
  bookingIds: string[],
): Promise<ExportTableRows<K>> {
  if (bookingIds.length === 0) return [];
  return readWhere(db, key, (scope) => {
    if (!scope.bookingColumn) throw new Error(`${key} has no booking scope`);
    return and(eq(scope.shopColumn, shopId), inArray(scope.bookingColumn, bookingIds));
  });
}

/** How many rows {@link readShopScoped} would return — the settings page's cheap view. */
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
