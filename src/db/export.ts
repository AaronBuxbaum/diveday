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
 * Its `orderBy(createdAt, id)` clauses are exempt from the time-id-order
 * guard (`scripts/check-time-id-order.mjs`, issue #1762): a CSV's row order is
 * not something a person reads as meaningful, and stability within one
 * database is all an export needs, which the id gives it.
 */

import { and, asc, count, eq, getTableColumns, inArray, isNull, or } from "drizzle-orm";
import { fieldGuideCards } from "@/i18n/marine-life-labels";
import { diverTranslator } from "@/i18n/messages";
import { canExportShopData, type Role } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import {
  type DiverExportBundleInput,
  EXPORT_FILE_NOTES,
  type ExportBundleInput,
} from "@/lib/export";
import { isUnsightedSelfDeclaration } from "@/lib/readiness";
import type { AppDb, AppTransaction } from "./client";
import { DIVER_EXPORT_FILES } from "./export-diver-files";
import { SHOP_EXPORT_FILES } from "./export-shop-files";
import {
  buildExportTables,
  countShopScoped,
  readBookingScoped,
  readPersonScoped,
  readShopScoped,
} from "./export-tables";
import {
  bookingReferrals,
  bookings,
  buddyPairMembers,
  courses,
  crewAssignmentRequests,
  crewAvailabilityBlocks,
  divePackages,
  gearItems,
  gearReservations,
  orderLineItems,
  people,
  personRoles,
  recapPulses,
  reviewModerationEvents,
  shops,
  staffShifts,
  tripAssignments,
  tripDives,
  tripRecapPhotos,
  tripReviews,
  tripScheduleDays,
  trips,
  userAccounts,
} from "./schema";

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
      const context = await loadShopExportContext(tx, shopId);
      if (!context) return null;
      const { shop, photoUrls } = context;
      const tables = buildExportTables(SHOP_EXPORT_FILES, context);
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
 * Everything the shop bundle's files are built from, read once inside the
 * bundle's transaction: the plain per-table reads through `EXPORT_TABLES`
 * (`./export-tables`), the joined and filtered reads written out below, and
 * the lookups the files share (names by id, per-person rollups). `null` for a
 * shop that does not exist. Each entry of `SHOP_EXPORT_FILES` takes only what
 * it names from this.
 */
async function loadShopExportContext(tx: AppTransaction, shopId: string) {
  const [shop] = await tx.select().from(shops).where(eq(shops.id, shopId)).limit(1);
  if (!shop) return null;

  const peopleRows = await readShopScoped(tx, "people", shopId);
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

  const siteRows = await readShopScoped(tx, "diveSites", shopId);
  const siteName = new Map(siteRows.map((row) => [row.id, row.name]));

  const creatureRows = await readShopScoped(tx, "diveSiteCreatures", shopId);

  const cardById = new Map(
    fieldGuideCards(creatureRows, diverTranslator(shop.defaultLocale)).map((card) => [
      card.id,
      card,
    ]),
  );

  const momentRows = await readShopScoped(tx, "diveSiteMoments", shopId);

  const recapPhotoRows = await readShopScoped(tx, "recapPhotos", shopId);

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

  const reviewRows = await tx
    .select({ review: tripReviews, diverName: people.fullName })
    .from(tripReviews)
    .innerJoin(people, and(eq(people.id, tripReviews.personId), eq(people.shopId, shopId)))
    .where(eq(tripReviews.shopId, shopId))
    .orderBy(asc(tripReviews.createdAt), asc(tripReviews.id));

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

  const promoCodeRows = await readShopScoped(tx, "shopPromoCodes", shopId);
  const promoCodeText = new Map(promoCodeRows.map((row) => [row.id, row.code]));

  const divePackageRows = await readShopScoped(tx, "divePackages", shopId);
  const entitlementRows = await readShopScoped(tx, "divePackageEntitlements", shopId);

  const courseRows = await readShopScoped(tx, "courses", shopId);
  const courseTitle = new Map(courseRows.map((row) => [row.id, row.title]));

  const seriesRows = await readShopScoped(tx, "tripSeries", shopId);
  const seriesTitle = new Map(seriesRows.map((row) => [row.id, row.title]));

  const seriesSkipRows = await readShopScoped(tx, "tripSeriesSkips", shopId);

  const waitlistRows = await readShopScoped(tx, "tripWaitlistEntries", shopId);

  const lastMinuteListRows = await readShopScoped(tx, "lastMinuteListEntries", shopId);

  const lastMinutePromoRows = await readShopScoped(tx, "tripLastMinutePromos", shopId);

  const lastMinutePromoRecipientRows = await readShopScoped(
    tx,
    "tripLastMinutePromoRecipients",
    shopId,
  );

  const orderRows = await readShopScoped(tx, "orders", shopId);

  const orderLineRows = await readShopScoped(tx, "orderLineItems", shopId);

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

  const tripChangeEventRows = await readShopScoped(tx, "tripChangeEvents", shopId);

  const tripStageEventRows = await readShopScoped(tx, "tripStageEvents", shopId);

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

  const requirementRows = await readShopScoped(tx, "tripRequirements", shopId);
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
    .innerJoin(people, and(eq(people.id, staffShifts.personId), eq(people.shopId, shopId)))
    .where(eq(staffShifts.shopId, shopId))
    .orderBy(asc(staffShifts.startsAt), asc(staffShifts.id));

  // The crew's own two tables (issue #1235). Live rows only: a withdrawn
  // ask and a deleted holiday are not the shop's roster.
  const crewAwayRows = await tx
    .select()
    .from(crewAvailabilityBlocks)
    .where(and(eq(crewAvailabilityBlocks.shopId, shopId), isNull(crewAvailabilityBlocks.deletedAt)))
    .orderBy(asc(crewAvailabilityBlocks.startsOn), asc(crewAvailabilityBlocks.id));

  const crewRequestRows = await tx
    .select()
    .from(crewAssignmentRequests)
    .where(and(eq(crewAssignmentRequests.shopId, shopId), isNull(crewAssignmentRequests.deletedAt)))
    .orderBy(asc(crewAssignmentRequests.requestedAt), asc(crewAssignmentRequests.id));

  const staffCredentialRows = await readShopScoped(tx, "staffCredentials", shopId);

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

  const tripHelpRequestRows = await readShopScoped(tx, "tripHelpRequests", shopId);

  const tipRows = await readShopScoped(tx, "tips", shopId);

  const paymentRows = await readShopScoped(tx, "bookingPayments", shopId);
  const paymentByBooking = new Map(paymentRows.map((row) => [row.bookingId, row]));

  // The diver's link that brought a seat, folded into bookings.csv beside
  // `party_lead_booking_id` (ADR 20260908-one-hand, decision 6, lever W).
  const buddyReferralByBooking = new Map(
    (await tx.select().from(bookingReferrals).where(eq(bookingReferrals.shopId, shopId))).map(
      (row) => [row.bookingId, row.referredByBookingId],
    ),
  );

  const paymentEventRows = await readShopScoped(tx, "bookingPaymentEvents", shopId);

  const checkoutRows = await readShopScoped(tx, "bookingCheckouts", shopId);

  const executedDiveRows = await readShopScoped(tx, "executedDives", shopId);

  const sightingRows = await readShopScoped(tx, "tripSightings", shopId);

  const checkoutBookingRows = await readShopScoped(tx, "bookingCheckoutBookings", shopId);

  const promoRedemptionRows = await readShopScoped(tx, "shopPromoRedemptions", shopId);

  const noteRows = await readShopScoped(tx, "internalNotes", shopId);

  const activityRows = await readShopScoped(tx, "activityEvents", shopId);

  const notificationRows = await readShopScoped(tx, "notificationDeliveries", shopId);

  const inquiryRows = await readShopScoped(tx, "courseInquiries", shopId);
  const inquiryById = new Map(inquiryRows.map((row) => [row.id, row]));

  const invitationRows = await readShopScoped(tx, "tripInvitations", shopId);

  const arrivalRows = await readShopScoped(tx, "bookingArrivalEvents", shopId);

  const rollCallRows = await readShopScoped(tx, "rollCallEvents", shopId);

  const crewRollCallRows = await readShopScoped(tx, "rollCallCrewEvents", shopId);

  const buddyPairRows = await readShopScoped(tx, "buddyPairMembers", shopId);

  const certificationRows = await readShopScoped(tx, "certifications", shopId);

  const specialtyRows = await readShopScoped(tx, "specialtyCertifications", shopId);

  const nitroxRows = await readShopScoped(tx, "nitroxCertifications", shopId);

  const templateRows = await readShopScoped(tx, "waiverTemplates", shopId);

  const waiverMaterialityRows = await readShopScoped(tx, "waiverMaterialityDecisions", shopId);

  const waiverRows = await readShopScoped(tx, "waiverRecords", shopId);

  const rentalFitRows = await readShopScoped(tx, "rentalFitProfiles", shopId);

  const gearItemRows = await readShopScoped(tx, "gearItems", shopId);
  const gearItemLabel = new Map(gearItemRows.map((row) => [row.id, row.label]));

  const gearServiceEventRows = await readShopScoped(tx, "gearServiceEvents", shopId);

  const gearReservationRows = await readShopScoped(tx, "gearReservations", shopId);

  const checklistItemRows = await readShopScoped(tx, "preDepartureChecklistItems", shopId);
  const checklistItemLabel = new Map(checklistItemRows.map((row) => [row.id, row.label]));

  const checklistEventRows = await readShopScoped(tx, "preDepartureCheckEvents", shopId);

  const priorVisitRows = await readShopScoped(tx, "priorVisits", shopId);

  const importedPaymentHistoryRows = await readShopScoped(tx, "importedPaymentHistory", shopId);

  const boatRows = await readShopScoped(tx, "boats", shopId);

  const boatName = new Map(boatRows.map((row) => [row.id, row.name]));

  const tripLensRows = await readShopScoped(tx, "tripLenses", shopId);

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
    waiversByPerson.set(record.personId, [...(waiversByPerson.get(record.personId) ?? []), record]);
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

  return {
    shop,
    peopleRows,
    personName,
    personRolesText,
    siteRows,
    siteName,
    creatureRows,
    cardById,
    momentRows,
    recapPhotoRows,
    tripRecapPhotoRows,
    reviewModerationRows,
    reviewRows,
    recapPulseRows,
    promoCodeRows,
    promoCodeText,
    divePackageRows,
    entitlementRows,
    courseRows,
    courseTitle,
    seriesRows,
    seriesTitle,
    seriesSkipRows,
    waitlistRows,
    lastMinuteListRows,
    lastMinutePromoRows,
    lastMinutePromoRecipientRows,
    orderRows,
    orderLineRows,
    tripRows,
    tripTitle,
    tripStartsAt,
    tripChangeEventRows,
    tripStageEventRows,
    scheduleDayRows,
    tripDiveRows,
    orderedRequirementRows,
    assignmentRows,
    staffShiftRows,
    crewAwayRows,
    crewRequestRows,
    staffCredentialRows,
    bookingRows,
    bookingPerson,
    tripHelpRequestRows,
    tipRows,
    paymentByBooking,
    buddyReferralByBooking,
    paymentEventRows,
    checkoutRows,
    executedDiveRows,
    sightingRows,
    checkoutBookingRows,
    promoRedemptionRows,
    noteRows,
    activityRows,
    notificationRows,
    inquiryRows,
    inquiryById,
    invitationRows,
    arrivalRows,
    rollCallRows,
    crewRollCallRows,
    buddyPairRows,
    certificationRows,
    specialtyRows,
    nitroxRows,
    templateRows,
    waiverMaterialityRows,
    waiverRows,
    rentalFitRows,
    gearItemRows,
    gearItemLabel,
    gearServiceEventRows,
    gearReservationRows,
    checklistItemRows,
    checklistItemLabel,
    checklistEventRows,
    priorVisitRows,
    importedPaymentHistoryRows,
    boatRows,
    boatName,
    tripLensRows,
    cardsByPerson,
    nitroxVerified,
    fitByPerson,
    cardedPeople,
    waiversByPerson,
    photoUrls,
  };
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
 * booking/order/review id already proven to belong to them), with one
 * deliberate exception: the `{ id, fullName }` name map read from `people`
 * by `shopId` alone, which carries no other column and is only ever looked
 * up by an id taken from the diver's own rows.
 */
export async function loadDiverExportBundleInput(
  db: AppDb,
  shopId: string,
  personId: string,
  _now: Date = nowDate(),
): Promise<DiverExportBundleInput | null> {
  return db.transaction(
    async (tx) => {
      const context = await loadDiverExportContext(tx, shopId, personId);
      if (!context) return null;
      const { shop, person, photoUrls } = context;
      const tables = buildExportTables(DIVER_EXPORT_FILES, context);
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

/**
 * {@link loadShopExportContext}'s per-diver twin: every read here is scoped to
 * `shopId` **and** to `personId` (or to an id already proven to be theirs),
 * through `readPersonScoped` / `readBookingScoped` where the table is a plain
 * one and written out where it is not. `null` when the person is not this
 * shop's.
 */
async function loadDiverExportContext(tx: AppTransaction, shopId: string, personId: string) {
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
    .where(and(eq(bookings.shopId, shopId), eq(bookings.personId, personId)))
    .orderBy(asc(bookings.createdAt), asc(trips.startsAt), asc(trips.title), asc(bookings.id));
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

  const paymentRows = await readBookingScoped(tx, "bookingPayments", shopId, bookingIds);
  const paymentByBooking = new Map(paymentRows.map((row) => [row.bookingId, row]));

  // Everyone this bundle might need to *name* besides the diver — a
  // staffer who recorded a roll call, moderated a review, or paired a
  // buddy team. Used only to resolve a name string onto the diver's own
  // rows below; no other person's row is ever written to a file (see the
  // shared-row decisions above).
  const staffRows = await tx
    .select({ id: people.id, fullName: people.fullName })
    .from(people)
    .where(eq(people.shopId, shopId));
  const personName = new Map(staffRows.map((row) => [row.id, row.fullName]));

  const certificationRows = await readPersonScoped(tx, "certifications", shopId, personId);

  const specialtyRows = await readPersonScoped(tx, "specialtyCertifications", shopId, personId);

  const nitroxRows = await readPersonScoped(tx, "nitroxCertifications", shopId, personId);

  const waitlistRows = await readPersonScoped(tx, "tripWaitlistEntries", shopId, personId);

  const invitationRows = await readPersonScoped(tx, "tripInvitations", shopId, personId);

  const lastMinuteListRows = await readPersonScoped(tx, "lastMinuteListEntries", shopId, personId);

  const lastMinutePromoRecipientRows = await readPersonScoped(
    tx,
    "tripLastMinutePromoRecipients",
    shopId,
    personId,
  );

  const paymentEventRows = await readBookingScoped(tx, "bookingPaymentEvents", shopId, bookingIds);

  const checkoutBookingRows = await readBookingScoped(
    tx,
    "bookingCheckoutBookings",
    shopId,
    bookingIds,
  );

  const arrivalRows = await readBookingScoped(tx, "bookingArrivalEvents", shopId, bookingIds);

  const rollCallRows = await readBookingScoped(tx, "rollCallEvents", shopId, bookingIds);

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

  const notificationRows = await readBookingScoped(
    tx,
    "notificationDeliveries",
    shopId,
    bookingIds,
  );

  const orderRows = await readPersonScoped(tx, "orders", shopId, personId);
  const orderIds = orderRows.map((row) => row.id);
  const orderLineRows = orderIds.length
    ? await tx
        .select()
        .from(orderLineItems)
        .where(and(eq(orderLineItems.shopId, shopId), inArray(orderLineItems.orderId, orderIds)))
        .orderBy(asc(orderLineItems.orderId), asc(orderLineItems.createdAt), asc(orderLineItems.id))
    : [];

  const tipRows = await readBookingScoped(tx, "tips", shopId, bookingIds);

  const recapPhotoRows = await readBookingScoped(tx, "recapPhotos", shopId, bookingIds);

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

  const entitlementRows = await readPersonScoped(tx, "divePackageEntitlements", shopId, personId);
  const packageIds = [...new Set(entitlementRows.map((row) => row.packageId))];
  const packageRows = packageIds.length
    ? await tx
        .select()
        .from(divePackages)
        .where(and(inArray(divePackages.id, packageIds), eq(divePackages.shopId, shopId)))
    : [];
  const packageName = new Map(packageRows.map((row) => [row.id, row.name]));

  const rentalFitRows = await readPersonScoped(tx, "rentalFitProfiles", shopId, personId);

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

  const priorVisitRows = await readPersonScoped(tx, "priorVisits", shopId, personId);

  const importedPaymentHistoryRows = await readPersonScoped(
    tx,
    "importedPaymentHistory",
    shopId,
    personId,
  );

  const waiverRows = await readPersonScoped(tx, "waiverRecords", shopId, personId);

  const inquiryRows = await readPersonScoped(tx, "courseInquiries", shopId, personId);
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

  return {
    person,
    bookingRows,
    tripTitle,
    tripStartsAt,
    paymentByBooking,
    personName,
    certificationRows,
    specialtyRows,
    nitroxRows,
    waitlistRows,
    invitationRows,
    lastMinuteListRows,
    lastMinutePromoRecipientRows,
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
    reviewModerationRows,
    entitlementRows,
    packageName,
    rentalFitRows,
    gearReservationRows,
    gearItemLabel,
    priorVisitRows,
    importedPaymentHistoryRows,
    waiverRows,
    inquiryRows,
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
  db: AppDb,
  shopId: string,
): Promise<ExportFileCount[] | null> {
  const [shop] = await db.select({ id: shops.id }).from(shops).where(eq(shops.id, shopId)).limit(1);
  if (!shop) return null;

  const countOf = async (query: Promise<{ n: number }[]>) => (await query)[0]?.n ?? 0;
  const peopleCount = await countShopScoped(db, "people", shopId);
  const counts: Record<keyof typeof EXPORT_FILE_NOTES, number> = {
    "shop.csv": 1,
    "boats.csv": await countShopScoped(db, "boats", shopId),
    "trip_lenses.csv": await countShopScoped(db, "tripLenses", shopId),
    // One flat import-ready row per person, so the count mirrors people.csv.
    "contacts.csv": peopleCount,
    "people.csv": peopleCount,
    "certifications.csv": await countShopScoped(db, "certifications", shopId),
    "specialty_certifications.csv": await countShopScoped(db, "specialtyCertifications", shopId),
    "nitrox_certifications.csv": await countShopScoped(db, "nitroxCertifications", shopId),
    // diveday:allow-deleted-trips: this counts what the bundle above writes, and
    // the bundle writes every row the shop owns. A count that filtered would
    // disagree with its own file.
    "trips.csv": await countOf(
      db.select({ n: count() }).from(trips).where(eq(trips.shopId, shopId)),
    ),
    "trip_change_events.csv": await countShopScoped(db, "tripChangeEvents", shopId),
    "trip_stage_events.csv": await countShopScoped(db, "tripStageEvents", shopId),
    "trip_series.csv": await countShopScoped(db, "tripSeries", shopId),
    "trip_series_skips.csv": await countShopScoped(db, "tripSeriesSkips", shopId),
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
    "trip_requirements.csv": await countShopScoped(db, "tripRequirements", shopId),
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
    "staff_credentials.csv": await countShopScoped(db, "staffCredentials", shopId),
    "bookings.csv": await countOf(
      db.select({ n: count() }).from(bookings).where(eq(bookings.shopId, shopId)),
    ),
    "trip_help_requests.csv": await countShopScoped(db, "tripHelpRequests", shopId),
    "booking_payment_events.csv": await countShopScoped(db, "bookingPaymentEvents", shopId),
    "booking_checkouts.csv": await countShopScoped(db, "bookingCheckouts", shopId),
    "booking_checkout_bookings.csv": await countShopScoped(db, "bookingCheckoutBookings", shopId),
    "executed_dives.csv": await countShopScoped(db, "executedDives", shopId),
    "trip_sightings.csv": await countShopScoped(db, "tripSightings", shopId),
    "internal_notes.csv": await countShopScoped(db, "internalNotes", shopId),
    "activity_events.csv": await countShopScoped(db, "activityEvents", shopId),
    "notification_deliveries.csv": await countShopScoped(db, "notificationDeliveries", shopId),
    "shop_promo_redemptions.csv": await countShopScoped(db, "shopPromoRedemptions", shopId),
    "course_inquiries.csv": await countShopScoped(db, "courseInquiries", shopId),
    "waitlist_entries.csv": await countShopScoped(db, "tripWaitlistEntries", shopId),
    "trip_invitations.csv": await countShopScoped(db, "tripInvitations", shopId),
    "last_minute_list.csv": await countShopScoped(db, "lastMinuteListEntries", shopId),
    "trip_last_minute_promos.csv": await countShopScoped(db, "tripLastMinutePromos", shopId),
    "trip_last_minute_promo_recipients.csv": await countShopScoped(
      db,
      "tripLastMinutePromoRecipients",
      shopId,
    ),
    "booking_arrival_events.csv": await countShopScoped(db, "bookingArrivalEvents", shopId),
    "roll_call_events.csv": await countShopScoped(db, "rollCallEvents", shopId),
    "roll_call_crew_events.csv": await countShopScoped(db, "rollCallCrewEvents", shopId),
    "buddy_pairs.csv": await countShopScoped(db, "buddyPairMembers", shopId),
    "waiver_templates.csv": await countShopScoped(db, "waiverTemplates", shopId),
    "waiver_materiality_decisions.csv": await countShopScoped(
      db,
      "waiverMaterialityDecisions",
      shopId,
    ),
    "waiver_records.csv": await countShopScoped(db, "waiverRecords", shopId),
    "rental_fit.csv": await countShopScoped(db, "rentalFitProfiles", shopId),
    "gear_items.csv": await countShopScoped(db, "gearItems", shopId),
    "gear_service_events.csv": await countShopScoped(db, "gearServiceEvents", shopId),
    "gear_reservations.csv": await countShopScoped(db, "gearReservations", shopId),
    "pre_departure_checklist_items.csv": await countShopScoped(
      db,
      "preDepartureChecklistItems",
      shopId,
    ),
    "pre_departure_check_events.csv": await countShopScoped(db, "preDepartureCheckEvents", shopId),
    "prior_visits.csv": await countShopScoped(db, "priorVisits", shopId),
    "imported_payment_history.csv": await countShopScoped(db, "importedPaymentHistory", shopId),
    "orders.csv": await countShopScoped(db, "orders", shopId),
    "order_line_items.csv": await countShopScoped(db, "orderLineItems", shopId),
    "tips.csv": await countShopScoped(db, "tips", shopId),
    "dive_sites.csv": await countShopScoped(db, "diveSites", shopId),
    "dive_site_creatures.csv": await countShopScoped(db, "diveSiteCreatures", shopId),
    "dive_site_moments.csv": await countShopScoped(db, "diveSiteMoments", shopId),
    "recap_photos.csv": await countShopScoped(db, "recapPhotos", shopId),
    "trip_recap_photos.csv": await countOf(
      db.select({ n: count() }).from(tripRecapPhotos).where(eq(tripRecapPhotos.shopId, shopId)),
    ),
    "trip_reviews.csv": await countOf(
      db.select({ n: count() }).from(tripReviews).where(eq(tripReviews.shopId, shopId)),
    ),
    "recap_pulses.csv": await countOf(
      db.select({ n: count() }).from(recapPulses).where(eq(recapPulses.shopId, shopId)),
    ),
    "review_moderation_events.csv": await countOf(
      db
        .select({ n: count() })
        .from(reviewModerationEvents)
        .where(eq(reviewModerationEvents.shopId, shopId)),
    ),
    "dive_packages.csv": await countShopScoped(db, "divePackages", shopId),
    "dive_package_entitlements.csv": await countShopScoped(db, "divePackageEntitlements", shopId),
    "shop_promo_codes.csv": await countShopScoped(db, "shopPromoCodes", shopId),
    "courses.csv": await countShopScoped(db, "courses", shopId),
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
