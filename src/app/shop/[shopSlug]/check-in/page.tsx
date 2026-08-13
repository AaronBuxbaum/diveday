import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { waiverSendCopy } from "@/app/actions/waiver-send-types";
import { BlockedDiverRow } from "@/app/shop/[shopSlug]/_components/today/BlockedDiverRow";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import { PaperWaiverControl } from "@/components/PaperWaiverControl";
import { CHECK_IN_ROW_TONE } from "@/components/row-tones";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { listCheckInQueue } from "@/db/check-in";
import { getDb } from "@/db/client";
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
import { noticeFromParam, noticeRole } from "@/lib/staff-notices";
import { checkInAction, markWaiverInPersonFromCheckIn, undoCheckInAction } from "./actions";
import { CheckInSearch } from "./CheckInSearch";
import { QueueRowButton } from "./QueueRowButton";

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
 * A notice query param maps to a message key, never to a sentence — the words
 * come from the staff bundle at render time (docs ADR
 * 20260730-staff-copy-localization). Typing the value as `StaffMessageKey`
 * makes a stale key a compile error rather than a rendered key on screen.
 */
const noticeCopy: Record<
  string,
  { tone: "success" | "danger" | "warning" | "neutral"; key: StaffMessageKey }
> = {
  // No success entries for checking in or undoing one: the row itself settles
  // into (or out of) "Checked in ☑️" beside the tap that did it, and a banner
  // at the top of the page would say the same fact a screen away (design
  // principle 9; docs/design/forms-and-controls.md). Every remaining code is a
  // refusal or a walk-in/waiver outcome with no row state to land on.
  not_ready: { tone: "warning", key: "checkIn.notice.notReady" },
  not_bookable: { tone: "danger", key: "checkIn.notice.notBookable" },
  not_found: { tone: "danger", key: "checkIn.notice.notFound" },
  staff_not_found: { tone: "danger", key: "checkIn.notice.staffNotFound" },
  invalid: { tone: "danger", key: "checkIn.notice.invalid" },
  walkin_added: { tone: "success", key: "checkIn.notice.walkinAdded" },
  // The counter's *ordinary* outcome, not an edge case: a walk-in added on a
  // name alone has no address to mail a waiver to, so the notice has to say
  // the link is still owed rather than let "Added" imply it went out.
  walkin_added_waiver_undelivered: {
    tone: "warning",
    key: "checkIn.notice.walkinAddedWaiverUndelivered",
  },
  walkin_full: { tone: "danger", key: "checkIn.notice.walkinFull" },
  walkin_already: { tone: "neutral", key: "checkIn.notice.walkinAlready" },
  walkin_unavailable: { tone: "danger", key: "checkIn.notice.walkinUnavailable" },
  walkin_invalid: { tone: "danger", key: "checkIn.notice.walkinInvalid" },
  // No `waiver_in_person` either, for the same reason: the diver's row loses
  // its waiver blocker and starts offering check-in, right where the paper
  // control was.
  waiver_medical_attestation: { tone: "warning", key: "checkIn.notice.waiverMedicalAttestation" },
  waiver_error: { tone: "danger", key: "checkIn.notice.waiverError" },
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
        description={t("checkIn.description")}
        // What this queue *is* — how far either side of now it reaches — which
        // is a fact about the rows below it and nothing a reader can find
        // elsewhere. Gone with it: the shared-window sentence Today used to
        // print here too, and the pivots back to Today, which named a
        // destination the nav tabs and the phone dock already carry one tap
        // away. The arrivals lens never reaches past the shared horizon
        // (`arrivalsWindowIsInsideHorizon`), so a diver at the counter is
        // always someone Today also shows (task 141, UX persona lens 17).
        meta={
          <p className="mt-1 max-w-2xl text-sm text-muted">
            {t("shared.operationalWindow.arrivalsLens", {
              lookback: ARRIVALS_LOOKBACK_HOURS,
              ahead: ARRIVALS_AHEAD_HOURS,
            })}
          </p>
        }
        actions={
          // Secondary, and a verb: the page's action is the queue itself —
          // every ready row is one tap — so the rare walk-in door at the top
          // never competes at primary weight (design principle 8).
          <Link
            href={`/shop/${shopSlug}/check-in/walk-in`}
            className={buttonClass({ variant: "secondary" })}
          >
            {t("checkIn.walkInAction")}
          </Link>
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
          <h2 className="text-xl font-semibold">
            {query ? t("checkIn.searchResultsFor", { query }) : t("checkIn.todaysDepartures")}
          </h2>
          {/* A count is a fact, not an alert (design principle 9) — quiet
              tabular text, so a pill on this page always means the
              exceptional state (Blocked, Boarded). */}
          <p className="text-sm font-medium text-muted tabular-nums">
            {t("checkIn.diverCount", { count: queue.length })}
          </p>
        </div>

        {queue.length === 0 ? (
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
              {query
                ? t("checkIn.emptyDescription")
                : upcomingDepartures > 0
                  ? t("checkIn.emptyQuietDescription")
                  : t("checkIn.emptyNoTripsDescription")}
            </p>
            {query ? (
              <Link
                href={`/shop/${shopSlug}/check-in`}
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
            <p className="mx-auto mt-1 max-w-md text-sm text-muted">{t("checkIn.clearedBody")}</p>
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
                <section
                  key={departure.tripId}
                  aria-labelledby={`departure-${departure.tripId}`}
                  className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm"
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
                      // Who this row is: the name, the quiet email that tells
                      // two same-named divers apart, and the one exceptional
                      // badge (boarded on the manifest). One builder for all
                      // three row states so they can never drift apart — the
                      // blocked row passes a name wrapped in its record link,
                      // the tappable rows pass the plain name (their tap is
                      // spoken for).
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
                          {row.email ? (
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
                            <form action={checkInAction.bind(null, shopSlug)}>
                              <input type="hidden" name="bookingId" value={row.bookingId} />
                              <QueueRowButton
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
                              </QueueRowButton>
                            </form>
                          ) : checkedIn ? (
                            <form action={undoCheckInAction.bind(null, shopSlug)}>
                              <input type="hidden" name="bookingId" value={row.bookingId} />
                              <QueueRowButton
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
                              </QueueRowButton>
                            </form>
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
                                      t={t}
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
                </section>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
