import { and, eq, ilike, isNull, notInArray, or } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { seatExistingDiverAction } from "@/app/actions/seat-diver";
import { ConnectivityStatus } from "@/components/ConnectivityStatus";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass, tapTargetLinkClass } from "@/components/ui/button";
import { LedgerRow } from "@/components/ui/ledger";
import type { CheckInOutcome, CheckInQueueRow, UndoCheckInOutcome } from "@/db/check-in";
import { listCheckInQueue, listWalkInTrips } from "@/db/check-in";
import { getDb } from "@/db/client";
import { people, personRoles } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { upcomingScheduleStats } from "@/db/trips";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { counterIsClear, counterTally, firstVisitMarksAnException } from "@/lib/check-in";
import { nowDate } from "@/lib/clock";
import { formatDayParts, formatTime } from "@/lib/format";
import { ARRIVALS_AHEAD_HOURS, ARRIVALS_LOOKBACK_HOURS } from "@/lib/operational-window";
import { requireStaffSession } from "@/lib/session";
import { STAFF_DESTINATION_LABEL_KEYS } from "@/lib/staff-destinations";
import { type NoticeCodeOf, noticeFromParam, noticeRole } from "@/lib/staff-notices";
import { CounterInstrument } from "./_components/CounterInstrument";
import { CounterQueue } from "./_components/CounterQueue";
import { DepartureChips } from "./_components/DepartureChips";
import { DepartureMeta } from "./_components/DepartureMeta";
import { checkInAction, markWaiverInPersonFromCheckIn, undoCheckInAction } from "./actions";
import { CheckInQueueRefresh } from "./CheckInQueueRefresh";
import { CheckInSearch } from "./CheckInSearch";
import { counterQueuePath, hasDeparted, selectFocusedDeparture } from "./focus";

// `instant = true` asserts that navigating *into* this page paints
// immediately. It is not a claim that the route has a static shell: the staff
// shell layout declares `instant = false` (read its comment for why), so a
// cold, direct visit still blocks on the session and the shop row. What this
// validates is the navigation staff actually make all day — arriving from
// another `/shop` page, where that shell is already mounted and this
// segment's `loading.tsx` is what paints. See ADR 20260804-instant-navigation.
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
type CheckInNoticeCode = NoticeCodeOf<CheckInRefusal | Exclude<UndoRefusal, "not_checked_in">>;

type NoticeDefinition = {
  tone: "success" | "danger" | "warning" | "neutral";
  key: StaffMessageKey;
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
  // Every walk-in *refusal* now lands back on the walk-in form with the boat
  // still chosen and says which gate it was (`SEAT_SURFACES["walk-in"]`), so
  // the queue only ever carries the two outcomes above. The refusal codes stay
  // mapped here because a link with one on it — a bookmark, a back-navigation
  // to an older URL — should still say something true rather than nothing.
  "walkin-full": { tone: "danger", key: "checkIn.notice.walkinFull" },
  "walkin-already": { tone: "neutral", key: "checkIn.notice.walkinAlready" },
  "walkin-unavailable": { tone: "danger", key: "checkIn.notice.walkinUnavailable" },
  "walkin-invalid": { tone: "danger", key: "checkIn.notice.walkinInvalid" },
  // No `waiver_in_person` either, for the same reason: the diver's row loses
  // its waiver blocker and starts offering check-in, right where the paper
  // control was.
  "waiver-medical-attestation": { tone: "warning", key: "checkIn.notice.waiverMedicalAttestation" },
  "waiver-error": { tone: "danger", key: "checkIn.notice.waiverError" },
};

/**
 * **The counter is a boarding instrument** — ADR
 * 20260827-clearwater-surface-language, decision 9. The count leads as a
 * figure, the queue is names with one large tap each, checked-in rows sink
 * into a collapsed settled group, and a blocked row carries its one fix
 * inline. One departure is in focus at a time, carried in the URL so a
 * `?notice=` refusal lands back on the boat the staffer was working; the
 * day's others are a strip of chips above it.
 */
export default async function CheckInPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ q?: string; trip?: string; notice?: string; bid?: string; tid?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const { q, trip, notice, bid, tid } = await searchParams;
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  if (!shop || shop.id !== session.user.shopId) notFound();
  // Staff read dates in the language their own device asks for, same
  // negotiation as the public pages (docs ADR 20260729-diver-copy-localization).
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);

  const now = nowDate();
  const query = q?.trim() ?? "";
  const queue = await listCheckInQueue(db, shop.id, { query, now });
  // Only asked when the counter has nobody to show and nothing was typed —
  // it is the difference between "the day is quiet" and "there is no schedule
  // yet", and the empty state below cannot say the honest one without it.
  const upcomingDepartures =
    queue.length === 0 && !query ? (await upcomingScheduleStats(db, shop.id)).departures : 0;
  const copy = noticeFromParam(notice, noticeCopy);
  // The `not_ready` refusal links straight to the diver's Trip row instead
  // of just naming the problem — the same rich-link pattern the manifest's
  // `not_ready` refusal already uses (trips/[id]/manifest/page.tsx). The
  // message itself always carries the `<tripLink>` tag, so this always
  // resolves with `t.rich`, never plain `t()` — falling back to the queue
  // itself on the vanishingly unlikely chance `bid`/`tid` didn't round-trip.
  const notReadyHref =
    bid && tid ? `/shop/${shopSlug}/trips/${tid}#booking-${bid}` : `/shop/${shopSlug}/check-in`;
  const noticeContent =
    copy?.key === "checkIn.notice.notReady"
      ? t.rich("checkIn.notice.notReady", {
          tripLink: (chunks) => <Link href={notReadyHref}>{chunks}</Link>,
        })
      : copy
        ? t(copy.key)
        : null;
  const bookedPersonIds = new Set(queue.map((row) => row.personId));
  const otherMatchingDivers = query
    ? await db
        .select({
          id: people.id,
          fullName: people.fullName,
          email: people.email,
          phone: people.phone,
        })
        .from(people)
        .innerJoin(personRoles, eq(personRoles.personId, people.id))
        .where(
          and(
            eq(people.shopId, shop.id),
            eq(personRoles.role, "diver"),
            isNull(people.deletedAt),
            bookedPersonIds.size > 0 ? notInArray(people.id, [...bookedPersonIds]) : undefined,
            or(
              ilike(people.fullName, `%${query}%`),
              ilike(people.email, `%${query}%`),
              ilike(people.phone, `%${query}%`),
            ),
          ),
        )
        .limit(5)
    : [];
  // The page's own clock, not a second reading of the wall — everything above
  // this line is anchored to `now`, and a picker offering a boat the queue has
  // already written off is the drift that costs.
  const openDepartures = query ? await listWalkInTrips(db, shop.id, now) : [];

  // One departure, said once. The queue arrives ordered by departure then
  // name, so grouping is a single pass — and the group header is where the
  // trip's title and time live, leaving each row only what differs about the
  // person (design principle 9).
  //
  // `today` is decided here rather than inside `selectFocusedDeparture`
  // because it is a question about the *shop's* own calendar day: the arrivals
  // window reaches six hours back and thirty-six forward, so tomorrow's first
  // boat is already in this list and must not be mistaken for the one the
  // counter is working.
  const shopToday = calendarDateInTimezone(now, shop.timezone);
  const departures: {
    tripId: string;
    first: CheckInQueueRow;
    startsAt: Date;
    today: boolean;
    rows: CheckInQueueRow[];
  }[] = [];
  for (const row of queue) {
    const last = departures.at(-1);
    if (last && last.tripId === row.tripId) last.rows.push(row);
    else
      departures.push({
        tripId: row.tripId,
        first: row,
        startsAt: row.startsAt,
        today: calendarDateInTimezone(row.startsAt, shop.timezone) === shopToday,
        rows: [row],
      });
  }

  // **A search is a lookup, not the instrument.** Typing a name asks "where is
  // this diver?", which can be answered by a row on any of the day's boats —
  // so a search renders every matching departure and no figure, and the
  // instrument returns the moment the box is cleared. Everything else on the
  // page keys off this one distinction.
  const focus = query ? null : selectFocusedDeparture(departures, trip, now);
  const focusedTripId = focus?.tripId ?? null;
  const checkIn = checkInAction.bind(null, shopSlug, focusedTripId);
  const undo = undoCheckInAction.bind(null, shopSlug, focusedTripId);
  const recordPaperWaiver = markWaiverInPersonFromCheckIn.bind(null, shopSlug, focusedTripId);

  // **Three groups, and every seat is in exactly one of them** — the figure,
  // the remainder words, the meter's bands and the queue's own split all read
  // off one tally (`src/lib/check-in.ts`), so nobody has to subtract to check.
  //
  // `here` is *through* the counter, which is checked in **and** still cleared.
  // A diver who checked in an hour ago and has gone blocked since — a refund
  // landing, a card corrected, a deeper second site — leaves this figure and
  // joins `cantBoard`, so the count goes visibly backwards and the row returns
  // to the working list rather than sitting green in a folded receipt.
  const { here, expected, cantBoard, toCome } = counterTally(focus?.rows ?? []);
  const remainder = focus
    ? [
        toCome > 0 ? t("checkIn.instrument.toCome", { count: toCome }) : null,
        cantBoard > 0 ? t("checkIn.instrument.cantBoard", { count: cantBoard }) : null,
      ]
        .filter(Boolean)
        .join(" · ") || null
    : null;

  // **The email is a disambiguator, so it renders only where it disambiguates.**
  //
  // This page calls itself Counter mode: it is the screen on the front desk
  // that divers queue at, which makes it the one staff surface whose audience
  // is not the person signed in. Printing a personal email under all 26 rows
  // publishes 25 addresses nobody needed so that two same-named divers can be
  // told apart (issue #716) — and whoever is second in the queue can read the
  // address of whoever is first.
  //
  // Ambiguity is judged across the **whole visible queue**, not within one
  // departure: two Anna Kowalskis on different boats are still two rows on one
  // screen, and a staffer reading down the page has the same problem.
  // Case-folded, because "anna kowalski" and "Anna Kowalski" are one collision
  // to a reader.
  const namesSeen = new Map<string, number>();
  for (const row of queue) {
    const key = row.personName.trim().toLocaleLowerCase();
    namesSeen.set(key, (namesSeen.get(key) ?? 0) + 1);
  }
  const nameIsAmbiguous = (personName: string) =>
    (namesSeen.get(personName.trim().toLocaleLowerCase()) ?? 0) > 1;

  // **"First visit" only where it marks somebody out**, judged over the whole
  // visible queue for the same reason the email is: a staffer reads down the
  // page. On a shop's first season every diver is a first visit, so the line
  // rendered under all nine names at once — a row taller each, at exactly the
  // queue length where this surface's promise is a name and one tap, marking
  // nobody. See `firstVisitMarksAnException` (`src/lib/check-in.ts`).
  const showFirstVisit = firstVisitMarksAnException(queue);

  /** One line, two call sites — see `DepartureMeta` for why the word matters. */
  const departureMeta = (startsAt: Date, endsAt: Date) => (
    <DepartureMeta
      startsAt={startsAt}
      endsAt={endsAt}
      now={now}
      locale={locale}
      timeZone={shop.timezone}
      departedLabel={t("checkIn.departed")}
    />
  );

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      {/* Every code this page carries is now a refusal, and the acts that
          succeed re-render it in place without navigating (./actions.ts). So a
          notice has to be one-shot: left in the URL, the walk-in refusal a
          staffer read and dealt with would still be sitting above the queue
          after the next four rows checked in — none of which navigate to
          replace it. `?q=` is deliberately not flashed; the search is state the
          counter is working in, not a message. */}
      <FlashParams params={["notice", "bid", "tid"]} />
      <ShopPageHeader
        eyebrow={t(STAFF_DESTINATION_LABEL_KEYS.checkIn)}
        title={t("checkIn.title")}
        // What this queue *is* — how far either side of now it reaches — which
        // is a fact about the rows below it and nothing a reader can find
        // elsewhere. Gone with it: the shared-window sentence Today used to
        // print here too, and the pivots back to Today, which named a
        // destination the nav tabs and the phone dock already carry one tap
        // away. The arrivals lens never reaches past the shared horizon
        // (`arrivalsWindowIsInsideHorizon`), so a diver at the counter is
        // always someone Today also shows (task 141, UX persona lens 17).
        meta={
          <>
            <p className="mt-1 max-w-2xl text-sm text-muted">
              {t("shared.operationalWindow.arrivalsLens", {
                lookback: ARRIVALS_LOOKBACK_HOURS,
                ahead: ARRIVALS_AHEAD_HOURS,
              })}
            </p>
            {/* **Say it before the tap, not after.** The counter is live-only —
                the boat has an encrypted device copy and this does not — so a
                dropped signal means the board is stale and the next tap will
                not send. `ConnectivityStatus`'s own doc comment anticipated
                exactly this ("a live-only surface like boarding warns its board
                may be stale instead") and nothing in the app had ever mounted
                it that way (issue #819). A staffer who can see the connection
                is down does not have to wonder whether the tap landed. */}
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
          </>
        }
      />

      {copy ? (
        // Seven of this page's codes are refusals (walk-in full, not found,
        // invalid…) — noticeRole gives those `role="alert"` so they announce.
        <ShopNotice tone={copy.tone} role={noticeRole(copy.tone)} className="mb-6">
          {noticeContent}
        </ShopNotice>
      ) : null}

      {/* One departure in focus, the day's others one tap away. Never during
          a search: the results below can span every boat, and a figure about
          one of them would be answering a question nobody asked. */}
      {focus ? (
        <DepartureChips
          ariaLabel={t("checkIn.departuresNavLabel")}
          shopSlug={shopSlug}
          focusedTripId={focus.tripId}
          departures={departures.map((departure) => ({
            tripId: departure.tripId,
            time: formatTime(departure.startsAt, locale, shop.timezone),
            // **Which day, on any chip that is not the shop's today.** The
            // arrivals window holds thirty-six hours forward, so from about
            // 21:00 it carries tomorrow's 8:00 boat beside today's — and below
            // `sm` the chip is only its time, which made those two identical
            // pills. Calendar data, not copy: `Intl` knows the weekday in every
            // locale the app negotiates, in the shop's own zone.
            day: departure.today
              ? null
              : formatDayParts(departure.startsAt, locale, shop.timezone).weekday,
            title: departure.first.tripTitle,
          }))}
        />
      ) : null}

      {focus ? (
        <div className="mt-6">
          <h2 className="text-lg font-semibold">
            {/* Primary ink, not hover-revealed: on a phone there is no hover,
                and this is the door to the boat's manifest. */}
            <Link
              href={`/shop/${shopSlug}/trips/${focus.tripId}/manifest`}
              className={`${tapTargetLinkClass} text-primary hover:underline`}
            >
              {focus.first.tripTitle}
            </Link>
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            {departureMeta(focus.startsAt, focus.first.endsAt)}
          </p>
          <CounterInstrument
            here={here}
            expected={expected}
            cantBoard={cantBoard}
            cleared={counterIsClear(focus.rows)}
            remainder={remainder}
            clearedLabel={t("checkIn.clearedTitle")}
            figure={t.rich("checkIn.instrument.hereOf", {
              here,
              expected,
              figure: (chunks) => (
                <span className="text-4xl font-semibold tabular-nums text-foreground">
                  {chunks}
                </span>
              ),
            })}
          />
        </div>
      ) : null}

      {/* No card around the search box. One input and a button do not need a
          bordered, shadowed panel of their own — that box was 120px of chrome
          between the page title and the first name, on the surface with a line
          of divers waiting in front of it (design principle 10). */}
      <CheckInSearch
        query={query}
        // The focus rides through the search box. Without it the counter's most
        // frequent gesture — type a name, read the row, clear the box — dropped
        // `?trip=` and re-pointed the instrument at whatever
        // `selectFocusedDeparture` picks, one head count for a different boat.
        trip={trip}
        copy={{
          label: t("checkIn.search.label"),
          placeholder: t("checkIn.search.placeholder"),
        }}
      />

      <CheckInQueueRefresh
        copy={{
          pulling: t("checkIn.pullToRefresh.pulling"),
          release: t("checkIn.pullToRefresh.release"),
          refreshing: t("checkIn.pullToRefresh.refreshing"),
        }}
      >
        <section aria-label={t("checkIn.queueAriaLabel")} className="mt-8">
          {query ? (
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h2 className="text-lg font-semibold">{t("checkIn.searchResultsFor", { query })}</h2>
              {/* A count is a fact, not an alert (design principle 9) — quiet
                  tabular text, so a pill on this page always means the
                  exceptional state (Blocked, Boarded). */}
              <p className="text-sm font-medium text-muted tabular-nums">
                {t("checkIn.diverCount", { count: queue.length })}
              </p>
            </div>
          ) : null}

          {queue.length === 0 && !(query && otherMatchingDivers.length > 0) ? (
            // "No one matches that scan" is true of a search that found nobody
            // and false of a counter that has nothing to show — on day one it
            // blamed the staffer's typing for an empty schedule. Three states,
            // each with the door that actually helps: widen the search, wait for
            // the boat, or put a departure on the board.
            <EmptyState
              titleAs="h3"
              title={
                query
                  ? t("checkIn.emptyTitle")
                  : upcomingDepartures > 0
                    ? t("checkIn.emptyQuietTitle")
                    : t("checkIn.emptyNoTripsTitle")
              }
              body={query ? t("checkIn.emptyDescription") : t("checkIn.emptyQuietDescription")}
              action={
                query ? (
                  <Link
                    // Clearing the search returns to the boat the staffer was
                    // working, not to whichever one the default rule picks.
                    href={counterQueuePath(shopSlug, trip ?? null)}
                    scroll={false}
                    className={buttonClass({
                      variant: "secondary",
                      size: "sm",
                      className: "mt-4",
                    })}
                  >
                    {t("checkIn.emptyClearSearch")}
                  </Link>
                ) : (
                  <Link
                    href={`/shop/${shopSlug}/schedule/board`}
                    className={buttonClass({
                      variant: upcomingDepartures > 0 ? "secondary" : "primary",
                      size: "sm",
                      className: "mt-4",
                    })}
                  >
                    {upcomingDepartures > 0
                      ? t("checkIn.emptyViewSchedule")
                      : t("checkIn.emptyScheduleDeparture")}
                  </Link>
                )
              }
            />
          ) : focus ? (
            <CounterQueue
              rows={focus.rows}
              shopSlug={shopSlug}
              isAmbiguousName={nameIsAmbiguous}
              showFirstVisit={showFirstVisit}
              checkInAction={checkIn}
              undoAction={undo}
              waiverAction={recordPaperWaiver}
              // A boat that has sailed is one the counter is reading rather
              // than working: its receipts are the point, so they arrive open.
              settledOpen={hasDeparted(focus.startsAt, now)}
              settledHeadingLevel="h3"
              t={t}
            />
          ) : (
            <div className="flex flex-col gap-8">
              {departures.map((departure) => (
                <div key={departure.tripId}>
                  <h3 className="text-lg font-semibold">
                    <Link
                      href={`/shop/${shopSlug}/trips/${departure.tripId}/manifest`}
                      className={`${tapTargetLinkClass} text-primary hover:underline`}
                    >
                      {departure.first.tripTitle}
                    </Link>
                  </h3>
                  <p className="mt-0.5 mb-2 text-sm text-muted">
                    {departureMeta(departure.startsAt, departure.first.endsAt)}
                  </p>
                  <CounterQueue
                    rows={departure.rows}
                    shopSlug={shopSlug}
                    isAmbiguousName={nameIsAmbiguous}
                    showFirstVisit={showFirstVisit}
                    checkInAction={checkIn}
                    undoAction={undo}
                    waiverAction={recordPaperWaiver}
                    // **A search is a lookup, so nothing it found is folded
                    // away.** This branch renders only while `query` is set,
                    // and the row a staffer typed a name to reach is very often
                    // the settled one they are about to correct — arriving
                    // collapsed made the correction another tap away for
                    // exactly the gesture the counter is built around.
                    settledOpen
                    settledHeadingLevel="h4"
                    t={t}
                  />
                </div>
              ))}
            </div>
          )}

          {otherMatchingDivers.length > 0 ? (
            <div className="mt-8">
              <div className="mb-3">
                <h3 className="text-lg font-semibold">{t("checkIn.otherDiversHeading")}</h3>
                <p className="text-sm text-muted">{t("checkIn.otherDiversDescription")}</p>
              </div>
              <ul className="divide-y divide-border rounded-inset border border-border bg-surface">
                {otherMatchingDivers.map((diver) => (
                  <li
                    key={diver.id}
                    className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/shop/${shopSlug}/divers/${diver.id}`}
                        className={`${tapTargetLinkClass} font-medium text-foreground hover:underline`}
                      >
                        {diver.fullName}
                      </Link>
                      <p className="text-sm text-muted">
                        {[diver.email, diver.phone].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    {openDepartures.length > 0 ? (
                      <div className="flex flex-wrap gap-2 sm:justify-end">
                        {openDepartures.map((departure) => (
                          <form
                            key={departure.tripId}
                            action={seatExistingDiverAction.bind(null, "walk-in", shopSlug)}
                          >
                            <input type="hidden" name="personId" value={diver.id} />
                            <input type="hidden" name="tripId" value={departure.tripId} />
                            <SubmitButton
                              pendingLabel={t("checkIn.addingToDeparture")}
                              className={buttonClass({ variant: "secondary", size: "sm" })}
                              ariaLabel={t("checkIn.addToDepartureFor", {
                                departure: departure.title,
                              })}
                              observabilityAction="check-in-seat-existing"
                            >
                              {t("checkIn.addToDepartureFor", { departure: departure.title })}
                            </SubmitButton>
                          </form>
                        ))}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {query ? (
            <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-inset border border-border/80 bg-surface-sunken/40 p-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">{t("checkIn.addWalkInAction", { query })}</p>
              </div>
              <Link
                href={`/shop/${shopSlug}/check-in/walk-in?diverq=${encodeURIComponent(query)}`}
                aria-label={t("checkIn.addWalkInAction", { query })}
                className={buttonClass({ size: "sm" })}
              >
                {t("checkIn.walkInAction")}
              </Link>
            </div>
          ) : (
            // **The walk-in door stands at the foot of the queue, always.** It
            // used to appear only once a search had failed to find somebody,
            // which is the long way round to the act a counter performs a
            // dozen times a morning. A ledger row rather than a button: it is
            // the last line of the list, not a second primary competing with
            // the taps above it (ADR 20260827-clearwater-surface-language,
            // decision 9).
            <div className="mt-6">
              <LedgerRow
                as="div"
                size="lg"
                href={`/shop/${shopSlug}/check-in/walk-in`}
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
          )}
        </section>
      </CheckInQueueRefresh>
    </main>
  );
}
