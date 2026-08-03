import Link from "next/link";
import { waiverSendCopy } from "@/app/actions/waiver-send-types";
import { EmptyState } from "@/components/EmptyState";
import { Pager } from "@/components/Pager";
import { WaiverSendControl } from "@/components/today/WaiverSendControl";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import type { BlockerQueue } from "@/db/blockers";
import { readinessBlockerText } from "@/i18n/readiness-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { BlockerQueueTrip } from "@/lib/blockers";
import { distinctBlockedDivers, waiverBookingIds } from "@/lib/blockers";
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
    <li className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-5 sm:px-5">
      <div className="min-w-0">
        <Link
          href={`/shop/${shopSlug}/divers/${diver.personId}`}
          className="font-semibold hover:text-primary hover:underline"
        >
          {diver.fullName}
        </Link>
        <ul className="mt-1.5 flex flex-col gap-1 text-base text-muted">
          {diver.blockers.map((blocker) => (
            <li key={blocker.code} className="flex gap-2">
              <span aria-hidden="true" className="text-danger">
                •
              </span>
              <span>{readinessBlockerText(t, blocker)}</span>
            </li>
          ))}
        </ul>
        {diver.alsoOn.length > 0 ? (
          <p className="mt-1.5 text-sm text-muted">
            {t("blockers.alsoBlockedOn", { trips: diver.alsoOn.join(", ") })}
          </p>
        ) : null}
      </div>
      {diver.fix.sendsWaiver ? (
        <WaiverSendControl
          shopSlug={shopSlug}
          surface="blockers"
          bookingIds={[diver.fix.bookingId]}
          label={diver.fix.label}
          copy={waiverSendCopy(t)}
        />
      ) : (
        <Link
          href={diver.fix.href}
          className={buttonClass({ variant: "secondary", className: "shrink-0" })}
        >
          {diver.fix.label}
        </Link>
      )}
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
      {/* The count rides the heading, not the sentence under it. "Not ready"
          was a page with its own headline number until ADR
          20260803-not-ready-is-a-view folded it in here; a muted subtitle is
          where a fact goes to be skimmed past, and how many divers cannot board
          is the one number this view exists to state. Danger, like every other
          surface that names a blocked diver (`readinessStatusTone`). */}
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
      <p className="mt-1 text-sm text-muted">
        {blocked === 0
          ? t("blockers.description.none")
          : t("blockers.description.some", { departures: trips.length })}
      </p>

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
        <div className="mt-5 flex flex-col gap-5">
          {visibleTrips.map((trip) => (
            <TripGroup
              key={trip.tripId}
              trip={trip}
              shopSlug={shopSlug}
              timeZone={timeZone}
              locale={locale}
              t={t}
            />
          ))}
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
        </div>
      )}
    </section>
  );
}
