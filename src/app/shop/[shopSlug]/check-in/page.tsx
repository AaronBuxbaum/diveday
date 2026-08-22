import { and, eq, ilike, isNull, notInArray, or } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { seatExistingDiverAction } from "@/app/actions/seat-diver";
import { waiverSendCopy } from "@/app/actions/waiver-send-types";
import { BlockedDiverRow } from "@/app/shop/[shopSlug]/_components/today/BlockedDiverRow";
import { ConnectivityStatus } from "@/components/ConnectivityStatus";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import { PaperWaiverControl } from "@/components/PaperWaiverControl";
import { paperWaiverCopy } from "@/components/paper-waiver-copy";
import { CHECK_IN_ROW_TONE } from "@/components/row-tones";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import type { CheckInOutcome, UndoCheckInOutcome } from "@/db/check-in";
import { listCheckInQueue, listWalkInTrips } from "@/db/check-in";
import { getDb } from "@/db/client";
import { people, personRoles } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { upcomingScheduleStats } from "@/db/trips";
import { readinessStatusText, readinessStatusTone } from "@/i18n/readiness-labels";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { blockerFixFor } from "@/lib/blockers";
import { allDiversCheckedIn } from "@/lib/check-in";
import { formatShortDate, formatTimeRange } from "@/lib/format";
import { ARRIVALS_AHEAD_HOURS, ARRIVALS_LOOKBACK_HOURS } from "@/lib/operational-window";
import { requireStaffSession } from "@/lib/session";
import { type NoticeCodeOf, noticeFromParam, noticeRole } from "@/lib/staff-notices";
import { checkInAction, markWaiverInPersonFromCheckIn, undoCheckInAction } from "./actions";
import { CheckInActionForm } from "./CheckInActionForm";
import { CheckInSearch } from "./CheckInSearch";

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
  // into (or out of) "Checked in ☑️" beside the tap that did it, and a banner
  // at the top of the page would say the same fact a screen away (design
  // principle 9; docs/design/forms-and-controls.md). Every remaining code is a
  // refusal or a walk-in/waiver outcome with no row state to land on.
  "not-ready": { tone: "warning", key: "checkIn.notice.notReady" },
  "not-bookable": { tone: "danger", key: "checkIn.notice.notBookable" },
  // Neutral, not a refusal: a diver who is already checked in is a diver in the
  // state the staffer wanted, so the sentence states the fact rather than
  // scolding a second tap. `checkInBooking` answers this case with idempotent
  // success today and the row itself says "Checked in ☑️" — this exists because
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

export default async function CheckInPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ q?: string; notice?: string; bid?: string; tid?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const { q, notice, bid, tid } = await searchParams;
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  if (!shop || shop.id !== session.user.shopId) notFound();
  // Staff read dates in the language their own device asks for, same
  // negotiation as the public pages (docs ADR 20260729-diver-copy-localization).
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);

  const query = q?.trim() ?? "";
  const queue = await listCheckInQueue(db, shop.id, { query });
  // Only asked when the counter has nobody to show and nothing was typed —
  // it is the difference between "the day is quiet" and "there is no schedule
  // yet", and the empty state below cannot say the honest one without it.
  const upcomingDepartures =
    queue.length === 0 && !query ? (await upcomingScheduleStats(db, shop.id)).departures : 0;
  const copy = noticeFromParam(notice, noticeCopy);
  // The `not_ready` refusal links straight to the diver's guest row instead
  // of just naming the problem — the same rich-link pattern the manifest's
  // `not_ready` refusal already uses (trips/[id]/manifest/page.tsx). The
  // message itself always carries the `<guestsLink>` tag, so this always
  // resolves with `t.rich`, never plain `t()` — falling back to the queue
  // itself on the vanishingly unlikely chance `bid`/`tid` didn't round-trip.
  const notReadyHref =
    bid && tid
      ? `/shop/${shopSlug}/trips/${tid}/guests#booking-${bid}`
      : `/shop/${shopSlug}/check-in`;
  const noticeContent =
    copy?.key === "checkIn.notice.notReady"
      ? t.rich("checkIn.notice.notReady", {
          guestsLink: (chunks) => <Link href={notReadyHref}>{chunks}</Link>,
        })
      : copy
        ? t(copy.key)
        : null;
  // Only the full, unsearched day's roster can be "cleared" — a filtered
  // search matching one already-checked-in diver says nothing about anyone
  // else still pending elsewhere.
  const cleared = !query && allDiversCheckedIn(queue);

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
  const openDepartures = query ? await listWalkInTrips(db, shop.id) : [];

  // One departure, said once. The queue arrives ordered by departure then
  // name, so grouping is a single pass — and the group header is where the
  // trip's title, time, and "4 of 9 checked in" progress live, leaving each
  // row only what differs about the person (design principle 9).
  const departures: { tripId: string; first: (typeof queue)[number]; rows: typeof queue }[] = [];
  for (const row of queue) {
    const last = departures.at(-1);
    if (last && last.tripId === row.tripId) last.rows.push(row);
    else departures.push({ tripId: row.tripId, first: row, rows: [row] });
  }

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
        eyebrow={t("checkIn.eyebrow")}
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
            <span className="mt-2 inline-flex">
              <ConnectivityStatus
                offlineLabel={t("checkIn.offlineLabel")}
                copy={{
                  online: t("shared.connectivity.online"),
                  onlineTitle: t("shared.connectivity.onlineTitle"),
                  offlineTitle: t("shared.connectivity.offlineTitle"),
                }}
              />
            </span>
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

      {/* No card around the search box. One input and a button do not need a
          bordered, shadowed panel of their own — that box was 120px of chrome
          between the page title and the first name, on the surface with a line
          of divers waiting in front of it (design principle 10). */}
      <CheckInSearch
        query={query}
        copy={{
          label: t("checkIn.search.label"),
          placeholder: t("checkIn.search.placeholder"),
          submit: t("checkIn.search.submit"),
        }}
      />

      <section aria-label={t("checkIn.queueAriaLabel")} className="mt-8">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          {/* The heading *is* the scope — "Ready at the counter" sat above a
              list that includes everyone blocked, with a second line under it
              naming what the list actually held. One honest line instead of a
              slogan plus its correction. */}
          <h2 className="text-lg font-semibold">
            {query ? t("checkIn.searchResultsFor", { query }) : t("checkIn.todaysDepartures")}
          </h2>
          {/* A count is a fact, not an alert (design principle 9) — quiet
              tabular text, so a pill on this page always means the
              exceptional state (Blocked, Boarded). */}
          <p className="text-sm font-medium text-muted tabular-nums">
            {t("checkIn.diverCount", { count: queue.length })}
          </p>
        </div>

        {queue.length === 0 && !(query && otherMatchingDivers.length > 0) ? (
          // "No one matches that scan" is true of a search that found nobody
          // and false of a counter that has nothing to show — on day one it
          // blamed the staffer's typing for an empty schedule. Three states,
          // each with the door that actually helps: widen the search, wait for
          // the boat, or put a departure on the board.
          <EmptyState>
            <h3 className="font-semibold">
              {query
                ? t("checkIn.emptyTitle")
                : upcomingDepartures > 0
                  ? t("checkIn.emptyQuietTitle")
                  : t("checkIn.emptyNoTripsTitle")}
            </h3>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted">
              {query ? t("checkIn.emptyDescription") : t("checkIn.emptyQuietDescription")}
            </p>
            {query ? (
              <Link
                href={`/shop/${shopSlug}/check-in`}
                scroll={false}
                className={buttonClass({ variant: "secondary", size: "sm", className: "mt-4" })}
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
            )}
          </EmptyState>
        ) : cleared ? (
          // The counter's finish line is an earned moment (design principle 3):
          // the `rise-in` entrance is the confirmation-panel motion, and the
          // door onward is Today — where the day continues once nobody is
          // waiting at the desk.
          <div className="rise-in rounded-2xl border border-dashed border-success/40 bg-success/5 p-8 text-center">
            <h3 className="font-semibold text-success">{t("checkIn.clearedTitle")}</h3>
            <Link
              href={`/shop/${shopSlug}`}
              className={buttonClass({ variant: "secondary", size: "sm", className: "mt-4" })}
            >
              {t("checkIn.clearedAction")}
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {departures.map((departure) => {
              const { first } = departure;
              const checkedInCount = departure.rows.filter(
                (row) => row.bookingStatus === "checked_in",
              ).length;
              const allAboard = checkedInCount === departure.rows.length;
              return (
                <SectionCard
                  as="div"
                  key={departure.tripId}
                  padding="none"
                  className="overflow-hidden"
                >
                  <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border px-4 py-3 sm:px-5">
                    <div className="min-w-0">
                      <h3 id={`departure-${departure.tripId}`} className="font-semibold">
                        {/* Primary ink, not hover-revealed: on a phone there is
                            no hover, and this is the door to the boat's
                            manifest. */}
                        <Link
                          href={`/shop/${shopSlug}/trips/${departure.tripId}/manifest`}
                          className="text-primary hover:underline"
                        >
                          {first.tripTitle}
                        </Link>
                      </h3>
                      <p className="mt-0.5 text-sm text-muted">
                        {formatShortDate(first.startsAt, locale, shop.timezone)} ·{" "}
                        {formatTimeRange(first.startsAt, first.endsAt, locale, shop.timezone)}
                      </p>
                    </div>
                    {/* Not color alone: the count itself says how far along the
                        boat is; the success ink only underlines a finished one. */}
                    <p
                      className={`text-sm font-medium tabular-nums ${allAboard ? "text-success" : "text-muted"}`}
                    >
                      {t("checkIn.departureProgress", {
                        checkedIn: checkedInCount,
                        total: departure.rows.length,
                      })}
                    </p>
                  </header>
                  <div className="divide-y divide-border">
                    {departure.rows.map((row) => {
                      const ready = row.readiness.status === "ready";
                      const checkedIn = row.bookingStatus === "checked_in";
                      const fix = ready
                        ? null
                        : blockerFixFor(
                            row.readiness.blockers,
                            {
                              shopSlug,
                              tripId: row.tripId,
                              personId: row.personId,
                              bookingId: row.bookingId,
                              fullName: row.personName,
                            },
                            t,
                          );
                      // Who this row is: the name, the one exceptional badge
                      // (boarded on the manifest), and — only where two visible
                      // divers share a name — the quiet email that tells them
                      // apart. One builder for all three row states so they can
                      // never drift apart: the blocked row passes a name wrapped
                      // in its record link, the tappable rows pass the plain name
                      // (their tap is spoken for).
                      const showEmail = nameIsAmbiguous(row.personName);
                      const identityFor = (name: React.ReactNode) => (
                        <>
                          <span className="flex flex-wrap items-center gap-2">
                            {name}
                            {/* The check-in queue's own description promises this
                                split — check-in is arrival, boarding is confirmed
                                on the manifest — but the queue never actually
                                showed it (task 149, UX persona lens 17). */}
                            {row.boarded ? (
                              <Badge tone="primary">{t("checkIn.boardedBadge")}</Badge>
                            ) : null}
                          </span>
                          {showEmail && row.email ? (
                            <span className="mt-0.5 block truncate text-sm text-muted">
                              {row.email}
                            </span>
                          ) : null}
                        </>
                      );
                      const identity = identityFor(
                        <span className="block font-semibold">{row.personName}</span>,
                      );
                      // One line per person, one tap — the same roll-call
                      // grammar the manifest and the Today queue speak. The
                      // whole row is the control: tapping it checks the diver
                      // in, and tapping the settled row again undoes it
                      // (design principle 7's re-tap, so a mis-tap at a busy
                      // counter costs one more tap, never a confirm dialog).
                      // The left rule + trailing words carry the state — never
                      // color alone — and the wall of identical primary
                      // "Check in" buttons this replaces is gone (principle 8).
                      return (
                        <article
                          key={row.bookingId}
                          data-testid={`check-in-card-${row.bookingId}`}
                          className={`border-l-4 ${
                            checkedIn
                              ? CHECK_IN_ROW_TONE.checkedIn
                              : ready
                                ? CHECK_IN_ROW_TONE.awaiting
                                : CHECK_IN_ROW_TONE.blocked
                          }`}
                        >
                          {ready && !checkedIn ? (
                            <CheckInActionForm
                              action={checkInAction.bind(null, shopSlug)}
                              bookingId={row.bookingId}
                              sendFailedLabel={t("checkIn.sendFailed")}
                              ariaLabel={t("checkIn.checkInAriaLabel", { name: row.personName })}
                              className="hover:bg-surface-sunken/60"
                              trailing={
                                <span className="flex items-center gap-2 text-base font-semibold whitespace-nowrap text-primary">
                                  {t("checkIn.checkInButton")}
                                  {/* The empty half of the roll-call check: a
                                      circle waiting to be ticked, so the row
                                      reads as a checklist line, not a link. */}
                                  <span className="size-5 rounded-full border-2 border-current" />
                                </span>
                              }
                              pendingTrailing={
                                // The circle stays put while the word changes,
                                // so the row's right edge never jumps on the
                                // one interaction this surface repeats all day.
                                <span className="flex items-center gap-2 text-base font-semibold whitespace-nowrap text-muted">
                                  {t("checkIn.checkingIn")}
                                  <span className="size-5 rounded-full border-2 border-current opacity-40" />
                                </span>
                              }
                            >
                              {identity}
                            </CheckInActionForm>
                          ) : checkedIn ? (
                            <CheckInActionForm
                              action={undoCheckInAction.bind(null, shopSlug)}
                              bookingId={row.bookingId}
                              sendFailedLabel={t("checkIn.sendFailed")}
                              ariaLabel={t("checkIn.undoAriaLabel", { name: row.personName })}
                              className="hover:bg-success/15"
                              trailing={
                                <span className="text-base font-semibold whitespace-nowrap text-success">
                                  {t("checkIn.checkedInCheck")}
                                </span>
                              }
                              pendingTrailing={
                                <span className="text-base font-semibold whitespace-nowrap text-muted">
                                  {t("checkIn.undoing")}
                                </span>
                              }
                            >
                              {identity}
                            </CheckInActionForm>
                          ) : (
                            <div className="px-4 py-3 sm:px-5">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="min-w-0">
                                  {/* Only the blocked row keeps a name link — its
                                      job is the fix, and the diver's record is one
                                      of the doors. Primary ink at rest, not
                                      hover-revealed: on a phone there is no hover,
                                      and an invisible link is no door at all. */}
                                  {identityFor(
                                    <Link
                                      href={`/shop/${shopSlug}/divers/${row.personId}`}
                                      className="font-semibold text-primary hover:underline"
                                    >
                                      {row.personName}
                                    </Link>,
                                  )}
                                </div>
                                {/* The one readiness vocabulary and tone
                                    (src/i18n/readiness-labels.ts) — for a blocked
                                    diver the badge is the state. */}
                                <Badge tone={readinessStatusTone(row.readiness.status)}>
                                  {readinessStatusText(t, row.readiness.status)}
                                </Badge>
                              </div>
                              {/* The one blocked-diver presentation, shared with the
                                  by-departure view (src/components/today/BlockedDiverRow.tsx).
                                  It shows *every* blocker: this card used to stop at three
                                  and count the rest, on the one surface where the diver is
                                  standing in front of the staffer asking what else is
                                  needed. */}
                              <BlockedDiverRow
                                layout="below"
                                shopSlug={shopSlug}
                                surface="check_in"
                                waiverCopy={waiverSendCopy(t)}
                                blockers={row.readiness.blockers}
                                fix={fix}
                                // Behind a tap on this surface alone. The badge
                                // above still says Blocked in danger tone, and
                                // every reason is one tap away — what waits for
                                // that tap is the queue reading a diver's
                                // outstanding payment over a shoulder (#716).
                                collapseReasons={{
                                  summary: t("checkIn.blockerReasons", {
                                    count: row.readiness.blockers.length,
                                  }),
                                }}
                                t={t}
                                extra={
                                  // A diver at the counter with a signed paper release in
                                  // hand: record it here rather than sending them (and the
                                  // staffer) off to the trip's guest list for the one
                                  // control that clears this blocker. Offered on the same
                                  // condition the roster uses — a waiver still to come —
                                  // and kept under the primary "send the link" action,
                                  // because attesting to paper is the fallback.
                                  fix?.sendsWaiver ? (
                                    <PaperWaiverControl
                                      action={markWaiverInPersonFromCheckIn.bind(null, shopSlug)}
                                      bookingId={row.bookingId}
                                      copy={paperWaiverCopy(t)}
                                      className="mt-2"
                                    />
                                  ) : null
                                }
                              />
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                </SectionCard>
              );
            })}
          </div>
        )}

        {otherMatchingDivers.length > 0 ? (
          <div className="mt-8">
            <div className="mb-3">
              <h3 className="text-lg font-semibold">{t("checkIn.otherDiversHeading")}</h3>
              <p className="text-sm text-muted">{t("checkIn.otherDiversDescription")}</p>
            </div>
            <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
              {otherMatchingDivers.map((diver) => (
                <li
                  key={diver.id}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/shop/${shopSlug}/divers/${diver.id}`}
                      className="font-medium text-foreground hover:underline"
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
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border/80 bg-surface-sunken/40 p-4">
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
        ) : null}
      </section>
    </main>
  );
}
