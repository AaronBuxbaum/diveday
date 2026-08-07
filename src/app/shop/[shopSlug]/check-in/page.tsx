import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { waiverSendCopy } from "@/app/actions/waiver-send-types";
import { BlockedDiverRow } from "@/app/shop/[shopSlug]/_components/today/BlockedDiverRow";
import { EmptyState } from "@/components/EmptyState";
import { OperationalWindowNote, readinessPivots } from "@/components/OperationalWindowNote";
import { PaperWaiverControl } from "@/components/PaperWaiverControl";
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
import {
  ARRIVALS_AHEAD_HOURS,
  ARRIVALS_LOOKBACK_HOURS,
  OPERATIONAL_HORIZON_DAYS,
} from "@/lib/operational-window";
import { requireStaffSession } from "@/lib/session";
import { noticeFromParam, noticeRole } from "@/lib/staff-notices";
import { checkInAction, markWaiverInPersonFromCheckIn } from "./actions";
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
 * A notice query param maps to a message key, never to a sentence — the words
 * come from the staff bundle at render time (docs ADR
 * 20260730-staff-copy-localization). Typing the value as `StaffMessageKey`
 * makes a stale key a compile error rather than a rendered key on screen.
 */
const noticeCopy: Record<
  string,
  { tone: "success" | "danger" | "warning" | "neutral"; key: StaffMessageKey }
> = {
  checked_in: { tone: "success", key: "checkIn.notice.checkedIn" },
  already_checked_in: { tone: "neutral", key: "checkIn.notice.alreadyCheckedIn" },
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
  waiver_in_person: { tone: "success", key: "checkIn.notice.waiverInPerson" },
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

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow={t("checkIn.eyebrow")}
        title={t("checkIn.title")}
        description={t("checkIn.description")}
        // The same window sentence Today and Not ready print, plus the one
        // extra clause naming how counter mode narrows it. The arrivals lens
        // never reaches past the shared horizon (`arrivalsWindowIsInsideHorizon`),
        // so a diver at the counter is always someone the other two also show
        // (task 141, UX persona lens 17).
        meta={
          <OperationalWindowNote
            copy={{
              note: t("shared.operationalWindow.note", { days: OPERATIONAL_HORIZON_DAYS }),
              lens: t("shared.operationalWindow.arrivalsLens", {
                lookback: ARRIVALS_LOOKBACK_HOURS,
                ahead: ARRIVALS_AHEAD_HOURS,
              }),
              pivotsLabel: t("shared.operationalWindow.pivotsLabel"),
            }}
            pivots={readinessPivots(shopSlug, "check_in", {
              today: t("shared.shopNavLinks.today"),
              blockers: t("shared.shopNavLinks.blockers"),
              check_in: t("shared.shopNavLinks.checkIn"),
            })}
          />
        }
        actions={
          <Link href={`/shop/${shopSlug}/check-in/walk-in`} className={buttonClass()}>
            {t("checkIn.walkIn.title")}
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

      <section className="rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-6">
        <CheckInSearch
          query={query}
          copy={{
            label: t("checkIn.search.label"),
            hint: t("checkIn.search.hint"),
            placeholder: t("checkIn.search.placeholder"),
            submit: t("checkIn.search.submit"),
          }}
        />
      </section>

      <section aria-label={t("checkIn.queueAriaLabel")} className="mt-8">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-xl font-semibold">{t("checkIn.readyHeading")}</h2>
            <p className="mt-1 text-sm text-muted">
              {query ? t("checkIn.searchResultsFor", { query }) : t("checkIn.todaysDepartures")}
            </p>
          </div>
          <Badge tone="neutral" tabularNums>
            {t("checkIn.diverCount", { count: queue.length })}
          </Badge>
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
          <div className="rounded-2xl border border-dashed border-success/40 bg-success/5 p-8 text-center">
            <h3 className="font-semibold text-success">{t("checkIn.clearedTitle")}</h3>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {queue.map((row) => {
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
              return (
                <article
                  key={row.bookingId}
                  data-testid={`check-in-card-${row.bookingId}`}
                  className="rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-5"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/shop/${shopSlug}/divers/${row.personId}`}
                          className="text-lg font-semibold hover:text-primary hover:underline"
                        >
                          {row.personName}
                        </Link>
                        {checkedIn ? (
                          <Badge tone="success">{t("checkIn.checkedInBadge")}</Badge>
                        ) : null}
                        {/* The check-in queue's own description promises this
                            split — check-in is arrival, boarding is confirmed
                            on the manifest — but the queue never actually
                            showed it (task 149, UX persona lens 17). */}
                        {row.boarded ? (
                          <Badge tone="primary">{t("checkIn.boardedBadge")}</Badge>
                        ) : null}
                      </div>
                      <Link
                        href={`/shop/${shopSlug}/trips/${row.tripId}/manifest`}
                        className="mt-1 block text-sm font-medium text-primary hover:underline"
                      >
                        {row.tripTitle}
                      </Link>
                      <p className="mt-1 text-sm text-muted">
                        {formatShortDate(row.startsAt, locale, shop.timezone)} ·{" "}
                        {formatTimeRange(row.startsAt, row.endsAt, locale, shop.timezone)}
                      </p>
                      {row.email ? (
                        <p className="mt-1 truncate text-xs text-muted">{row.email}</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {/* The one readiness vocabulary and the one tone per
                          state (src/i18n/readiness-labels.ts). This badge used
                          to say "Needs attention" in warning while the manifest
                          said "Blocked" in danger about the very same diver. */}
                      <Badge tone={readinessStatusTone(row.readiness.status)}>
                        {readinessStatusText(t, row.readiness.status)}
                      </Badge>
                      {checkedIn ? null : ready ? (
                        <form action={checkInAction.bind(null, shopSlug)}>
                          <input type="hidden" name="bookingId" value={row.bookingId} />
                          <button
                            type="submit"
                            className={buttonClass({ className: "whitespace-nowrap" })}
                            aria-label={t("checkIn.checkInAriaLabel", { name: row.personName })}
                          >
                            {t("checkIn.checkInButton")}
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </div>
                  {/* The one blocked-diver presentation, shared with the
                      by-departure view (src/components/today/BlockedDiverRow.tsx).
                      It shows *every* blocker: this card used to stop at three
                      and count the rest, on the one surface where the diver is
                      standing in front of the staffer asking what else is
                      needed. */}
                  {!ready ? (
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
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
