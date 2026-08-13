import Link from "next/link";
import { waiverSendCopy } from "@/app/actions/waiver-send-types";
import { BlockedDiverRow } from "@/app/shop/[shopSlug]/_components/today/BlockedDiverRow";
import { UrgencyBand } from "@/app/shop/[shopSlug]/_components/today/UrgencyBand";
import { WaiverSendControl } from "@/app/shop/[shopSlug]/_components/today/WaiverSendControl";
import { EmptyState } from "@/components/EmptyState";
import { Pager } from "@/components/Pager";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import type { BlockerQueue } from "@/db/blockers";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { URGENCY_KEYS } from "@/i18n/today-labels";
import type { BlockerQueueTrip } from "@/lib/blockers";
import { distinctBlockedDivers, groupBlockerTrips, waiverBookingIds } from "@/lib/blockers";
import { formatDateTimeTz } from "@/lib/format";
import { BLOCKERS_TRIPS_PER_PAGE, pageOf } from "@/lib/operational-window";

/**
 * The shop home's **by-departure** view of the work queue: every diver who
 * can't board yet, grouped under the boat they hold up.
 *
 * This was a route of its own (`/shop/<slug>/blockers`) until it folded into
 * Today. It never was a separate product — it ran byte-for-byte the same two
 * queries as the Today queue and re-ranked them, and the Today ADR
 * (20260720-today-work-queue) had already rejected a separate attention route
 * for exactly that reason. What it *is* is a second, genuinely useful sort of
 * the same evidence: a front desk working the week ahead wants one boat's list
 * at a time, and a one-tap "send all waivers" per departure that a
 * chronological queue can't offer.
 *
 * Everything that made it worth keeping survives verbatim, because each part
 * exists for a reason someone hit:
 *
 * - **per-departure groups** with the batch send, the reason for the view;
 * - **`alsoOn` annotations**, so a diver booked on two boats reads as one
 *   person to fix once rather than two strangers;
 * - **pagination**, because 26 departures once rendered as a single unbroken
 *   ~10,700px scroll (the shape the orders index was found in) — a blocker
 *   list must never truncate, so the tail is a page away, never dropped;
 * - **the `truncated` disclosure**, for a shop with more departures inside one
 *   week than any triage list should carry.
 *
 * One thing this view used to lack that the urgency view always had: a sense
 * of *how soon*. A page of ten departure cards read identically whether the
 * first boat left in twenty minutes or next Thursday. Departure cards now
 * group under the same four urgency bands the other view ranks by
 * (`groupBlockerTrips`, `src/lib/blockers.ts`), with the same fold rule —
 * "Next 3 days"/"This week" collapse to a heading and count once something
 * more pressing has already rendered in full, on the same page. The two
 * views were always the same evidence sorted two ways; now they also *look*
 * equally urgent for the same boat.
 */

function DiverRow({
  diver,
  shopSlug,
  t,
}: {
  diver: BlockerQueueTrip["divers"][number];
  shopSlug: string;
  t: StaffTranslator;
}) {
  return (
    <li className="px-4 py-4 sm:px-5">
      {/* The one blocked-diver presentation, shared with the check-in counter
          (src/components/today/BlockedDiverRow.tsx). */}
      <BlockedDiverRow
        layout="beside"
        shopSlug={shopSlug}
        surface="blockers"
        waiverCopy={waiverSendCopy(t)}
        blockers={diver.blockers}
        fix={diver.fix}
        t={t}
        identity={
          <Link
            href={`/shop/${shopSlug}/divers/${diver.personId}`}
            className="font-semibold hover:text-primary hover:underline"
          >
            {diver.fullName}
          </Link>
        }
        meta={
          diver.alsoOn.length > 0 ? (
            <p className="mt-1.5 text-sm text-muted">
              {t("blockers.alsoBlockedOn", { trips: diver.alsoOn.join(", ") })}
            </p>
          ) : null
        }
      />
    </li>
  );
}

function TripGroup({
  trip,
  shopSlug,
  timeZone,
  locale,
  t,
}: {
  trip: BlockerQueueTrip;
  shopSlug: string;
  timeZone: string;
  locale: string;
  t: StaffTranslator;
}) {
  const batchIds = waiverBookingIds(trip);
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-surface-sunken px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <Link
              href={`/shop/${shopSlug}/trips/${trip.tripId}`}
              className="font-semibold hover:text-primary hover:underline"
            >
              {trip.title}
            </Link>
            {trip.courseTitle ? (
              <span className="text-sm font-medium text-primary">· {trip.courseTitle}</span>
            ) : null}
          </div>
          <p className="text-sm text-muted">{formatDateTimeTz(trip.startsAt, locale, timeZone)}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-3">
          <span className="rounded-full bg-surface px-3 py-1 text-sm font-semibold tabular-nums">
            {t("blockers.tripBlockedCount", { blocked: trip.divers.length, booked: trip.booked })}
          </span>
          {batchIds.length > 1 ? (
            <WaiverSendControl
              shopSlug={shopSlug}
              surface="blockers"
              bookingIds={batchIds}
              label={t("blockers.sendAllWaivers", { count: batchIds.length })}
              pendingLabel={t("blockers.sendingAll")}
              copy={waiverSendCopy(t)}
            />
          ) : null}
        </div>
      </header>
      <ul className="divide-y divide-border">
        {trip.divers.map((diver) => (
          <DiverRow key={diver.bookingId} diver={diver} shopSlug={shopSlug} t={t} />
        ))}
      </ul>
    </section>
  );
}

export function BlockerGroups({
  queue,
  requestedPage,
  shopSlug,
  timeZone,
  locale,
  pageHref,
  headingId,
  viewSwitch,
  t,
}: {
  queue: BlockerQueue;
  /** Raw `?page=`, already parsed; `pageOf` clamps anything nonsensical. */
  requestedPage: number;
  shopSlug: string;
  timeZone: string;
  locale: string;
  /** Builds the URL for a page of this view, keeping the view selected. */
  pageHref: (page: number) => string;
  /** The heading this section is named by, so both views label the queue alike. */
  headingId: string;
  /**
   * The urgency/by-departure switch, on the queue's own heading row — same
   * slot `TodayQueue` renders it in, so flipping the view never moves it.
   */
  viewSwitch?: React.ReactNode;
  t: StaffTranslator;
}) {
  const { trips, truncated } = queue;
  const blocked = distinctBlockedDivers(trips);
  const {
    page,
    pageCount,
    items: visibleTrips,
  } = pageOf(trips, requestedPage, BLOCKERS_TRIPS_PER_PAGE);

  return (
    <section aria-labelledby={headingId}>
      {/* Heading, count, and the view switch on one row — the same row shape
          as the urgency view's, so flipping the view moves nothing. The count
          rides the heading (danger, like every surface that names a blocked
          diver — `readinessStatusTone`): how many divers cannot board is the
          one number this view exists to state, and a muted subtitle is where
          a fact goes to be skimmed past. No standing description under it —
          the departure groups below say the rest themselves. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id={headingId} className="text-lg font-semibold">
            {t("blockers.title")}
          </h2>
          {blocked > 0 ? (
            <Badge tone="danger" size="sm" tabularNums>
              {t("blockers.blockedCount", { count: blocked })}
            </Badge>
          ) : null}
        </div>
        {viewSwitch}
      </div>

      {trips.length === 0 ? (
        // The shared `EmptyState`, not the bespoke whole-page emoji pattern
        // this used to wear: it is a *section* now, sitting under the
        // greeting, the departure board, and the view switch, and the emoji
        // circle reads as "you've reached the end" when siblings above it
        // still have content (design/principles.md #4). The urgency view's own
        // empty state is the same component, so the two views rest alike.
        <EmptyState className="mt-5">
          <h3 className="font-medium">{t("blockers.emptyTitle")}</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">
            {t("blockers.emptyDescription")}
          </p>
          <Link
            href={`/shop/${shopSlug}/schedule/board`}
            className={buttonClass({ variant: "secondary", size: "sm", className: "mt-4" })}
          >
            {t("blockers.viewSchedule")}
          </Link>
        </EmptyState>
      ) : (
        <div className="mt-5 flex flex-col gap-8">
          {/* Grouped by the same four urgency bands, in the same words
              (`URGENCY_KEYS`), as the queue's other view — a departure reads
              equally urgent whichever lens a staffer is looking through it
              from. Folding follows the identical rule TodayQueue uses: a boat
              that could still be waiting at the dock ("imminent"/"now")
              always renders in full, "Next 3 days" and "This week" fold to
              heading-and-count, and the *page's* first group stays open
              whatever its band — a page that opens mid-week must still lead
              with its nearest real work, not a folded band and a shrug. This
              groups the page, not the whole queue: pagination already bounds
              what's on screen (BLOCKERS_TRIPS_PER_PAGE), so a band can
              legitimately continue under its own heading on the next page. */}
          {groupBlockerTrips(visibleTrips).map((group, index) => (
            <UrgencyBand
              key={group.urgency}
              label={t(URGENCY_KEYS[group.urgency])}
              count={t("blockers.pagination.total", { count: group.trips.length })}
              folded={index > 0 && (group.urgency === "soon" || group.urgency === "later")}
            >
              <div className="mt-3 flex flex-col gap-5">
                {group.trips.map((trip) => (
                  <TripGroup
                    key={trip.tripId}
                    trip={trip}
                    shopSlug={shopSlug}
                    timeZone={timeZone}
                    locale={locale}
                    t={t}
                  />
                ))}
              </div>
            </UrgencyBand>
          ))}
          {/* Above the pager, not below it. This says "the queue itself stops
              short of your week" — a fact about the whole list — and under
              "Page 2 of 4" it read as a footnote to the page you happen to be
              on, which is the one place it is not true. */}
          {truncated ? (
            <p className="text-center text-sm text-muted">
              {t.rich("blockers.truncated", {
                link: (chunks) => (
                  <Link
                    href={`/shop/${shopSlug}/schedule/board`}
                    className="font-medium text-primary hover:underline"
                  >
                    {chunks}
                  </Link>
                ),
              })}
            </p>
          ) : null}

          {/* This view pages an already-loaded array (`pageOf`) rather than a
              query, because the whole operational window is what the queue is
              ranked over — but what staff see is the one pager every other
              paged list wears (ADR 20260803-one-pagination-model). */}
          <Pager
            page={page}
            pageCount={pageCount}
            href={pageHref}
            total={t("blockers.pagination.total", { count: trips.length })}
            t={t}
          />
        </div>
      )}
    </section>
  );
}
