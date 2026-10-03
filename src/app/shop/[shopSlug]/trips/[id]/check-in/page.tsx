import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConnectivityStatus } from "@/components/ConnectivityStatus";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice } from "@/components/ShopPageHeader";
import { buttonClass } from "@/components/ui/button";
import { LedgerRow } from "@/components/ui/ledger";
import { FIGURE_HERO_CLASS } from "@/components/ui/typography";
import type {
  ArrivalOfflineRefusal,
  CheckInOutcome,
  CheckInQueueRow,
  UndoCheckInOutcome,
} from "@/db/check-in";
import { listCheckInQueue } from "@/db/check-in";
import { type MarkNoShowOutcome, noShowSalvage, type UndoNoShowOutcome } from "@/db/no-show";
import { latestTripStage } from "@/db/trip-stages";
import { getTripWithBooked } from "@/db/trips";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import {
  counterIsClear,
  counterTally,
  firstVisitMarksAnException,
  isNoShowAtCounter,
  isSettledAtCounter,
} from "@/lib/check-in";
import { nowDate } from "@/lib/clock";
import { formatWeekdayTime } from "@/lib/format";
import { type NoShowClaim, noShowClaim, noShowGate } from "@/lib/no-show";
import { arrivalsWindow } from "@/lib/operational-window";
import { requireShopSurface } from "@/lib/session";
import { STAFF_DESTINATION_LABEL_KEYS } from "@/lib/staff-destinations";
import {
  type NoticeCodeOf,
  noticeForForm,
  noticeFromParam,
  noticeRole,
  shopPath,
} from "@/lib/staff-notices";
import { tripPhaseOf } from "@/lib/trip-phase";
import { hasSailed } from "@/lib/trips";
import { uuidParam } from "@/lib/uuid";
import { TripCapacityBadge, TripPageHeader } from "../_components/TripPageHeader";
import { TripTabs } from "../_components/TripTabs";
import { tripTabsCopy } from "../_components/trip-tabs-copy";
import { CounterInstrument } from "./_components/CounterInstrument";
import { CounterQueue } from "./_components/CounterQueue";
import type { CounterIdentityCopy } from "./_components/CounterQueueRow";
import type { NoShowSalvageCopy } from "./_components/NoShowScript";
import {
  checkInAction,
  confirmIdentityFromCheckIn,
  markNoShowAction,
  markWaiverInPersonFromCheckIn,
  undoCheckInAction,
  undoNoShowAction,
} from "./actions";
import { CheckInQueueRefresh } from "./CheckInQueueRefresh";
import { noShowSalvageCopy } from "./salvage-copy";

// `instant = true` asserts that navigating *into* this page paints
// immediately — this segment's `loading.tsx`, with no request read above it.
// Since the staff shell became synchronous (issue 1446) that holds for a cold,
// direct visit too: the shell's session, shop row and nav stream in beside the
// page from `ShopChrome` rather than above it, so the route gets a static
// shell and its own reads are the only ones the reader waits on. See ADR
// 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = {
  title: "Check-in — DiveDay",
};

/**
 * The refusals the two counter mutations beside this file can answer with, in
 * the spelling that reaches this page's URL.
 *
 * `undoCheckInAction` translates its one divergent reason (`not_checked_in`) to
 * the queue's `not-bookable` before redirecting and passes the rest straight
 * through, so this is exactly what those two domain unions can put in the query.
 * Deriving it rather than listing it holds the two halves of the `?notice=`
 * pattern together — an emitter in `./actions.ts`, a map here: **a reason added
 * to either union with no words below is a compile error.**
 *
 * Precisely that and no more. The reverse — a map entry left behind after a
 * reason is deleted — is *not* caught, because the map also carries codes from
 * two vocabularies this page only borrows (`SEAT_SURFACES["walk-in"]` and
 * `recordInPersonWaiver`, plus the actions' own `invalid`), and accepting those
 * means an index signature, which accepts anything else too. That is a real
 * limit, written down rather than implied, because a guard claimed to be
 * stronger than it is gets trusted where it does not hold.
 *
 * It has already caught one in the direction it does cover: `checkInBooking`'s
 * union carries `already_checked_in`, which had no entry below. Nothing was red,
 * because the code path answers idempotent success instead — but a union member
 * nothing returns is a member the next edit can start returning, and the counter
 * would have said nothing at all.
 */
type CheckInRefusal = Extract<CheckInOutcome, { ok: false }>["reason"];
type UndoRefusal = Extract<UndoCheckInOutcome, { ok: false }>["reason"];
/**
 * `ArrivalOfflineRefusal` is excluded because those three answer a device
 * reconciling a queued tap, not a staffer at the desk — there is no redirect
 * that can carry one here. See its own note in `src/db/check-in.ts`.
 *
 * The counter's two no-show mutations answer in their own vocabulary, and
 * every one of their refusals reaches this page prefixed (`no_show_…`) so it
 * cannot collide with the arrival codes above: "not found" means two different
 * rows depending on which tap produced it, and one map entry for both would
 * have said the wrong one (issue #1209).
 */
type MarkNoShowRefusal = Extract<MarkNoShowOutcome, { ok: false }>["reason"];
type UndoNoShowRefusal = Extract<UndoNoShowOutcome, { ok: false }>["reason"];
type NoShowRefusal = MarkNoShowRefusal | UndoNoShowRefusal;
type CheckInNoticeCode = NoticeCodeOf<
  | Exclude<CheckInRefusal | Exclude<UndoRefusal, "not_checked_in">, ArrivalOfflineRefusal>
  | `no_show_${NoShowRefusal}`
>;

type NoticeDefinition = {
  tone: "success" | "danger" | "warning" | "neutral";
  key: StaffMessageKey;
  /**
   * The form these words belong beside, when they belong beside one at all.
   * The roster's table carries the same field for the same reason
   * (`TripNoticeBanner.tsx`): a refusal about one booking in a list of them is
   * only useful next to that booking. Absent means page-level — the banner is
   * the right home, and most of this table is that.
   */
  form?: string;
};

type BorrowedNoticeMap = Record<string, NoticeDefinition>;
/** Loose in the keys it accepts, exact in the ones it demands. */
type NoticeMap = BorrowedNoticeMap & Record<CheckInNoticeCode, NoticeDefinition>;

/**
 * A notice query param maps to a message key, never to a sentence — the words
 * come from the staff bundle at render time (docs ADR
 * 20260730-staff-copy-localization). Typing the value as `StaffMessageKey`
 * makes a stale key a compile error rather than a rendered key on screen.
 *
 * The `Record<string, …>` half is what lets the walk-in and waiver codes below
 * sit here too: those arrive from `SEAT_SURFACES["walk-in"]` and
 * `recordInPersonWaiver`, whose own vocabularies this page only borrows.
 */
const noticeCopy: NoticeMap = {
  // No success entries for checking in or undoing one: the row itself settles
  // into (or out of) "Checked in" beside the tap that did it, and a banner
  // at the top of the page would say the same fact a screen away (design
  // principle 9; docs/design/forms-and-controls.md). Every remaining code is a
  // refusal or a walk-in/waiver outcome with no row state to land on.
  "not-ready": { tone: "warning", key: "checkIn.notice.notReady" },
  "not-bookable": { tone: "danger", key: "checkIn.notice.notBookable" },
  // Neutral, not a refusal: a diver who is already checked in is a diver in the
  // state the staffer wanted, so the sentence states the fact rather than
  // scolding a second tap. `checkInBooking` answers this case with idempotent
  // success today and the row itself says "Checked in" — this exists because
  // the reason is still in its union, and a union member with no words is one
  // edit away from a counter that says nothing.
  "already-checked-in": { tone: "neutral", key: "checkIn.notice.alreadyCheckedIn" },
  "not-found": { tone: "danger", key: "checkIn.notice.notFound" },
  "staff-not-found": { tone: "danger", key: "checkIn.notice.staffNotFound" },
  invalid: { tone: "danger", key: "checkIn.notice.invalid" },
  "walkin-added": { tone: "success", key: "checkIn.notice.walkinAdded" },
  // The counter's *ordinary* outcome, not an edge case: a walk-in added on a
  // name alone has no address to mail a waiver to, so the notice has to say
  // the link is still owed rather than let "Added" imply it went out.
  "walkin-added-waiver-undelivered": {
    tone: "warning",
    key: "checkIn.notice.walkinAddedWaiverUndelivered",
  },
  // The counter's name-match prompt hands a booking an existing diver's record
  // on a guess, and the seat is held until someone confirms it is the same
  // person (H-13, issue #1556). Said here rather than left for the check-in tap
  // to refuse: that refusal arrives with the diver at the counter.
  //
  // The queue row carries its own confirm (issue #1696), so the sentence
  // points at the row.
  "walkin-added-identity-unconfirmed": {
    tone: "warning",
    key: "checkIn.notice.walkinAddedIdentityUnconfirmed",
  },
  // No `waiver_in_person` either, for the same reason: the diver's row loses
  // its waiver blocker and starts offering check-in, right where the paper
  // control was.
  //
  // All three carry `form: "waiver"`, so they land on the row whose paper
  // release was refused rather than at the top of the page (issue 1574). Each
  // is a refusal a staffer has to *act* on with the diver in front of them,
  // which is the case the roster's `form` routing exists for.
  "waiver-medical-attestation": {
    tone: "warning",
    key: "checkIn.notice.waiverMedicalAttestation",
    form: "waiver",
  },
  "waiver-guardian-name": {
    tone: "danger",
    key: "checkIn.notice.waiverGuardianName",
    form: "waiver",
  },
  "waiver-error": { tone: "danger", key: "checkIn.notice.waiverError", form: "waiver" },
  // **The no-show refusals** (issue #1209). No success entry for either tap,
  // the same rule as checking in: the row moves into the "Not here" group, or
  // back out of it, under the finger that did it.
  //
  // The safety ones are the two roll-call refusals, and they say different
  // sentences because the desk's next act differs. `no-show-already-boarded` is
  // the calm half: the crew recorded this diver onto the boat, so the counter
  // is being asked to take a person off the expected list while somebody may be
  // counting heads at the rail. A refusal with an instruction attached, because
  // the staffer is not wrong to want it — the roll call simply outranks the desk.
  "no-show-already-boarded": { tone: "danger", key: "checkIn.notice.noShowAlreadyBoarded" },
  // And the loud half: a crew member has recorded that this diver did not come
  // back from a dive. The desk is standing at the one screen that can reach
  // the boat and the emergency contact, so the sentence names the fact rather
  // than the rule that produced it (issue #1704).
  "no-show-already-missing-after-dive": {
    tone: "danger",
    key: "checkIn.notice.noShowAlreadyMissingAfterDive",
  },
  // **The identity confirm's one refusal** (issue #1696). Its success has no
  // entry, for the same reason checking in has none: the row loses its confirm
  // control and its identity blocker under the finger that did it. This is the
  // race — a double tap, or a row another staffer cleared while this one was
  // reading it — and the row it is about looks exactly as it did, so there is
  // nothing on the page that says it.
  "identity-not-held": { tone: "neutral", key: "checkIn.notice.identityNotHeld" },
  "no-show-already-marked": { tone: "neutral", key: "checkIn.notice.noShowAlreadyMarked" },
  "no-show-not-booked": { tone: "neutral", key: "checkIn.notice.noShowNotBooked" },
  // Both taps answer this one: nobody fails to show for a boat that never left,
  // and nobody goes back on one either. The sentence says the departure is
  // cancelled without instructing a fix, because the fix differs by tap.
  "no-show-trip-cancelled": { tone: "neutral", key: "checkIn.notice.noShowTripCancelled" },
  "no-show-before-departure": { tone: "warning", key: "checkIn.notice.noShowBeforeDeparture" },
  "no-show-window-closed": { tone: "warning", key: "checkIn.notice.noShowWindowClosed" },
  "no-show-not-marked": { tone: "neutral", key: "checkIn.notice.noShowNotMarked" },
  // The seat was resold between the mark and the Undo, which is the one
  // refusal here a staffer genuinely could not have seen coming.
  "no-show-trip-full": { tone: "danger", key: "checkIn.notice.noShowTripFull" },
  // Same race, tighter limit: on a ratio-gated course session the boat can
  // still have room while the instructor does not. This is the refusal that
  // keeps a walk-up and a late participant from making a third student.
  "no-show-course-ratio-full": { tone: "danger", key: "checkIn.notice.noShowCourseRatioFull" },
  // Both taps can answer these two, and they mean the same thing they mean
  // above — the same words, reached through the prefixed code.
  "no-show-not-found": { tone: "danger", key: "checkIn.notice.notFound" },
  "no-show-staff-not-found": { tone: "danger", key: "checkIn.notice.staffNotFound" },
};

/**
 * **A departure's Check-in tab: the counter, pointed at this boat** — ADR
 * 20261001-logbook, decision 3, and the instrument of ADR
 * 20260827-clearwater-surface-language, decision 9. The count leads as a
 * figure, the queue is names with one large tap each, checked-in rows sink
 * into a collapsed settled group, and a blocked row carries its one fix
 * inline.
 *
 * It used to be a day-wide page of its own (`/check-in?trip=`), which the tab
 * opened by leaving the departure: a different header, no tabs, and a strip of
 * the day's other boats. The departure is the boat now, and finding a diver
 * whose boat nobody knows is Today's arrival search.
 *
 * The queue is the counter's arrivals window (`arrivalsWindow`) narrowed to
 * this departure, so a boat next week or one long gone shows no queue and
 * says when its counter opens.
 */
export default async function TripCheckInPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
  searchParams: Promise<{ notice?: string; bid?: string; tid?: string }>;
}) {
  const { shopSlug, id: tripId } = await params;
  if (!uuidParam(tripId)) notFound();
  const { notice, bid, tid } = await searchParams;
  const { db, shop } = await requireShopSurface(shopSlug);
  // Staff read dates in the language their own device asks for, same
  // negotiation as the public pages (docs ADR 20260729-diver-copy-localization).
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);

  const now = nowDate();
  const [trip, stageReading, rows] = await Promise.all([
    getTripWithBooked(db, shop.id, tripId),
    latestTripStage(db, shop.id, tripId),
    listCheckInQueue(db, shop.id, { now, tripId }),
  ]);
  if (!trip) notFound();
  const phase = tripPhaseOf({
    startsAt: trip.startsAt,
    endsAt: trip.endsAt,
    now,
    timeZone: shop.timezone,
    stage: stageReading,
    cancelled: trip.status === "cancelled",
  });
  const arrivals = arrivalsWindow(now);
  const onCounter =
    trip.status === "scheduled" && trip.startsAt >= arrivals.from && trip.startsAt <= arrivals.to;

  const copy = noticeFromParam(notice, noticeCopy);
  // The `not_ready` refusal links straight to the diver's row on the Divers
  // tab instead of just naming the problem — the same rich-link pattern the
  // manifest's `not_ready` refusal uses. The message always carries the
  // `<tripLink>` tag, so it always resolves with `t.rich`.
  const notReadyHref =
    bid && tid
      ? `/shop/${shopSlug}/trips/${tid}#booking-${bid}`
      : shopPath(shopSlug, "trips", tripId);
  const noticeContent =
    copy?.key === "checkIn.notice.notReady"
      ? t.rich("checkIn.notice.notReady", {
          tripLink: (chunks) => <Link href={notReadyHref}>{chunks}</Link>,
        })
      : copy
        ? t(copy.key)
        : null;
  // **A refusal about one booking belongs beside that booking.** The notice
  // names the form it belongs to, the row owning that form renders it
  // (`noticeForForm`), and whatever is left over falls through to the banner.
  const waiverNotice =
    copy?.form && bid
      ? noticeForForm(
          { form: copy.form, tone: copy.tone, text: t(copy.key), bookingId: bid, code: notice },
          "waiver",
        )
      : undefined;
  const waiverNoticeOnRow =
    waiverNotice &&
    rows.some(
      (row) =>
        row.bookingId === waiverNotice.bookingId &&
        // **And a row that can actually show it.** A settled seat renders as a
        // compact receipt with no blocker block and no `extra` slot at all
        // (`CounterQueueRow`'s early return), so routing a refusal there and
        // standing the banner down says it nowhere.
        !isSettledAtCounter(row),
    )
      ? waiverNotice
      : undefined;

  const checkIn = checkInAction.bind(null, shopSlug, tripId);
  const undo = undoCheckInAction.bind(null, shopSlug, tripId);
  const recordPaperWaiver = markWaiverInPersonFromCheckIn.bind(null, shopSlug, tripId);
  const markNoShow = markNoShowAction.bind(null, shopSlug, tripId);
  const undoNoShow = undoNoShowAction.bind(null, shopSlug, tripId);
  const confirmIdentity = confirmIdentityFromCheckIn.bind(null, shopSlug, tripId);

  /**
   * **The identity confirm's words, per row** (issue #1696). The trigger names
   * the diver because the queue can hold three held seats at once and a run of
   * identical "Confirm this is…" buttons is one a staffer taps on the wrong
   * row.
   */
  const identityCopyFor = (row: CheckInQueueRow): CounterIdentityCopy => ({
    trigger: t("checkIn.identity.trigger", { name: row.personName }),
    message: t("checkIn.identity.message", { name: row.personName }),
    confirm: t("checkIn.identity.confirm"),
    cancel: t("checkIn.identity.cancel"),
    confirming: t("checkIn.identity.confirming"),
  });

  // **"Not here?" opens when the boat leaves without them**, and says something
  // different once it is gone. `markBookingNoShow` runs the same gate again
  // against locked rows, so this decides only whether the disclosure exists
  // and which script it carries (#1209).
  //
  // `tripStatus` is `"scheduled"` because `listCheckInQueue` filters to that;
  // the gate re-reads the live value for itself when the tap lands.
  const noShowClaimFor = (row: CheckInQueueRow): NoShowClaim | null =>
    noShowGate({
      bookingStatus: row.bookingStatus,
      onTheWater: row.onTheWater,
      tripStatus: "scheduled",
      startsAt: row.startsAt,
      now,
    }) === "eligible"
      ? noShowClaim({ startsAt: row.startsAt, now })
      : null;

  // **One salvage read, and only when the boat actually holds a released
  // seat** — a wait-list read plus, only when nobody is waiting, a bounded
  // read of the board.
  const salvage = rows.some(isNoShowAtCounter)
    ? await noShowSalvage(db, { shopId: shop.id, tripId, now })
    : null;
  const salvageFor = (row: CheckInQueueRow): NoShowSalvageCopy | undefined => {
    if (!salvage || !isNoShowAtCounter(row)) return undefined;
    return noShowSalvageCopy({
      t,
      offer: salvage,
      shopSlug,
      tripId,
      diver: { id: row.personId, name: row.personName },
      formatWhen: (startsAt) => formatWeekdayTime(startsAt, locale, shop.timezone),
    });
  };

  // **Three groups, and every seat is in exactly one of them** — the figure,
  // the remainder words, the meter's bands and the queue's own split all read
  // off one tally (`src/lib/check-in.ts`), so nobody has to subtract to check.
  const { here, expected, cantBoard, toCome, notHere } = counterTally(rows);
  const remainder =
    [
      toCome > 0 ? t("checkIn.instrument.toCome", { count: toCome }) : null,
      cantBoard > 0 ? t("checkIn.instrument.cantBoard", { count: cantBoard }) : null,
      notHere > 0 ? t("checkIn.instrument.notHere", { count: notHere }) : null,
    ]
      .filter(Boolean)
      .join(" · ") || null;

  // **The email is a disambiguator, so it renders only where it disambiguates**
  // (issue #716): this screen faces the divers queuing at the desk, so an
  // address prints only under a name the queue holds twice. Case-folded,
  // because "anna kowalski" and "Anna Kowalski" are one collision to a reader.
  const namesSeen = new Map<string, number>();
  for (const row of rows) {
    const key = row.personName.trim().toLocaleLowerCase();
    namesSeen.set(key, (namesSeen.get(key) ?? 0) + 1);
  }
  const nameIsAmbiguous = (personName: string) =>
    (namesSeen.get(personName.trim().toLocaleLowerCase()) ?? 0) > 1;
  // **"First visit" only where it marks somebody out** — see
  // `firstVisitMarksAnException` (`src/lib/check-in.ts`).
  const showFirstVisit = firstVisitMarksAnException(rows);

  // A walk-in can only be seated on a boat that has not left: the seat action
  // refuses one that is underway, so the door is not drawn there.
  const walkInOpen = onCounter && !hasSailed(trip.startsAt, now);

  return (
    <>
      {/* Every code this page carries is a refusal or a walk-in outcome, and
          the acts that succeed re-render it in place without navigating
          (./actions.ts). So a notice is one-shot: left in the URL, a refusal
          a staffer read and dealt with would still be sitting above the queue
          after the next four rows checked in. */}
      <FlashParams params={["notice", "bid", "tid"]} />
      <TripPageHeader
        boardHref={shopPath(shopSlug, "schedule", "board")}
        backLabel={t(STAFF_DESTINATION_LABEL_KEYS.board)}
        trip={trip}
        locale={locale}
        timeZone={shop.timezone}
        badge={
          <TripCapacityBadge trip={trip} cancelledLabel={t("trips.detail.cancelledBadge")} t={t} />
        }
        // **The counter on paper** (Aaron, 2026-10-03): the departure's packet —
        // its manifest carries every diver's waiver and readiness state — so a
        // dead tablet at the desk costs a printer rather than the queue. A
        // real link, like Today's day packet, so no popup blocker can refuse it.
        actions={
          <Link
            href={shopPath(shopSlug, "trips", tripId, "print")}
            target="_blank"
            rel="noreferrer"
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            {t("trips.about.printPacket")}
          </Link>
        }
        // **Say it before the tap, not after.** The counter is live-only —
        // the boat has an encrypted device copy and this does not — so a
        // dropped signal means the board is stale and the next tap will not
        // send (issue #819).
        extraMeta={
          <ConnectivityStatus
            offlineLabel={t("checkIn.offlineLabel")}
            onlyWhenOffline
            className="mt-2"
            copy={{
              online: t("shared.connectivity.online"),
              onlineTitle: t("shared.connectivity.onlineTitle"),
              offlineTitle: t("shared.connectivity.offlineTitle"),
            }}
          />
        }
      />
      <TripTabs
        shopSlug={shopSlug}
        tripId={tripId}
        current="checkin"
        phase={phase}
        copy={tripTabsCopy(t)}
      />

      {copy && !waiverNoticeOnRow ? (
        // Suppressed only once the message has actually landed on a row, never
        // merely because it named a form (issue 1574).
        <ShopNotice tone={copy.tone} role={noticeRole(copy.tone)} className="mt-6">
          {noticeContent}
        </ShopNotice>
      ) : null}

      {!onCounter ? (
        // A boat outside the counter's window: next week's, one long gone, or
        // a cancelled one. Nothing to tap, and the one sentence says why.
        <EmptyState
          className="mt-10"
          title={
            trip.status === "cancelled"
              ? t("checkIn.closed.cancelled")
              : trip.startsAt > arrivals.to
                ? t("checkIn.closed.notYet")
                : t("checkIn.closed.gone")
          }
        />
      ) : (
        <CheckInQueueRefresh
          copy={{
            pulling: t("checkIn.pullToRefresh.pulling"),
            release: t("checkIn.pullToRefresh.release"),
            refreshing: t("checkIn.pullToRefresh.refreshing"),
          }}
        >
          {rows.length > 0 ? (
            <div className="mt-8">
              <CounterInstrument
                here={here}
                expected={expected}
                cantBoard={cantBoard}
                cleared={counterIsClear(rows)}
                remainder={remainder}
                clearedLabel={t("checkIn.clearedTitle")}
                figure={t.rich("checkIn.instrument.hereOf", {
                  here,
                  expected,
                  figure: (chunks) => (
                    <span className={`${FIGURE_HERO_CLASS} text-foreground`}>{chunks}</span>
                  ),
                })}
              />
            </div>
          ) : null}
          <section aria-label={t("checkIn.queueAriaLabel")} className="mt-8">
            {rows.length === 0 ? (
              <EmptyState titleAs="h3" title={t("checkIn.emptyBoatTitle")} />
            ) : (
              <CounterQueue
                rows={rows}
                shopSlug={shopSlug}
                today={calendarDateInTimezone(now, shop.timezone)}
                isAmbiguousName={nameIsAmbiguous}
                showFirstVisit={showFirstVisit}
                checkInAction={checkIn}
                undoAction={undo}
                waiverAction={recordPaperWaiver}
                waiverNotice={waiverNoticeOnRow}
                noShowClaimFor={noShowClaimFor}
                markNoShowAction={markNoShow}
                undoNoShowAction={undoNoShow}
                confirmIdentityAction={confirmIdentity}
                identityCopyFor={identityCopyFor}
                salvageFor={salvageFor}
                // A boat that has sailed is one the counter is reading rather
                // than working: its receipts are the point, so they arrive open.
                settledOpen={hasSailed(trip.startsAt, now)}
                settledHeadingLevel="h3"
                // The walk-in door follows, flush, as the queue's last line.
                endsOpen={walkInOpen}
                t={t}
              />
            )}
            {walkInOpen ? (
              // **The walk-in door stands at the foot of the queue, always** —
              // a ledger row rather than a button: it is the last line of the
              // list, not a second primary competing with the taps above it.
              <div className={rows.length > 0 ? undefined : "mt-6"}>
                <LedgerRow
                  as="div"
                  size="lg"
                  href={shopPath(shopSlug, "trips", tripId, "check-in", "walk-in")}
                  linkLabel={t("checkIn.walkInAction")}
                  leading={
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.8}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="size-[18px] text-primary"
                    >
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  }
                >
                  <span className="font-medium text-primary">{t("checkIn.walkInAction")}</span>
                </LedgerRow>
              </div>
            ) : null}
          </section>
        </CheckInQueueRefresh>
      )}
    </>
  );
}
