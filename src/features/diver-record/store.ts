import { assistsAvailable } from "@/features/assists";
import type { DiverProfile } from "@/features/diver-profile";
import {
  bookingIsAhead,
  buildDiverStatus,
  type DiverStatusRow,
  nextBookingAhead,
} from "@/features/diver-status";
import { getDiverProfile } from "@/features/divers";
import { listOpenCounterRentalsForPerson } from "@/features/gear-counter-rentals";
import { listGuardianEmails } from "@/features/guardian-erasure";
import { canRaiseInvoiceFor } from "@/features/invoice-door";
import { lastKnownDive } from "@/features/last-dive";
import { openLostItemsByPerson } from "@/features/lost-items";
import { personSentMessages } from "@/features/person-sent-messages";
import { serviceReminderStates } from "@/features/work-order-follow-up";
import { listCustomerGearItems, listWorkOrdersForPerson } from "@/features/work-orders";
import {
  canPersonDeleteDiver,
  canPersonErasePersonalData,
  canPersonManageOrders,
  canPersonMergeDiver,
  canPersonOverrideGearRequest,
  canPersonReadMedicalClearanceDocument,
} from "../../db/authz";
import type { AppDb } from "../../db/client";
import { diverPackageBalance } from "../../db/dive-packages";
import { listDiverMergeCandidates } from "../../db/diver-merge";
import { canPersonExportShopData } from "../../db/export";
import { countGearItems } from "../../db/gear";
import { personThread } from "../../db/inbound-messages";
import { listDiverRecordNotes, pagedDiverActivity } from "../../db/operations";
import { PAGE_SIZE } from "../../db/paging";
import { getBookingsReadiness } from "../../db/readiness";
import { canAcceptPayments, getShopStripeAccount } from "../../db/stripe-accounts";
import { offsetUpcomingTripsWithCounts } from "../../db/trips";
import { calendarDateInTimezone } from "../../lib/calendar-date";
import { nowDate } from "../../lib/clock";
import { BLOCKER_CATEGORY, type ReadinessResult } from "../../lib/readiness";
import { customerGearDueDates } from "../../lib/work-order-follow-up";

/**
 * **Which of the record's controls this staffer is shown.** Hiding is a
 * courtesy, not the gate: every action re-checks the same live roles.
 *
 * Diver deletion and merging are owner/manager only (H-20260724-staff-role-reach, ADR
 * 20260724-role-authorization). Rewriting a diver's stated rental fit is
 * instructor/divemaster/manager work (H-20260724-initial-gear-policy-sizing); flagging them for hands-on fitting
 * stays open to all staff. Erasing a diver's personal and medical data is
 * stricter still: owner only, one way, and never offered to anyone else (ADR
 * 20260802-diver-data-erasure).
 */
async function loadDiverRecordGates(db: AppDb, shopId: string, actorPersonId: string) {
  const [
    canDelete,
    canMerge,
    canOverrideFit,
    canErase,
    canExport,
    canOpenClearance,
    canManageOrders,
  ] = await Promise.all([
    canPersonDeleteDiver(db, shopId, actorPersonId),
    canPersonMergeDiver(db, shopId, actorPersonId),
    canPersonOverrideGearRequest(db, shopId, actorPersonId),
    canPersonErasePersonalData(db, shopId, actorPersonId),
    // Same owner/manager gate the shop-wide export uses (issue #726): a
    // subject-access request properly goes through the same door as the
    // shop's own copy of everything, re-checked against the database like
    // the other roles on this page.
    canPersonExportShopData(db, shopId, actorPersonId),
    // The physician's evaluation itself (issue #1283). Owner/manager, and
    // deliberately not the staff who may *record* a clearance; the reasoning
    // is at `canReadMedicalClearanceDocument`. The route re-checks the same
    // live roles before it signs anything.
    canPersonReadMedicalClearanceDocument(db, shopId, actorPersonId),
    // Raising an invoice against this diver (#1920). Three gates already stand
    // behind the link (`orders?add=1`'s own `allow:`, its action's re-check, and
    // `src/db/orders.ts` refusing at the write), so it was never a hole, only a
    // door a captain could not walk through. `src/db/authz.ts` states the rule
    // it broke: the UI hides the control when the permission is false, so a
    // crew member is never shown a button they will be bounced from (ADR
    // 20260724-role-authorization).
    canPersonManageOrders(db, shopId, actorPersonId),
  ]);
  return {
    canDelete,
    canMerge,
    canOverrideFit,
    canErase,
    canExport,
    canOpenClearance,
    canManageOrders,
  };
}

/**
 * Everything the record's gear half shows, read by the page in its one batch so the
 * sections below it only render: the diver's own pieces and the bench's tickets on them
 * (ADR 20261008-gear-work-orders), which of those pieces already had a service reminder,
 * the counter rentals they have out, and whether the shop has a fleet to rent from at all.
 *
 * Shop-scoped from the session like every read on the page. A removed record is never
 * offered "Rent gear", so it skips the fleet count.
 */
export async function loadDiverGear(
  db: AppDb,
  shop: { id: string; timezone: string; workOrdersEnabled: boolean },
  personId: string,
  { removed }: { removed: boolean },
) {
  const [ownPieces, workOrders, counterRentals, fleetSize, canAssist] = await Promise.all([
    listCustomerGearItems(db, shop.id, personId),
    listWorkOrdersForPerson(db, shop.id, personId, {
      todayLocal: calendarDateInTimezone(nowDate(), shop.timezone),
    }),
    listOpenCounterRentalsForPerson(db, shop.id, personId),
    removed ? 0 : countGearItems(db, shop.id),
    // Claude's desk assists on this record (the card photo, the gear note):
    // false while they are dark, and never for a removed record.
    removed ? false : assistsAvailable(db, shop.id),
  ]);
  const reminders = await serviceReminderStates(
    db,
    shop.id,
    ownPieces.filter((piece) => customerGearDueDates(piece).length > 0).map((piece) => piece.id),
  );
  return {
    ownPieces,
    workOrders,
    // Gear servicing switched off (the Features page): the group is not drawn,
    // and the pieces and tickets are kept for when it is on.
    workOrdersOffered: shop.workOrdersEnabled,
    counterRentals,
    hasFleet: fleetSize > 0,
    reminders,
    canAssist,
  };
}

/**
 * The database half of the status ledger: read the readiness of the departure
 * this diver is next on, and hand it to the pure {@link buildDiverStatus}.
 *
 * `getBookingsReadiness` is the batched form of the entry the Today queue and
 * the manifest read — the same `listTripsReadiness` pipeline — so this
 * page can never disagree with the boat about who is cleared. There is
 * deliberately no second detector here (ADR 20260827-people-not-lists).
 */
async function diverStatusRows(
  db: AppDb,
  shopId: string,
  diver: DiverProfile,
  now: Date = nowDate(),
  options: { collectHasSomewhereToGo?: boolean } = {},
): Promise<DiverStatusRow[]> {
  const next = nextBookingAhead(diver, now);
  if (!next) return buildDiverStatus(diver, null, { now, ...options });
  const ahead = diver.bookings
    .filter((entry) => bookingIsAhead(entry, now))
    .sort((a, b) => a.trip.startsAt.getTime() - b.trip.startsAt.getTime());
  // One batched read for every departure ahead, not one roster read per seat
  // (issue #2058): a diver on a long package would otherwise pay for each.
  const byBooking = await getBookingsReadiness(
    db,
    shopId,
    ahead.map((entry) => entry.booking.id),
  );
  const measured = ahead.map((entry) => ({
    entry,
    readiness: byBooking.get(entry.booking.id) ?? null,
  }));
  const readiness = measured.find(({ entry }) => entry === next)?.readiness ?? null;
  return buildDiverStatus(diver, readiness, {
    now,
    ...options,
    certification: certificationDeparture(measured),
  });
}

/**
 * **Which departure the certification row speaks for.** The next one that
 * holds this diver back on a card, so a Friday wreck they are not certified
 * for is not hidden behind a Sunday reef they are. A trip they are not yet
 * certified for outranks one they are training toward: the first needs
 * somebody to act, the second only needs the course to run. Undefined when
 * no departure ahead has a card problem, and the next boat decides the row.
 */
function certificationDeparture(
  measured: readonly {
    entry: DiverProfile["bookings"][number];
    readiness: ReadinessResult | null;
  }[],
) {
  const withCardProblem = measured.filter(({ readiness }) =>
    readiness?.blockers.some((blocker) => BLOCKER_CATEGORY[blocker.code] === "certification"),
  );
  return (
    withCardProblem.find(
      ({ readiness }) =>
        !readiness?.blockers.some((blocker) => blocker.code === "certification_in_training"),
    ) ?? withCardProblem[0]
  );
}

/**
 * **Whether that was the last thing** — asked *after* a mutation, by the
 * actions that can resolve the final open item (ADR
 * 20260827-clearwater-surface-language, decision 11: every coral moment is
 * condition-derived and transient, never stored).
 *
 * Re-reads the record rather than reasoning from what the action just wrote,
 * because "nothing is waiting" is a claim about the whole record and a card
 * verified two tabs ago is exactly the fact a local guess would miss. Costs one
 * profile read on the success path of four actions.
 *
 * Fails closed to `false`: a record we could not read is not a record we say is
 * clear.
 */
export async function diverRecordIsClear(
  db: AppDb,
  shopId: string,
  personId: string,
  now: Date = nowDate(),
): Promise<boolean> {
  const diver = await getDiverProfile(db, shopId, personId, { includeRemoved: true });
  if (!diver) return false;
  return (await diverStatusRows(db, shopId, diver, now)).length === 0;
}

type DiverRecordShop = {
  id: string;
  timezone: string;
  workOrdersEnabled: boolean;
};

/**
 * **The diver record's whole question in one call** (issue #2757): the
 * profile, then — unless it is gone or merged away — two concurrent waves. The
 * first holds what the reader may do, the shop's payment account, the notes,
 * the activity page, the conversation, the gear half and the package balance;
 * the second the reads that need the first's gates (merge candidates, guardian
 * addresses), the status ledger, the departures the booking picker pages, the
 * found items and the last known dive.
 *
 * `includeRemoved`: a removed diver's record has to stay reachable, because
 * the record is where the way back lives (`RestoreDiver`). A merged-away
 * record answers only where it went, so a stale bookmark cannot make a staffer
 * act on the source row again.
 */
export async function getDiverRecord(
  db: AppDb,
  shop: DiverRecordShop,
  personId: string,
  input: {
    viewerPersonId: string;
    /** The Activity group's page, as typed; a non-number reads as page 1. */
    activityPage: number;
    /** The booking picker's page of eligible departures. */
    bookingPage: number;
    now: Date;
  },
) {
  const { now } = input;
  const diver = await getDiverProfile(db, shop.id, personId, { includeRemoved: true });
  if (!diver) return null;
  if (diver.person.mergedIntoPersonId) {
    return { kind: "merged" as const, mergedInto: diver.person.mergedIntoPersonId };
  }
  const removed = Boolean(diver.person.deletedAt);
  const [can, stripeAccount, notes, activityPage, thread, sent, gear, packages] = await Promise.all(
    [
      loadDiverRecordGates(db, shop.id, input.viewerPersonId),
      getShopStripeAccount(db, shop.id),
      listDiverRecordNotes(db, shop.id, personId),
      // Shop-scoped from the session, never the slug, like every read here. The
      // query clamps anything past the end, so a stale bookmark lands on the
      // last real page.
      pagedDiverActivity(db, shop.id, personId, { page: input.activityPage }),
      // What this diver wrote and what the shop wrote back, interleaved by time.
      personThread(db, shop.id, personId),
      // What the shop sent them: the other half of the conversation.
      personSentMessages(db, shop.id, personId),
      loadDiverGear(db, shop, personId, { removed }),
      diverPackageBalance(db, shop.id, personId, now),
    ],
  );
  // `orders?add=1` refuses outright without a payable account, so the story's
  // foot simply omits "New invoice" rather than offering a link that bounces.
  const paymentsConnected = canAcceptPayments(stripeAccount);
  // **The one place the ledger's "Collect" act has nowhere to go.** With no
  // order raised, that act is `#the-story`, whose only act is the very link the
  // line above may have removed — so the row keeps its sentence and loses its
  // fix (issue #1926). Asked through `canRaiseInvoiceFor` so the record and the
  // story cannot answer it differently.
  const collectHasSomewhereToGo = canRaiseInvoiceFor(diver, {
    canManageOrders: can.canManageOrders,
    paymentsConnected,
  });
  const [mergeCandidates, status, departures, guardianEmails, found, lastDive] = await Promise.all([
    can.canMerge && !removed ? listDiverMergeCandidates(db, shop.id, personId) : [],
    // The readiness of the departure this diver is next on, read through the
    // entry the Today queue and the manifest already use — never a second
    // detector.
    diverStatusRows(db, shop.id, diver, now, { collectHasSomewhereToGo }),
    // The picker pages eligible departures after excluding this diver's seats.
    offsetUpcomingTripsWithCounts(db, shop.id, {
      hasSpace: true,
      excludeBookedForPersonId: personId,
      includeDepartureBuffer: true,
      limit: PAGE_SIZE.section,
      page: input.bookingPage,
      now,
    }),
    // The co-signing guardians' addresses, for the owner's control that erases
    // one on the guardian's request (H-20261007-guardian-email-erasure).
    can.canErase ? listGuardianEmails(db, shop.id, personId) : [],
    openLostItemsByPerson(db, shop.id, [personId]),
    lastKnownDive(db, {
      shopId: shop.id,
      personId,
      timezone: shop.timezone,
      now,
      recorded: diver.person.lastDiveOn,
      reportedOn: diver.person.lastDiveReportedOn,
    }),
  ]);
  return {
    kind: "record" as const,
    diver,
    removed,
    can,
    paymentsConnected,
    collectHasSomewhereToGo,
    notes,
    activityPage,
    thread,
    sent,
    gear,
    packages,
    mergeCandidates,
    status,
    departures,
    guardianEmails,
    found,
    lastDive,
  };
}
