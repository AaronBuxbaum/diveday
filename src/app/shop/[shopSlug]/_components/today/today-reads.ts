import { readArrivalLookup } from "@/db/arrival-elsewhere";
import { canPersonExportIncidentRecord } from "@/db/authz";
import { sharedInHorizonReadiness } from "@/db/blockers";
import type { AppDb } from "@/db/client";
import { getDayCloseout, listHeadCountCloses, shopHasSailedBefore } from "@/db/closeout";
import { shopFirstBooking } from "@/db/first-booking";
import { listFreshFormDrafts } from "@/db/form-drafts";
import { shopHasEverTakenAnOrder } from "@/db/orders";
import { canPersonViewShopReports } from "@/db/reporting";
import { seasonScale } from "@/db/season-scale";
import type { shopByIdCached } from "@/db/shops";
import { shopStripeAccountForRender } from "@/db/stripe-accounts";
import { getShopDayDepartures, getTodayWork } from "@/db/today";
import { countShopTrips } from "@/db/trips";
import { isOrientationDismissed } from "@/db/user-accounts";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { assembleEveningClose, type DayCloseoutState, tomorrowNoon } from "@/lib/closeout";
import { shopCrewTarget } from "@/lib/crew-schedule";
import { seasonStartInstant } from "@/lib/season";
import { type DaySpine, type roleLensFor, spineJobCount } from "@/lib/today";
import type { shopDayBounds } from "@/lib/zoned";
import { readDayMoney } from "./day-money";

/** The day's closeout plus the demo's separate previous dusk station. */
export function assembleTodayEveningClose(
  closeout: Pick<DayCloseoutState, "departures" | "tomorrow" | "carryover">,
  now: Date,
) {
  return assembleEveningClose(closeout.departures, now, closeout.tomorrow, closeout.carryover);
}

/** Whether Today has a boat, task, previous demo close, or instructor session to show. */
export function hasTodayWorkToShow(
  spine: DaySpine,
  eveningClose: ReturnType<typeof assembleEveningClose>,
  lens: ReturnType<typeof roleLensFor>,
  hasSessions: boolean,
) {
  return (
    spineJobCount(spine) > 0 ||
    spine.stations.length > 0 ||
    eveningClose.carryover != null ||
    (lens === "sessions" && hasSessions)
  );
}

type Shop = NonNullable<Awaited<ReturnType<typeof shopByIdCached>>>;

/**
 * **Today's first wave of reads**, started together because each needs only the shop, the reader
 * and the clock; the second wave needs their answers. A read a later branch may discard is still
 * started here — each is bounded, and that branch is mostly a first run with no rows.
 */
export async function readTodayFirstWave({
  db,
  shop,
  personId,
  now,
  arrivalQuery,
  orientationRole,
  season,
}: {
  db: AppDb;
  shop: Shop;
  personId: string;
  now: Date;
  arrivalQuery: string;
  orientationRole: string | null;
  season: { month: number; day: number };
}) {
  const [
    freshDrafts,
    canReadShopMoney,
    evidence,
    { rows: arrivalRows, counterOpen, elsewhere: arrivalElsewhereRows },
    closeout,
    shopTripCount,
    stripeAccount,
    everTakenAnOrder,
    firstBookingRead,
    scale,
    orientationDismissed,
  ] = await Promise.all([
    // The reader's own unfinished forms (ADR 20260906-before-you-ask, decision 3).
    listFreshFormDrafts(db, shop.id, personId, now),
    // **Who on this page may read the shop's money**, asked once, of the database (issue #1930,
    // security review F1).
    //
    // Three things here are gated on it: the owed-refund and stuck-payment rows in the Today queue,
    // the same rows inside the close-out, and the day's takings below. All three read
    // `canPersonViewShopReports` now; two of them read `canViewShopReports(session.user.roles)`
    // until this change, and that is the **JWT's** roles — snapshotted once at sign-in and never
    // re-derived (`src/lib/auth.ts`, `input: false`). A manager demoted to captain this morning
    // still passes `requireStaffSession` as staff, so the stale claim kept handing them owed-refund
    // rows naming a diver and an amount for the life of the session. The live read closes that
    // window, the way export and import already close theirs.
    //
    // One extra bounded read — three indexed selects — on every shop-home render, which is the
    // price of a money gate that revokes.
    canPersonViewShopReports(db, shop.id, personId),
    // One readiness pass for the whole horizon, shared by both shop-day reads below. It costs about
    // ten queries; running it twice would double the page's entire database bill for one collapsed
    // disclosure.
    sharedInHorizonReadiness(db, shop.id, now),
    readArrivalLookup(db, shop.id, arrivalQuery, now),
    // **The day's closing state** (ADR 20260827-clearwater-surface-language, decision 4): how each
    // of today's boats settled, for the evening stations; tomorrow's load-out once they are due back.
    getDayCloseout(db, shop.id, shop.timezone, now, shop),
    // Whether this shop has ever had a departure: the first-run checklist's gate and the
    // first-bookable moment's count, below. A demo shop sits out of both, so it is never asked.
    shop.isDemo ? null : countShopTrips(db, shop.id),
    // The setup ledger's Stripe step and the desk's payments row; a demo shop shows neither.
    shop.isDemo ? null : shopStripeAccountForRender(db, shop.id),
    shop.isDemo ? true : shopHasEverTakenAnOrder(db, shop.id),
    shop.isDemo ? null : shopFirstBooking(db, shop.id, now),
    seasonScale(db, shop.id, shop.timezone, seasonStartInstant(now, shop.timezone, season), now),
    orientationRole === null ? true : isOrientationDismissed(db, personId),
  ]);
  return {
    freshDrafts,
    canReadShopMoney,
    evidence,
    arrivalRows,
    counterOpen,
    arrivalElsewhereRows,
    closeout,
    shopTripCount,
    stripeAccount,
    everTakenAnOrder,
    firstBookingRead,
    scale,
    orientationDismissed,
  };
}

/**
 * **Today's second wave**: the queue (which needs the readiness pass and the money gate) beside
 * the closing reads. Tomorrow is read beside today rather than after it, and only as its departure
 * cards (`getShopDayDepartures`): the jobs behind the disclosure are today's own ranked queue,
 * re-filed, so a job is counted exactly once wherever its boat happens to sail.
 *
 * Two bounded closing reads, and only when there is a day to close over: who made the last roll-call
 * mark on each settled boat, and whether this staffer may generate a departure's log at all (checked
 * against the database rather than the session's roles so a demotion takes effect at once).
 * **The day's money** (`readDayMoney`) is gated on `canReadShopMoney` and the day closing.
 */
export async function readTodaySecondWave({
  db,
  shop,
  shopSlug,
  personId,
  roles,
  now,
  lens,
  t,
  locale,
  canReadShopMoney,
  evidence,
  eveningClose,
  dayBounds,
}: {
  db: AppDb;
  shop: Shop;
  shopSlug: string;
  personId: string;
  roles: Parameters<typeof getTodayWork>[11];
  now: Date;
  lens: ReturnType<typeof roleLensFor>;
  t: StaffTranslator;
  locale: string;
  canReadShopMoney: boolean;
  evidence: Awaited<ReturnType<typeof sharedInHorizonReadiness>>;
  eveningClose: ReturnType<typeof assembleEveningClose>;
  dayBounds: ReturnType<typeof shopDayBounds>;
}) {
  const closingStations = [
    ...eveningClose.stations,
    ...(eveningClose.carryover ? [eveningClose.carryover] : []),
  ];
  const [work, tomorrowDepartures, [headCountCloses, canOpenLog], sailedBefore, dayMoney] =
    await Promise.all([
      getTodayWork(
        db,
        shop.id,
        shopSlug,
        shop.timezone,
        now,
        lens ? personId : undefined,
        t,
        locale,
        // Stuck Stripe operations and failed photo deletions are owner/manager chores — same gate
        // as Reports (task 157), read live above.
        canReadShopMoney,
        evidence,
        shopCrewTarget(shop),
        roles,
        true,
        // The reader themselves, for the one row read by who they are: the
        // unfiled incident reports, re-checked live in the database.
        personId,
      ),
      getShopDayDepartures(db, shop.id, shop.timezone, tomorrowNoon(now, shop.timezone), evidence),
      closingStations.length > 0
        ? Promise.all([
            listHeadCountCloses(
              db,
              shop.id,
              closingStations
                .filter((station) => station.status === "all_home")
                .map(({ tripId, crewAccountedFor }) => ({ tripId, crewClosed: crewAccountedFor })),
            ),
            canPersonExportIncidentRecord(db, shop.id, personId),
          ])
        : ([new Map(), false] as [Map<string, { closedAt: Date; closedBy: string }>, boolean]),
      // The once-ever wording, asked for only in the moment it could apply.
      eveningClose.allHome ? shopHasSailedBefore(db, shop.id, dayBounds.from) : true,
      readDayMoney(db, shop, dayBounds, {
        personId: personId,
        withTakings: eveningClose.closing && canReadShopMoney,
      }),
    ]);
  return { work, tomorrowDepartures, headCountCloses, canOpenLog, sailedBefore, dayMoney };
}
