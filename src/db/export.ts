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
 *
 * The pieces: the plain per-table reads both bundles share are one list,
 * `EXPORT_TABLES` (`./export-tables`); each bundle's files — header, note and
 * row builder — are one list per bundle (`./export-shop-files`,
 * `./export-diver-files`); this file reads, under the one transaction, and
 * hands what it read to those lists. `export-bundle.snapshot.test.ts` pins the
 * output so a change to that wiring cannot move a cell unnoticed.
 *
 * **What row order a file owes, written once (H-20260916-tiebreaker-user-visible-list, issue #1795).** A CSV a
 * shop reads or diffs gets an order a person can predict: `bookings.csv` (by
 * seat time, then the diver's name) and `buddy_teams.csv` (by team, then the
 * team's members' names), in both bundles. Every other file exists to carry the
 * shop's data somewhere else and be re-imported, so its order promises nothing
 * beyond being stable within one database — which is why its
 * `orderBy(createdAt, id)` clauses are exempt from the time-id-order guard
 * (`scripts/check-time-id-order.mjs`, issue #1762): the id is unique, so the
 * order is total, merely arbitrary across databases. A file that moves to the
 * "a person reads it" side gets its key here and a sentence at its clause.
 */

import { and, asc, count, eq, getTableColumns, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { fieldGuideCardsIn } from "@/i18n/marine-life-labels";
import { canExportShopData, STAFF_ROLES } from "@/lib/authz";
import { splitCardsByKind } from "@/lib/card-ledger";
import { nowDate } from "@/lib/clock";
import {
  type DiverExportBundleInput,
  EXPORT_FILE_NOTES,
  type ExportBundleInput,
} from "@/lib/export";
import { isUnsightedSelfDeclaration } from "@/lib/readiness";
import { withoutRehearsals } from "@/lib/rehearsal-export";
import { readActiveStaffRoles } from "./authz";
import { sortBuddyMemberRowsByTeam } from "./buddy-teams";
import type { AppDb, AppTransaction, DbExecutor } from "./client";
import { exportCountScope } from "./export-count-scope";
import { DIVER_EXPORT_FILES } from "./export-diver-files";
import { SHOP_EXPORT_FILES } from "./export-shop-files";
import {
  buildExportTables,
  countShopScoped,
  countShopTips,
  type DiverExportScope,
  diverOwnRows,
  EXPORT_TABLES,
  readScoped,
  readTipRows,
  type ShopExportScope,
} from "./export-tables";
import { queryBatches } from "./query-helpers";
import { shopRehearsalIds } from "./rehearsals";
import { countRollCallMarks, splitRollCallRows } from "./roll-call-subject";
import {
  bookingCheckoutBookings,
  bookingReferrals,
  bookings,
  buddyTeamMembers,
  courses,
  crewAssignmentRequests,
  crewAvailabilityBlocks,
  deals,
  divePackages,
  gearItems,
  gearReservations,
  orderLineItems,
  people,
  personRoles,
  recapPulses,
  reviewModerationEvents,
  reviewReplies,
  rollCallEvents,
  shops,
  staffShifts,
  tripAssignments,
  tripDives,
  tripRecapPhotos,
  tripReviews,
  tripScheduleDays,
  trips,
  userAccounts,
  workOrderCare,
  workOrderLines,
} from "./schema";

/** Whose bundle to load: one shop's whole, or one diver's own inside it. */
export type ExportBundleScope =
  | { kind: "shop"; shopId: string }
  | { kind: "diver"; shopId: string; personId: string };

/**
 * **The one bundle loader** (#2358): reads the scope's rows under one
 * transaction and builds its bundle's files. The shop's files take the shop
 * columns of each shared spec and the diver's the diver columns
 * (`shopFile` / `diverFile`, `./export-shared-files`); every plain read goes
 * through the same scoped reader (`readScoped`, `./export-tables`), so the
 * two bundles differ only where their reads are written out on purpose — the
 * diver's own bookings and buddy teams ordered by the boat (H-20260916-tiebreaker-user-visible-list), and the
 * joins only one bundle needs. `null` for a shop, or a diver of this shop,
 * that does not exist.
 */
export function loadExportBundleInput(
  db: AppDb,
  scope: Extract<ExportBundleScope, { kind: "shop" }>,
): Promise<ExportBundleInput | null>;
export function loadExportBundleInput(
  db: AppDb,
  scope: Extract<ExportBundleScope, { kind: "diver" }>,
): Promise<DiverExportBundleInput | null>;
export function loadExportBundleInput(
  db: AppDb,
  scope: ExportBundleScope,
): Promise<ExportBundleInput | DiverExportBundleInput | null> {
  // One read-only repeatable-read transaction: the bundle is a relational
  // snapshot, and per-statement snapshots would let a booking that commits
  // mid-export show up in bookings.csv while its person is missing from
  // people.csv.
  return db.transaction(
    async (tx): Promise<ExportBundleInput | DiverExportBundleInput | null> => {
      if (scope.kind === "shop") {
        const context = await loadShopExportContext(tx, scope.shopId);
        if (!context) return null;
        return {
          ...bundleHeading(context.shop, context.photoUrls),
          // A rehearsal is practice, not the shop's record (ADR
          // 20261012-rehearsal-departures): left out of every file at once.
          tables: withoutRehearsals(
            buildExportTables(SHOP_EXPORT_FILES, context),
            await shopRehearsalIds(tx, scope.shopId),
          ),
          medicalAnswerPersonIds: [
            ...new Set(
              context.waiverRows.flatMap((row) => (row.medicalAnswers ? [row.personId] : [])),
            ),
          ].sort(),
        };
      }
      const context = await loadDiverExportContext(tx, scope.shopId, scope.personId);
      if (!context) return null;
      return {
        ...bundleHeading(context.shop, context.photoUrls),
        diverName: context.person.fullName,
        tables: withoutRehearsals(
          buildExportTables(DIVER_EXPORT_FILES, context),
          await shopRehearsalIds(tx, scope.shopId),
        ),
      };
    },
    { accessMode: "read only", isolationLevel: "repeatable read" },
  );
}

/** What both bundles say about the shop, and their photo list, deduped and sorted. */
function bundleHeading(
  shop: { name: string; slug: string; timezone: string },
  photoUrls: readonly string[],
) {
  return {
    shopName: shop.name,
    shopSlug: shop.slug,
    timezone: shop.timezone,
    photoUrls: [...new Set(photoUrls)].sort(),
  };
}

/** One shop's whole bundle — {@link loadExportBundleInput} with a shop scope. */
export function loadShopExportBundleInput(
  db: AppDb,
  shopId: string,
  _now: Date = nowDate(),
): Promise<ExportBundleInput | null> {
  return loadExportBundleInput(db, { kind: "shop", shopId });
}

/**
 * The shop's safety records as the bundle carries them: crew credentials, and
 * incident reports with their people and dated notes (ADR
 * 20261012-incident-reports — the shop bundle only, never a diver's own).
 */
async function readDepartureRecords(tx: AppTransaction, scope: ShopExportScope) {
  return {
    executedDiveRows: await readScoped(tx, "executedDives", scope),
    sightingRows: await readScoped(tx, "tripSightings", scope),
    conservationRows: await readScoped(tx, "tripConservation", scope),
  };
}

async function readSafetyRecordRows(tx: AppTransaction, scope: ShopExportScope) {
  return {
    staffCredentialRows: await readScoped(tx, "staffCredentials", scope),
    staffCredentialHistoryRows: await readScoped(tx, "staffCredentialHistory", scope),
    incidentReportRows: await readScoped(tx, "incidentReports", scope),
    incidentPersonRows: await readScoped(tx, "incidentReportPeople", scope),
    incidentAddendumRows: await readScoped(tx, "incidentReportAddenda", scope),
  };
}

/**
 * What a departure was checked against as it left: the shop's checklist lines
 * and every tap on them, the boat's papers and kit at the departure roll call
 * (`departure_boat_safety_snapshots`, issue 2300), and the snags a crew noted
 * against an item for the boat's next crew (fifth-loop ideas, item 1).
 */
async function readDepartureCheckRows(tx: AppTransaction, scope: ShopExportScope) {
  const checklistItemRows = await readScoped(tx, "preDepartureChecklistItems", scope);
  return {
    checklistItemRows,
    checklistItemLabel: new Map(checklistItemRows.map((row) => [row.id, row.label])),
    checklistEventRows: await readScoped(tx, "preDepartureCheckEvents", scope),
    boatSafetySnapshotRows: await readScoped(tx, "departureBoatSafetySnapshots", scope),
    boatSnagRows: await readScoped(tx, "boatSnags", scope),
  };
}

/**
 * A shop's repeating trips as the bundle carries them: the runs, the dates
 * taken out of each, and each run's standing crew.
 */
async function readSeriesRecordRows(tx: AppTransaction, scope: ShopExportScope) {
  const seriesRows = await readScoped(tx, "tripSeries", scope);
  return {
    seriesRows,
    seriesTitle: new Map(seriesRows.map((row) => [row.id, row.title])),
    seriesSkipRows: await readScoped(tx, "tripSeriesSkips", scope),
    seriesCrewRows: await readScoped(tx, "tripSeriesCrew", scope),
  };
}

/**
 * Every review the shop holds, with the shop's live public reply under it
 * riding on its row (`review_replies` is folded: one live reply per review,
 * batch 4 K2).
 */
async function readReviewRowsWithReplies(tx: AppTransaction, shopId: string) {
  return tx
    .select({ review: tripReviews, diverName: people.fullName, replyBody: reviewReplies.body })
    .from(tripReviews)
    .innerJoin(people, and(eq(people.id, tripReviews.personId), eq(people.shopId, shopId)))
    .leftJoin(
      reviewReplies,
      and(
        eq(reviewReplies.reviewId, tripReviews.id),
        eq(reviewReplies.shopId, shopId),
        isNull(reviewReplies.deletedAt),
      ),
    )
    .where(eq(tripReviews.shopId, shopId))
    .orderBy(asc(tripReviews.createdAt), asc(tripReviews.id));
}

/** Every crew assignment of the shop's departures (trip_assignments.csv). */
async function readTripAssignmentRows(tx: AppTransaction, shopId: string) {
  return tx
    .select(getTableColumns(tripAssignments))
    .from(tripAssignments)
    .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
    .where(eq(trips.shopId, shopId))
    .orderBy(asc(tripAssignments.tripId), asc(tripAssignments.personId));
}

/**
 * The days each crew member said they were away (issue #1235; live rows only,
 * a deleted holiday is not the shop's roster) and every "working it anyway"
 * said about them, live or taken back (#2678, records review S2).
 */
async function readCrewAwayRows(tx: AppTransaction, scope: ShopExportScope) {
  const { shopId } = scope;
  return {
    crewAwayRows: await tx
      .select()
      .from(crewAvailabilityBlocks)
      .where(
        and(eq(crewAvailabilityBlocks.shopId, shopId), isNull(crewAvailabilityBlocks.deletedAt)),
      )
      .orderBy(asc(crewAvailabilityBlocks.startsOn), asc(crewAvailabilityBlocks.id)),
    crewAwayAcknowledgementRows: await readScoped(tx, "crewAwayAcknowledgements", scope),
  };
}

/**
 * Everything the shop bundle's files are built from, read once inside the
 * bundle's transaction: the plain per-table reads through `EXPORT_TABLES`
 * (`./export-tables`), the joined and filtered reads written out below, and
 * the lookups the files share (names by id, per-person rollups). `null` for a
 * shop that does not exist. Each entry of `SHOP_EXPORT_FILES` takes only what
 * it names from this.
 */
async function loadCardExportRows(tx: AppTransaction, scope: ShopExportScope | DiverExportScope) {
  // One read of every kind (issue #2722): `cards.csv` writes them all, and the
  // rollups below sort them by kind.
  const cardRows = await readScoped(tx, "cards", scope);
  const juniorReviewRows = await readScoped(tx, "certificationJuniorReviews", scope);
  return { cardRows, juniorReviewRows, ...splitCardsByKind(cardRows) };
}

/** The drill log: the safety records a shop keeps beside its roll call (loop 5). */
async function readSafetyRecords(tx: AppTransaction, scope: ShopExportScope) {
  return {
    safetyDrillRows: await readScoped(tx, "safetyDrills", scope),
    safetyDrillParticipantRows: await readScoped(tx, "safetyDrillParticipants", scope),
    ...(await readShopInbox(tx, scope)),
  };
}

/** The inbox, the shop's answers, the notes to a departure and the found-items shelf (ADR 20260907-two-way-inbox). */
async function readShopInbox(tx: AppTransaction, scope: ShopExportScope) {
  return {
    inboundMessageRows: await readScoped(tx, "inboundMessages", scope),
    staffReplyRows: await readScoped(tx, "staffReplies", scope),
    interestReplyRows: await readScoped(tx, "interestReplies", scope),
    departureNoteRows: await readScoped(tx, "departureNotes", scope),
    lostItemRows: await readScoped(tx, "lostItems", scope),
  };
}

async function loadShopExportContext(tx: AppTransaction, shopId: string) {
  const [shop] = await tx.select().from(shops).where(eq(shops.id, shopId)).limit(1);
  if (!shop) return null;
  const scope: ShopExportScope = { kind: "shop", shopId };

  const peopleRows = await readScoped(tx, "people", scope);
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

  const siteRows = await readScoped(tx, "diveSites", scope);
  const siteName = new Map(siteRows.map((row) => [row.id, row.name]));

  const creatureRows = await readScoped(tx, "diveSiteCreatures", scope);

  const cardById = new Map(
    fieldGuideCardsIn(creatureRows, shop.defaultLocale).map((card) => [card.id, card]),
  );

  const recapPhotoRows = await readScoped(tx, "recapPhotos", scope);

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
    .innerJoin(
      people,
      and(eq(people.id, reviewModerationEvents.recordedByPersonId), eq(people.shopId, shopId)),
    )
    .where(eq(reviewModerationEvents.shopId, shopId))
    .orderBy(asc(reviewModerationEvents.occurredAt), asc(reviewModerationEvents.id));

  const reviewRows = await readReviewRowsWithReplies(tx, shopId);

  // The diver's private word to this shop about the day (ADR
  // 20260904-reef-all-the-way-down, D40). Not a review — it is never
  // published — but the same class of record: the diver's own account,
  // tied to their seat, which the shop already reads on its Reviews page.
  // A shop handed its data back gets the feedback it acted on.
  const recapPulseRows = await tx
    .select({ pulse: recapPulses, diverName: people.fullName })
    .from(recapPulses)
    // The tenant is named here rather than inferred. It does hold without
    // this — `recapPulses.personId` is copied off `bookings.personId`, and
    // `createBookingRecord` only ever resolves a person inside its own shop
    // — but that invariant lives three files away, and the sibling
    // `trip_recap_photos` join states its own. Costs nothing; makes the
    // condition greppable in the query that depends on it.
    .innerJoin(people, and(eq(people.id, recapPulses.personId), eq(people.shopId, shopId)))
    .where(eq(recapPulses.shopId, shopId))
    .orderBy(asc(recapPulses.createdAt), asc(recapPulses.id));

  const { promoCodeRows, lastMinutePromoRows } = await readDealRows(tx, scope);
  const promoCodeText = new Map(promoCodeRows.map((row) => [row.id, row.code]));

  const divePackageRows = await readScoped(tx, "divePackages", scope);
  const entitlementRows = await readScoped(tx, "divePackageEntitlements", scope);

  const courseRows = await readScoped(tx, "courses", scope);
  const courseTitle = new Map(courseRows.map((row) => [row.id, row.title]));

  const seriesRecordRows = await readSeriesRecordRows(tx, scope);

  const interestExportRows = await readInterestExportRows(tx, scope);

  const orderRows = await readScoped(tx, "orders", scope);

  const orderLineRows = await readScoped(tx, "orderLineItems", scope);

  const workOrderBillRows = await readScoped(tx, "workOrderBills", scope);

  const customerGearReminderSettingRows = await readScoped(
    tx,
    "customerGearReminderSettings",
    scope,
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

  const tripChangeEventRows = await readScoped(tx, "tripChangeEvents", scope);

  const tripStageEventRows = await readScoped(tx, "tripStageEvents", scope);
  const safetyRecords = await readSafetyRecords(tx, scope);

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

  const requirementRows = await readScoped(tx, "tripRequirements", scope);
  const requirementsByTrip = new Map(requirementRows.map((row) => [row.tripId, row]));
  const orderedRequirementRows = tripRows
    .filter((trip) => requirementsByTrip.has(trip.id))
    .map((trip) => requirementsByTrip.get(trip.id));

  const assignmentRows = await readTripAssignmentRows(tx, shopId);

  const staffShiftRows = await tx
    .select()
    .from(staffShifts)
    .innerJoin(people, and(eq(people.id, staffShifts.personId), eq(people.shopId, shopId)))
    .where(eq(staffShifts.shopId, shopId))
    .orderBy(asc(staffShifts.startsAt), asc(staffShifts.id));

  // The crew's own two tables (issue #1235), and every "working it anyway".
  const { crewAwayRows, crewAwayAcknowledgementRows } = await readCrewAwayRows(tx, scope);

  const crewRequestRows = await tx
    .select()
    .from(crewAssignmentRequests)
    .where(and(eq(crewAssignmentRequests.shopId, shopId), isNull(crewAssignmentRequests.deletedAt)))
    .orderBy(asc(crewAssignmentRequests.requestedAt), asc(crewAssignmentRequests.id));

  const safetyRecordRows = await readSafetyRecordRows(tx, scope);

  // **`bookings.csv`'s row order, and why the diver's name is in it.**
  //
  // This file is the one a shop diffs against last week's, so its order
  // has to be one a person can predict. `created_at` alone is not:
  // `createBooking` stamps it from the application clock (`nowDate()`, at
  // millisecond resolution) rather than the column's `defaultNow()`, so a
  // party written in one transaction can tie in production, and under the
  // frozen clock every booking a test or an e2e run writes ties by
  // construction. The tie used to go to `asc(bookings.id)` — a
  // `defaultRandom()` uuid — which is the same defect `roll_call_events`
  // above already refuses by ordering on `seq` (issue #1753).
  //
  // `people` is joined only to reach `full_name`; `getTableColumns` keeps
  // the row shape flat, exactly as the `trip_dives` and `trip_assignments`
  // reads above do. **`leftJoin`, not `innerJoin`**: this bundle's own
  // rule is that a migration loses nothing, and an inner join is one
  // unexpected missing parent away from silently dropping a booking row
  // from a shop's whole record. A null name sorts last and changes no
  // other column.
  const bookingRows = await tx
    .select(getTableColumns(bookings))
    .from(bookings)
    .leftJoin(people, eq(people.id, bookings.personId))
    .where(eq(bookings.shopId, shopId))
    .orderBy(asc(bookings.createdAt), asc(people.fullName), asc(bookings.id));
  const bookingPerson = new Map(bookingRows.map((row) => [row.id, row.personId]));

  const tripHelpRequestRows = await readScoped(tx, "tripHelpRequests", scope);

  const tipRows = await readTipRows(tx, scope);

  // A booking's payment state is its newest entry (issue #2716). The entries
  // come oldest first, so the map keeps the last one per booking.
  const paymentEventRows = await readScoped(tx, "bookingPaymentEvents", scope);
  const paymentByBooking = new Map(paymentEventRows.map((row) => [row.bookingId, row]));

  // The diver's link that brought a seat, folded into bookings.csv beside
  // `party_lead_booking_id` (ADR 20260908-one-hand, decision 6, lever W).
  const buddyReferralByBooking = new Map(
    (await tx.select().from(bookingReferrals).where(eq(bookingReferrals.shopId, shopId))).map(
      (row) => [row.bookingId, row.referredByBookingId],
    ),
  );

  const checkoutRows = await readScoped(tx, "bookingCheckouts", scope);

  const departureRecords = await readDepartureRecords(tx, scope);

  const checkoutBookingRows = await readScoped(tx, "bookingCheckoutBookings", scope);

  const noteRows = await readScoped(tx, "internalNotes", scope);

  const activityRows = await readScoped(tx, "activityEvents", scope);

  const whatsAppUsageRows = await readScoped(tx, "whatsAppDeliveredUsage", scope);
  const notificationRows = await readScoped(tx, "notificationDeliveries", scope);

  const arrivalRows = await readScoped(tx, "bookingArrivalEvents", scope);

  const rollCallMarks = splitRollCallRows(await readScoped(tx, "rollCallEvents", scope));

  // **`buddy_teams.csv` is a file a person reads** (H-20260916-tiebreaker-user-visible-list, issue #1795): teams
  // in the panel's order — formation time, then the members' names, then
  // `pair_id` last — each team's rows together. The name is the one the file
  // prints in `person_name`. The old `asc(created_at), asc(pair_id)` was not an
  // order at all: every member of a team shares its `pair_id`, so the tie fell
  // through to whatever Postgres returned.
  const buddyPairRows = sortBuddyMemberRowsByTeam(
    await readScoped(tx, "buddyTeamMembers", scope),
    (row) => {
      const memberId = row.bookingId ? bookingPerson.get(row.bookingId) : row.crewPersonId;
      return (memberId ? personName.get(memberId) : undefined) ?? "";
    },
  );

  const cardExport = await loadCardExportRows(tx, scope);

  const templateRows = await readScoped(tx, "waiverTemplates", scope);

  const waiverMaterialityRows = await readScoped(tx, "waiverMaterialityDecisions", scope);

  const waiverRows = await readScoped(tx, "waiverRecords", scope);

  const courseFormRows = await readScoped(tx, "courseForms", scope);
  const courseFormVersionRows = await readScoped(tx, "courseFormVersions", scope);
  const courseFormRequirementRows = await readScoped(tx, "courseFormRequirements", scope);
  const courseFormRecordRows = await readScoped(tx, "courseFormRecords", scope);

  const rentalFitRows = await readScoped(tx, "rentalFitProfiles", scope);

  const gearItemRows = await readScoped(tx, "gearItems", scope);
  const gearItemLabel = new Map(gearItemRows.map((row) => [row.id, row.label]));

  const gearServiceEventRows = await readScoped(tx, "gearServiceEvents", scope);

  const gearReservationRows = await readScoped(tx, "gearReservations", scope);

  // The bench (ADR 20261008-gear-work-orders): a diver's own pieces, the
  // tickets about them, and what each ticket cost.
  const customerGearItemRows = await readScoped(tx, "customerGearItems", scope);

  const workOrderRows = await readScoped(tx, "workOrders", scope);

  const workOrderItemRows = await readScoped(tx, "workOrderItems", scope);

  const workOrderLineRows = await readScoped(tx, "workOrderLines", scope);

  const workOrderCareRows = await readScoped(tx, "workOrderCare", scope);

  const workOrderEventRows = await readScoped(tx, "workOrderEvents", scope);

  const departureCheckRows = await readDepartureCheckRows(tx, scope);

  const importedPaymentHistoryRows = await readScoped(tx, "importedPaymentHistory", scope);

  const boatRows = await readScoped(tx, "boats", scope);

  const boatName = new Map(boatRows.map((row) => [row.id, row.name]));

  // Per-person rollups for contacts.csv. Archived cards never represent a
  // diver in a migration file; archived people still export, marked.
  const cardsByPerson = new Map<string, typeof cardExport.certifications>();
  for (const card of cardExport.certifications) {
    if (card.deletedAt) continue;
    cardsByPerson.set(card.personId, [...(cardsByPerson.get(card.personId) ?? []), card]);
  }
  const nitroxVerified = new Set(
    cardExport.nitroxCertifications
      .filter((card) => card.status === "verified" && !card.deletedAt)
      .map((card) => card.personId),
  );
  const fitByPerson = new Map(rentalFitRows.map((row) => [row.personId, row]));
  /**
   * **People a card the shop actually holds refutes** — the same per-kind
   * test `listCertificationSummaries` applies before it will render "Not
   * certified yet — unverified", restated here rather than called because
   * that reader takes an `inArray` of person ids and a long-lived shop's
   * lifetime roster would blow PostgreSQL's bind-parameter limit (the same
   * reason `personRoles` above is joined rather than filtered by id list).
   *
   * A still-unsighted self-declaration of any kind is not a card: a diver who
   * declared a rung and later said they hold nothing has made two statements
   * and neither is evidence.
   */
  const cardedPeople = new Set<string>();
  for (const card of cardExport.cardRows) {
    if (!card.deletedAt && !isUnsightedSelfDeclaration(card)) cardedPeople.add(card.personId);
  }

  const waiversByPerson = new Map<string, typeof waiverRows>();
  for (const record of waiverRows) {
    waiversByPerson.set(record.personId, [...(waiversByPerson.get(record.personId) ?? []), record]);
  }

  // Stored image and document URLs referenced by the export's CSVs.
  const photoUrls = [
    ...recapPhotoRows.map((row) => row.imageUrl),
    ...tripRecapPhotoRows.map(({ photo }) => photo.imageUrl),
    ...tripRows.map((row) => row.arrivalPhotoUrl).concat(boatRows.map((row) => row.photoUrl)),
    ...siteRows.flatMap((row) => [row.satelliteImageUrl, row.routeImageUrl, ...row.imageUrls]),
    // No field-guide photos: a creature row is a catalog slug, and the
    // picture on its card is DiveDay's own asset under `public/marine-life`
    // (ADR 20260813-marine-life-is-diveday-copy) rather than anything this
    // shop uploaded. `dive_site_creatures.csv` still prints the path, which
    // resolves against DiveDay and needs nothing bundled.
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

  return {
    shop,
    peopleRows,
    personName,
    personRolesText,
    siteRows,
    siteName,
    creatureRows,
    cardById,
    recapPhotoRows,
    tripRecapPhotoRows,
    reviewModerationRows,
    reviewRows,
    recapPulseRows,
    promoCodeRows,
    promoCodeText,
    tripDealIds: new Set(lastMinutePromoRows.map((row) => row.id)),
    divePackageRows,
    entitlementRows,
    courseRows,
    courseTitle,
    ...seriesRecordRows,
    ...interestExportRows,
    lastMinutePromoRows,
    orderRows,
    orderLineRows,
    workOrderBillRows,
    customerGearReminderSettingRows,
    tripRows,
    tripTitle,
    tripStartsAt,
    tripChangeEventRows,
    tripStageEventRows,
    ...safetyRecords,
    scheduleDayRows,
    tripDiveRows,
    orderedRequirementRows,
    assignmentRows,
    staffShiftRows,
    crewAwayRows,
    crewAwayAcknowledgementRows,
    crewRequestRows,
    ...safetyRecordRows,
    bookingRows,
    bookingPerson,
    tripHelpRequestRows,
    tipRows,
    paymentByBooking,
    buddyReferralByBooking,
    paymentEventRows,
    checkoutRows,
    ...departureRecords,
    checkoutBookingRows,
    noteRows,
    activityRows,
    notificationRows,
    whatsAppUsageRows,
    arrivalRows,
    rollCallRows: rollCallMarks.seats,
    crewRollCallRows: rollCallMarks.crew,
    buddyPairRows,
    cardRows: cardExport.cardRows,
    certificationRows: cardExport.certifications,
    juniorReviewRows: cardExport.juniorReviewRows,
    templateRows,
    waiverMaterialityRows,
    waiverRows,
    waiverSealAcknowledgementRows: await readScoped(tx, "waiverSealAcknowledgements", scope),
    courseFormRows,
    courseFormVersionRows,
    courseFormRequirementRows,
    courseFormRecordRows,
    rentalFitRows,
    gearItemRows,
    gearItemLabel,
    gearServiceEventRows,
    gearReservationRows,
    customerGearItemRows,
    workOrderRows,
    workOrderItemRows,
    workOrderLineRows,
    workOrderCareRows,
    workOrderEventRows,
    ...departureCheckRows,
    priorVisitRows: await readScoped(tx, "priorVisits", scope),
    importedPaymentHistoryRows,
    boatRows,
    boatName,
    tripLensRows: await readScoped(tx, "tripLenses", scope),
    shopTextTranslationRows: await readScoped(tx, "shopTextTranslations", scope),
    cardsByPerson,
    nitroxVerified,
    fitByPerson,
    cardedPeople,
    waiversByPerson,
    photoUrls,
  };
}

/**
 * One table, two files: shop-wide codes and last-minute deals, split by
 * whether the deal names a trip (ADR 20261103-a-deal-is-one-row).
 */
async function readDealRows(tx: AppTransaction, scope: ShopExportScope) {
  const dealRows = await readScoped(tx, "deals", scope);
  return {
    promoCodeRows: dealRows.filter((row) => row.tripId === null),
    lastMinutePromoRows: dealRows.flatMap((row) =>
      row.tripId === null ? [] : [{ ...row, tripId: row.tripId }],
    ),
  };
}

async function readInterestExportRows(tx: AppTransaction, scope: ShopExportScope) {
  const interestRows = await readScoped(tx, "interests", scope);
  const dateRequestOfferBookingRows = await readScoped(tx, "dateRequestOfferBookings", scope);
  return { interestRows, dateRequestOfferBookingRows };
}

export type ShopExportContext = NonNullable<Awaited<ReturnType<typeof loadShopExportContext>>>;

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
 *   `buddy_team_members`, keyed by a different `booking_id`/`crew_person_id`.
 *   Filtering to this diver's own bookings (and, if they are also staff, their
 *   own `crew_person_id`) naturally yields only their own membership row per
 *   team — never another member's — so `buddy_teams.csv` is included as-is.
 * - **Roll-call `recorded_by`, order `created_by`, buddy-pair `paired_by`,
 *   waiver `recorded_by`** are staff, not other divers. Included by name, on
 *   the same rule the shop's own bundle uses: the shop's record of who did
 *   what is the shop's own, not a third party's.
 * - **Every person column the bundle leaves out** (`internal_notes`,
 *   `activity_events`, a capability, a conversation, ...) says why in its row
 *   of `./person-columns` (`exportWhy`), and `diverOwnRows` (under
 *   `readScoped` and every read by person id written out below) refuses a
 *   read by a column that row does not call the diver's own. A note's `body`
 *   and an event's `message` are free text that routinely names somebody
 *   else. The registry governs reads by the diver's person id only; a read by
 *   their own booking ids (roll call, deliveries, payments, ...) is outside it
 *   and answers to this list and the files' `in:` columns.
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
 * `waiver_records.csv` **carries `medical_answers` and `medical_alert`**, and
 * `photoUrls` carries an imported record's scanned medical intake form. Aaron
 * decided on 2026-11-05 that medical text is not treated specially in an
 * export (H-20261025-per-diver-record-export); the one open item is a legal
 * conversation as the product scales (issue filed with that decision).
 *
 * ## Tenant + subject scoping
 *
 * Every query below is scoped to `shopId` **and** to this `personId` (or to a
 * booking/order/review id already proven to belong to them), with one
 * deliberate exception: the `{ id, fullName }` name map read from `people`
 * by `shopId` alone, which carries no other column and is only ever looked
 * up by an id taken from the diver's own rows.
 */
export function loadDiverExportBundleInput(
  db: AppDb,
  shopId: string,
  personId: string,
  _now: Date = nowDate(),
): Promise<DiverExportBundleInput | null> {
  return loadExportBundleInput(db, { kind: "diver", shopId, personId });
}

/**
 * {@link loadShopExportContext}'s per-diver twin: every read here is scoped to
 * `shopId` **and** to `personId` (or to an id already proven to be theirs),
 * through `readScoped` with a diver scope where the table is a plain
 * one and written out where it is not. `null` when the person is not this
 * shop's.
 */
async function loadDiverExportContext(tx: AppTransaction, shopId: string, personId: string) {
  const [person] = await tx
    .select()
    .from(people)
    // diveday:allow-deleted-people: a diver's own export covers a removed record too; it is still theirs.
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
  //
  // **Ordered by the departure, not by the diver's name.** Every row here
  // is the *same* person, so the key `bookings.csv` uses in the shop
  // bundle is a constant here and buys nothing (issue #1753). What a diver
  // reading their own history can predict is the boat: seat time, then the
  // departure's own clock and title, with the booking id last as the only
  // resort. The tie above it is real — `createBooking` stamps `created_at`
  // from the application clock, frozen for tests and e2e, so two of this
  // diver's seats written in one run share an instant — and it used to be
  // broken by `asc(bookings.id)`, a `defaultRandom()` uuid.
  //
  // `trips` is joined only to order by; `getTableColumns` keeps the row
  // shape flat, and the title/starts-at maps below still come from the
  // separate `trips` read, which is the one that has to answer for
  // deleted departures.
  const bookingRows = await tx
    .select(getTableColumns(bookings))
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(and(eq(bookings.shopId, shopId), diverOwnRows(bookings.personId, personId)))
    .orderBy(asc(bookings.createdAt), asc(trips.startsAt), asc(trips.title), asc(bookings.id));
  const bookingIds = bookingRows.map((row) => row.id);
  // Every plain read below is this diver's: by their person id, or by these
  // bookings (`readScoped`).
  const scope: DiverExportScope = { kind: "diver", shopId, personId, bookingIds };
  const tripIds = [...new Set(bookingRows.map((row) => row.tripId))];
  const tripRows = tripIds.length
    ? await tx
        .select()
        .from(trips)
        .where(and(inArray(trips.id, tripIds), eq(trips.shopId, shopId)))
    : [];
  const tripTitle = new Map(tripRows.map((row) => [row.id, row.title]));
  const tripStartsAt = new Map(tripRows.map((row) => [row.id, row.startsAt]));

  // A booking's payment state is its newest entry (issue #2716). The entries
  // come oldest first, so the map keeps the last one per booking.
  const paymentEventRows = await readScoped(tx, "bookingPaymentEvents", scope);
  const paymentByBooking = new Map(paymentEventRows.map((row) => [row.bookingId, row]));

  // Everyone this bundle might need to *name* besides the diver — a
  // staffer who recorded a roll call, moderated a review, or paired a
  // buddy team. Used only to resolve a name string onto the diver's own
  // rows below; no other person's row is ever written to a file (see the
  // shared-row decisions above). Only people who are or were staff here, and
  // the diver themselves: an actor column that points at another diver (a
  // malformed historical reference) resolves to no name, never theirs (#3880).
  // "Were" matters (layer-2 dock review S1): removing a staffer deletes their
  // role rows but keeps their account, disabled, and the divemaster who
  // checked a diver aboard last season is exactly who a subject-access request
  // asks about. Only staff are ever given an account, so an account names
  // someone who held a staff role.
  const staffRows = await tx
    .selectDistinct({ id: people.id, fullName: people.fullName })
    .from(people)
    // diveday:allow-deleted-people: names for every row in the bundle, removed staff included.
    .leftJoin(personRoles, eq(personRoles.personId, people.id))
    .leftJoin(userAccounts, eq(userAccounts.personId, people.id))
    .where(
      and(
        eq(people.shopId, shopId),
        or(inArray(personRoles.role, [...STAFF_ROLES]), isNotNull(userAccounts.id)),
      ),
    );
  const personName = new Map(staffRows.map((row) => [row.id, row.fullName]));
  personName.set(person.id, person.fullName);
  // Plan attribution may name only current staff, never another diver even if
  // a malformed historical reference points at one.
  const planPersonIds = [
    ...new Set(
      bookingRows
        .flatMap((row) => [row.trainingPlanInstructorPersonId, row.trainingPlanByPersonId])
        .filter((id): id is string => id !== null),
    ),
  ];
  const planStaff = planPersonIds.length
    ? await tx
        .select({ id: people.id, fullName: people.fullName })
        .from(people)
        // diveday:allow-deleted-people: a removed staff member still attributed this plan.
        .leftJoin(personRoles, eq(personRoles.personId, people.id))
        .leftJoin(userAccounts, eq(userAccounts.personId, people.id))
        .where(
          and(
            eq(people.shopId, shopId),
            inArray(people.id, planPersonIds),
            or(
              inArray(personRoles.role, ["owner", "manager", "instructor"]),
              isNotNull(userAccounts.id),
            ),
          ),
        )
    : [];
  const trainingPlanStaffName = new Map(planStaff.map((row) => [row.id, row.fullName]));

  const { cardRows, juniorReviewRows } = await loadCardExportRows(tx, scope);

  const interestRows = await readScoped(tx, "interests", scope);
  // A wait-list row names a departure the diver holds no seat on, so its title
  // and time are read here: the lookup above covers only the diver's bookings.
  const interestTripIds = [
    ...new Set(
      interestRows.flatMap((row) => (row.tripId && !tripTitle.has(row.tripId) ? [row.tripId] : [])),
    ),
  ];
  if (interestTripIds.length > 0) {
    const interestTrips = await tx
      .select({ id: trips.id, title: trips.title, startsAt: trips.startsAt })
      .from(trips)
      // diveday:allow-deleted-trips: a diver's own export names every departure they asked about.
      .where(and(inArray(trips.id, interestTripIds), eq(trips.shopId, shopId)));
    for (const row of interestTrips) {
      tripTitle.set(row.id, row.title);
      tripStartsAt.set(row.id, row.startsAt);
    }
  }

  const checkoutBookingRows = await readScoped(tx, "bookingCheckoutBookings", scope);

  const arrivalRows = await readScoped(tx, "bookingArrivalEvents", scope);

  // Scoped by booking, so seats only; the split types them as such.
  const { seats: rollCallRows } = splitRollCallRows(await readScoped(tx, "rollCallEvents", scope));

  // Either this diver's own seat, or — if they are also a staff member —
  // a team they were recorded as crewing. Two rows can never collide: a
  // member row is one or the other, never both.
  //
  // **Ordered by the departure, not by the team's members** (H-20260916-tiebreaker-user-visible-list, issue
  // #1795). The shop bundle orders teams by their members' names; here every
  // row is this diver's own membership, one per team, and the file names no
  // other member — so ordering by the others' names would read them only to
  // leak their order. What the diver can predict is the boat, as in
  // `bookings.csv` above: when the team was formed, then the departure's own
  // clock and title, then `pair_id`, with the row's own id as the last
  // resort. `trips` is joined only to order by: `trip_id` is a non-null
  // reference and a deleted departure's row is still there, so the inner
  // join drops nothing.
  const buddyPairRows = await tx
    .select(getTableColumns(buddyTeamMembers))
    .from(buddyTeamMembers)
    .innerJoin(trips, eq(trips.id, buddyTeamMembers.tripId))
    .where(
      and(
        eq(buddyTeamMembers.shopId, shopId),
        or(
          bookingIds.length ? inArray(buddyTeamMembers.bookingId, bookingIds) : undefined,
          diverOwnRows(buddyTeamMembers.crewPersonId, personId),
        ),
      ),
    )
    .orderBy(
      asc(buddyTeamMembers.createdAt),
      asc(trips.startsAt),
      asc(trips.title),
      asc(buddyTeamMembers.pairId),
      asc(buddyTeamMembers.id),
    );

  const notificationRows = await readScoped(tx, "notificationDeliveries", scope);

  const orderRows = await readScoped(tx, "orders", scope);
  const orderIds = orderRows.map((row) => row.id);
  const orderLineRows = orderIds.length
    ? await tx
        .select()
        .from(orderLineItems)
        .where(and(eq(orderLineItems.shopId, shopId), inArray(orderLineItems.orderId, orderIds)))
        .orderBy(asc(orderLineItems.orderId), asc(orderLineItems.createdAt), asc(orderLineItems.id))
    : [];

  const tipRows = await readTipRows(tx, scope);

  const recapPhotoRows = await readScoped(tx, "recapPhotos", scope);

  const reviewRows = await tx
    .select()
    .from(tripReviews)
    .where(and(eq(tripReviews.shopId, shopId), diverOwnRows(tripReviews.personId, personId)))
    .orderBy(asc(tripReviews.createdAt), asc(tripReviews.id));
  const reviewIds = reviewRows.map((row) => row.id);
  // The diver's private word about their day (#3862), taken back ones included.
  const recapPulseRows = await tx
    .select()
    .from(recapPulses)
    .where(and(eq(recapPulses.shopId, shopId), diverOwnRows(recapPulses.personId, personId)))
    .orderBy(asc(recapPulses.createdAt), asc(recapPulses.id));
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

  const entitlementRows = await readScoped(tx, "divePackageEntitlements", scope);
  const packageIds = [...new Set(entitlementRows.map((row) => row.packageId))];
  const packageRows = packageIds.length
    ? await tx
        .select()
        .from(divePackages)
        .where(and(inArray(divePackages.id, packageIds), eq(divePackages.shopId, shopId)))
    : [];
  const packageName = new Map(packageRows.map((row) => [row.id, row.name]));

  const rentalFitRows = await readScoped(tx, "rentalFitProfiles", scope);

  // The diver's own staff record, when they are also staff (issue #3881,
  // Aaron 2026-11-05): their pro cards and their roles at this shop. Both name
  // only the person, and both go through the registry like every other read.
  const staffCredentialRows = await readScoped(tx, "staffCredentials", scope);
  const roleRows = await tx
    .select({ role: personRoles.role })
    .from(personRoles)
    .innerJoin(people, eq(people.id, personRoles.personId))
    .where(and(eq(people.shopId, shopId), diverOwnRows(personRoles.personId, personId)))
    .orderBy(asc(personRoles.role));
  const rolesText = roleRows.map((row) => row.role).join("; ");

  const gearReservationRows = await tx
    .select()
    .from(gearReservations)
    .where(
      and(
        eq(gearReservations.shopId, shopId),
        or(
          bookingIds.length ? inArray(gearReservations.bookingId, bookingIds) : undefined,
          diverOwnRows(gearReservations.personId, personId),
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

  // The diver's own gear on file and the service tickets about it, with each
  // ticket's pieces and lines (ADR 20261008-gear-work-orders).
  const customerGearItemRows = await readScoped(tx, "customerGearItems", scope);

  // What this diver sent the shop, what the shop sent back, and anything
  // found aboard with their name on it.
  const inboundMessageRows = await readScoped(tx, "inboundMessages", scope);
  const staffReplyRows = await readScoped(tx, "staffReplies", scope);
  const lostItemRows = await readScoped(tx, "lostItems", scope);

  const workOrderRows = await readScoped(tx, "workOrders", scope);

  const diverWorkOrderIds = workOrderRows.map((row) => row.id);
  const workOrderLineRows = diverWorkOrderIds.length
    ? await tx
        .select()
        .from(workOrderLines)
        .where(
          and(
            inArray(workOrderLines.workOrderId, diverWorkOrderIds),
            eq(workOrderLines.shopId, shopId),
          ),
        )
        .orderBy(asc(workOrderLines.createdAt), asc(workOrderLines.id))
    : [];
  const workOrderCareRows = diverWorkOrderIds.length
    ? await tx
        .select()
        .from(workOrderCare)
        .where(
          and(
            inArray(workOrderCare.workOrderId, diverWorkOrderIds),
            eq(workOrderCare.shopId, shopId),
          ),
        )
        .orderBy(asc(workOrderCare.createdAt), asc(workOrderCare.id))
    : [];

  const priorVisitRows = await readScoped(tx, "priorVisits", scope);

  const importedPaymentHistoryRows = await readScoped(tx, "importedPaymentHistory", scope);

  const waiverRows = await readScoped(tx, "waiverRecords", scope);

  const courseFormRecordRows = await readScoped(tx, "courseFormRecords", scope);

  const inquiryCourseIds = [
    ...new Set(interestRows.flatMap((row) => (row.courseId ? [row.courseId] : []))),
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
    // The imported signed release and its scanned medical intake form: the
    // medical answers ship (H-20261025-per-diver-record-export, answered
    // 2026-11-05), so the form they came on ships with them.
    ...waiverRows.flatMap((row) => [
      ...(row.importSourceDocumentUrl ? [row.importSourceDocumentUrl] : []),
      ...(row.importSourceMedicalDocumentUrl ? [row.importSourceMedicalDocumentUrl] : []),
    ]),
    ...importedPaymentHistoryRows.map((row) => row.receiptDocumentUrl),
  ].filter((url): url is string => Boolean(url));

  return {
    person,
    bookingRows,
    tripTitle,
    tripStartsAt,
    paymentByBooking,
    personName,
    trainingPlanStaffName,
    cardRows,
    juniorReviewRows,
    interestRows,
    paymentEventRows,
    checkoutBookingRows,
    arrivalRows,
    rollCallRows,
    buddyPairRows,
    notificationRows,
    orderRows,
    orderLineRows,
    tipRows,
    recapPhotoRows,
    reviewRows,
    recapPulseRows,
    reviewModerationRows,
    entitlementRows,
    packageName,
    rentalFitRows,
    staffCredentialRows,
    rolesText,
    gearReservationRows,
    customerGearItemRows,
    inboundMessageRows,
    staffReplyRows,
    lostItemRows,
    workOrderRows,
    workOrderLineRows,
    workOrderCareRows,
    gearItemLabel,
    priorVisitRows,
    importedPaymentHistoryRows,
    waiverRows,
    courseFormRecordRows,
    courseTitle,
    shop,
    photoUrls,
  };
}

export type DiverExportContext = NonNullable<Awaited<ReturnType<typeof loadDiverExportContext>>>;

export type ExportFileCount = { file: string; note: string; count: number };

/**
 * Row counts for the settings page — the same file list as the bundle without
 * materializing a single data row. A sync test asserts this list and the
 * bundle's file list never drift.
 */
export async function loadShopExportCounts(
  db: DbExecutor,
  shopId: string,
): Promise<ExportFileCount[] | null> {
  const [shop] = await db.select({ id: shops.id }).from(shops).where(eq(shops.id, shopId)).limit(1);
  if (!shop) return null;

  const specification = (file: keyof typeof EXPORT_FILE_NOTES) => {
    const spec = SHOP_EXPORT_FILES.find((spec) => spec.file === file);
    if (!spec) throw new Error(`export count: missing file ${file}`);
    return spec;
  };
  const exclusion = (
    file: keyof typeof EXPORT_FILE_NOTES,
    table: Parameters<typeof exportCountScope>[3],
  ) => exportCountScope(db, shopId, specification(file), table);
  const scoped = (file: keyof typeof EXPORT_FILE_NOTES, key: keyof typeof EXPORT_TABLES) =>
    countShopScoped(db, key, shopId, exclusion(file, EXPORT_TABLES[key].table));

  const countOf = async (query: Promise<{ n: number }[]>) => (await query)[0]?.n ?? 0;
  const peopleCount = await countShopScoped(db, "people", shopId);
  const tasks: Record<keyof typeof EXPORT_FILE_NOTES, () => Promise<number>> = {
    "shop.csv": async () => 1,
    "boats.csv": async () => scoped("boats.csv", "boats"),
    "trip_lenses.csv": async () => scoped("trip_lenses.csv", "tripLenses"),
    // One flat import-ready row per person, so the count mirrors people.csv.
    "contacts.csv": async () => peopleCount,
    "people.csv": async () => peopleCount,
    "cards.csv": async () => scoped("cards.csv", "cards"),
    "certification_junior_reviews.csv": async () =>
      scoped("certification_junior_reviews.csv", "certificationJuniorReviews"),
    // diveday:allow-deleted-trips: this counts what the bundle above writes, and
    // the bundle writes every row the shop owns. A count that filtered would
    // disagree with its own file.
    "trips.csv": async () =>
      countOf(
        db
          .select({ n: count() })
          .from(trips)
          .where(and(eq(trips.shopId, shopId), exclusion("trips.csv", trips))),
      ),
    "trip_change_events.csv": async () => scoped("trip_change_events.csv", "tripChangeEvents"),
    "trip_stage_events.csv": async () => scoped("trip_stage_events.csv", "tripStageEvents"),
    "safety_drills.csv": async () => scoped("safety_drills.csv", "safetyDrills"),
    "safety_drill_participants.csv": async () =>
      scoped("safety_drill_participants.csv", "safetyDrillParticipants"),
    "trip_series.csv": async () => scoped("trip_series.csv", "tripSeries"),
    "trip_series_skips.csv": async () => scoped("trip_series_skips.csv", "tripSeriesSkips"),
    "trip_series_crew.csv": async () => scoped("trip_series_crew.csv", "tripSeriesCrew"),
    "trip_schedule_days.csv": async () =>
      countOf(
        db
          .select({ n: count() })
          .from(tripScheduleDays)
          .innerJoin(trips, eq(trips.id, tripScheduleDays.tripId))
          .where(
            and(eq(trips.shopId, shopId), exclusion("trip_schedule_days.csv", tripScheduleDays)),
          ),
      ),
    "trip_dives.csv": async () =>
      countOf(
        db
          .select({ n: count() })
          .from(tripDives)
          .innerJoin(trips, eq(trips.id, tripDives.tripId))
          .where(and(eq(trips.shopId, shopId), exclusion("trip_dives.csv", tripDives))),
      ),
    "trip_requirements.csv": async () => scoped("trip_requirements.csv", "tripRequirements"),
    "trip_assignments.csv": async () =>
      countOf(
        db
          .select({ n: count() })
          .from(tripAssignments)
          .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
          .where(and(eq(trips.shopId, shopId), exclusion("trip_assignments.csv", tripAssignments))),
      ),
    "staff_shifts.csv": async () =>
      countOf(
        db
          .select({ n: count() })
          .from(staffShifts)
          .where(and(eq(staffShifts.shopId, shopId), exclusion("staff_shifts.csv", staffShifts))),
      ),
    "crew_availability_blocks.csv": async () =>
      countOf(
        db
          .select({ n: count() })
          .from(crewAvailabilityBlocks)
          .where(
            and(
              and(
                eq(crewAvailabilityBlocks.shopId, shopId),
                isNull(crewAvailabilityBlocks.deletedAt),
              ),
              exclusion("crew_availability_blocks.csv", crewAvailabilityBlocks),
            ),
          ),
      ),
    "crew_away_acknowledgements.csv": async () =>
      scoped("crew_away_acknowledgements.csv", "crewAwayAcknowledgements"),
    "crew_assignment_requests.csv": async () =>
      countOf(
        db
          .select({ n: count() })
          .from(crewAssignmentRequests)
          .where(
            and(
              and(
                eq(crewAssignmentRequests.shopId, shopId),
                isNull(crewAssignmentRequests.deletedAt),
              ),
              exclusion("crew_assignment_requests.csv", crewAssignmentRequests),
            ),
          ),
      ),
    "staff_credentials.csv": async () => scoped("staff_credentials.csv", "staffCredentials"),
    "staff_credential_history.csv": async () =>
      scoped("staff_credential_history.csv", "staffCredentialHistory"),
    "bookings.csv": async () =>
      countOf(
        db
          .select({ n: count() })
          .from(bookings)
          .where(and(eq(bookings.shopId, shopId), exclusion("bookings.csv", bookings))),
      ),
    "trip_help_requests.csv": async () => scoped("trip_help_requests.csv", "tripHelpRequests"),
    "booking_payment_events.csv": async () =>
      scoped("booking_payment_events.csv", "bookingPaymentEvents"),
    "booking_checkouts.csv": async () => scoped("booking_checkouts.csv", "bookingCheckouts"),
    "booking_checkout_bookings.csv": async () =>
      scoped("booking_checkout_bookings.csv", "bookingCheckoutBookings"),
    "executed_dives.csv": async () => scoped("executed_dives.csv", "executedDives"),
    "trip_conservation.csv": async () => scoped("trip_conservation.csv", "tripConservation"),
    "trip_sightings.csv": async () => scoped("trip_sightings.csv", "tripSightings"),
    "internal_notes.csv": async () => scoped("internal_notes.csv", "internalNotes"),
    "incident_reports.csv": async () => scoped("incident_reports.csv", "incidentReports"),
    "incident_report_people.csv": async () =>
      scoped("incident_report_people.csv", "incidentReportPeople"),
    "incident_report_addenda.csv": async () =>
      scoped("incident_report_addenda.csv", "incidentReportAddenda"),
    "activity_events.csv": async () => scoped("activity_events.csv", "activityEvents"),
    "whatsapp_delivered_usage.csv": async () =>
      scoped("whatsapp_delivered_usage.csv", "whatsAppDeliveredUsage"),
    "notification_deliveries.csv": async () =>
      scoped("notification_deliveries.csv", "notificationDeliveries"),
    "interests.csv": async () => scoped("interests.csv", "interests"),
    "date_request_offer_bookings.csv": async () =>
      scoped("date_request_offer_bookings.csv", "dateRequestOfferBookings"),
    "trip_last_minute_promos.csv": async () =>
      countDeals(db, shopId, "trip", exclusion("trip_last_minute_promos.csv", deals)),
    "booking_arrival_events.csv": async () =>
      scoped("booking_arrival_events.csv", "bookingArrivalEvents"),
    "roll_call_events.csv": async () =>
      countRollCallMarks(db, shopId, "seat", exclusion("roll_call_events.csv", rollCallEvents)),
    "roll_call_crew_events.csv": async () =>
      countRollCallMarks(
        db,
        shopId,
        "crew",
        exclusion("roll_call_crew_events.csv", rollCallEvents),
      ),
    "buddy_teams.csv": async () => scoped("buddy_teams.csv", "buddyTeamMembers"),
    "waiver_templates.csv": async () => scoped("waiver_templates.csv", "waiverTemplates"),
    "waiver_materiality_decisions.csv": async () =>
      scoped("waiver_materiality_decisions.csv", "waiverMaterialityDecisions"),
    "waiver_records.csv": async () => scoped("waiver_records.csv", "waiverRecords"),
    "waiver_seal_acknowledgements.csv": async () =>
      scoped("waiver_seal_acknowledgements.csv", "waiverSealAcknowledgements"),
    "course_forms.csv": async () => scoped("course_forms.csv", "courseForms"),
    "course_form_versions.csv": async () =>
      scoped("course_form_versions.csv", "courseFormVersions"),
    "course_form_requirements.csv": async () =>
      scoped("course_form_requirements.csv", "courseFormRequirements"),
    "course_form_records.csv": async () => scoped("course_form_records.csv", "courseFormRecords"),
    "rental_fit.csv": async () => scoped("rental_fit.csv", "rentalFitProfiles"),
    "gear_items.csv": async () => scoped("gear_items.csv", "gearItems"),
    "gear_service_events.csv": async () => scoped("gear_service_events.csv", "gearServiceEvents"),
    "gear_reservations.csv": async () => scoped("gear_reservations.csv", "gearReservations"),
    "customer_gear_items.csv": async () => scoped("customer_gear_items.csv", "customerGearItems"),
    "inbound_messages.csv": async () => scoped("inbound_messages.csv", "inboundMessages"),
    "staff_replies.csv": async () => scoped("staff_replies.csv", "staffReplies"),
    "interest_replies.csv": async () => scoped("interest_replies.csv", "interestReplies"),
    "departure_notes.csv": async () => scoped("departure_notes.csv", "departureNotes"),
    "lost_items.csv": async () => scoped("lost_items.csv", "lostItems"),
    "work_orders.csv": async () => scoped("work_orders.csv", "workOrders"),
    "work_order_items.csv": async () => scoped("work_order_items.csv", "workOrderItems"),
    "work_order_lines.csv": async () => scoped("work_order_lines.csv", "workOrderLines"),
    "work_order_care.csv": async () => scoped("work_order_care.csv", "workOrderCare"),
    "work_order_events.csv": async () => scoped("work_order_events.csv", "workOrderEvents"),
    "pre_departure_checklist_items.csv": async () =>
      scoped("pre_departure_checklist_items.csv", "preDepartureChecklistItems"),
    "pre_departure_check_events.csv": async () =>
      scoped("pre_departure_check_events.csv", "preDepartureCheckEvents"),
    "boat_snags.csv": async () => scoped("boat_snags.csv", "boatSnags"),
    "departure_boat_safety_snapshots.csv": async () =>
      scoped("departure_boat_safety_snapshots.csv", "departureBoatSafetySnapshots"),
    "prior_visits.csv": async () => scoped("prior_visits.csv", "priorVisits"),
    "imported_payment_history.csv": async () =>
      scoped("imported_payment_history.csv", "importedPaymentHistory"),
    "orders.csv": async () => scoped("orders.csv", "orders"),
    "order_line_items.csv": async () => scoped("order_line_items.csv", "orderLineItems"),
    "work_order_bills.csv": async () => scoped("work_order_bills.csv", "workOrderBills"),
    "customer_gear_reminder_settings.csv": async () =>
      scoped("customer_gear_reminder_settings.csv", "customerGearReminderSettings"),
    "tips.csv": async () =>
      countShopTips(
        db,
        shopId,
        exclusion("tips.csv", { bookingId: bookingCheckoutBookings.bookingId }),
      ),
    "dive_sites.csv": async () => scoped("dive_sites.csv", "diveSites"),
    "dive_site_creatures.csv": async () => scoped("dive_site_creatures.csv", "diveSiteCreatures"),
    "recap_photos.csv": async () => scoped("recap_photos.csv", "recapPhotos"),
    "trip_recap_photos.csv": async () =>
      countOf(
        db
          .select({ n: count() })
          .from(tripRecapPhotos)
          .where(
            and(
              eq(tripRecapPhotos.shopId, shopId),
              exclusion("trip_recap_photos.csv", tripRecapPhotos),
            ),
          ),
      ),
    "trip_reviews.csv": async () =>
      countOf(
        db
          .select({ n: count() })
          .from(tripReviews)
          .where(and(eq(tripReviews.shopId, shopId), exclusion("trip_reviews.csv", tripReviews))),
      ),
    "recap_pulses.csv": async () =>
      countOf(
        db
          .select({ n: count() })
          .from(recapPulses)
          .where(and(eq(recapPulses.shopId, shopId), exclusion("recap_pulses.csv", recapPulses))),
      ),
    "review_moderation_events.csv": async () =>
      countOf(
        db
          .select({ n: count() })
          .from(reviewModerationEvents)
          .where(
            and(
              eq(reviewModerationEvents.shopId, shopId),
              exclusion("review_moderation_events.csv", reviewModerationEvents),
            ),
          ),
      ),
    "dive_packages.csv": async () => scoped("dive_packages.csv", "divePackages"),
    "dive_package_entitlements.csv": async () =>
      scoped("dive_package_entitlements.csv", "divePackageEntitlements"),
    "shop_promo_codes.csv": async () =>
      countDeals(db, shopId, "shop", exclusion("shop_promo_codes.csv", deals)),
    "courses.csv": async () => scoped("courses.csv", "courses"),
    "shop_text_translations.csv": async () =>
      scoped("shop_text_translations.csv", "shopTextTranslations"),
  };

  const files = Object.keys(tasks) as (keyof typeof EXPORT_FILE_NOTES)[];
  const values = await queryBatches(
    db,
    files.map((file) => tasks[file]),
    4,
  );
  const counts = Object.fromEntries(files.map((file, index) => [file, values[index]]));

  return (Object.keys(EXPORT_FILE_NOTES) as (keyof typeof EXPORT_FILE_NOTES)[]).map((file) => ({
    file,
    note: EXPORT_FILE_NOTES[file],
    count: counts[file],
  }));
}

/** How many of the shop's deals land in one of the two files `deals` splits into. */
async function countDeals(
  db: DbExecutor,
  shopId: string,
  kind: "shop" | "trip",
  exclusion?: import("drizzle-orm").SQL,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(deals)
    .where(
      and(
        eq(deals.shopId, shopId),
        kind === "shop" ? isNull(deals.tripId) : isNotNull(deals.tripId),
        exclusion,
      ),
    );
  return row?.n ?? 0;
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
  const roles = await readActiveStaffRoles(db, shopId, personId);
  return roles !== null && canExportShopData(roles);
}

/** The backups page's page depth, so that page reads through this one module. */
export { PAGE_SIZE } from "./paging";
