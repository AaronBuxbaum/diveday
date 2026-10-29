import Link from "next/link";
import type { ReactNode } from "react";
import { tapTargetLinkClass } from "@/components/ui/button";
import { LedgerGroup } from "@/components/ui/ledger";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatTime } from "@/lib/format";
import { shopPath } from "@/lib/staff-notices";
import {
  foldBoatRows,
  groupByDeparture,
  type NeedsYouReading,
  type TodayAction,
} from "@/lib/today";
import { rankBoatRows } from "./spine-reading";

/**
 * **Needs you, one heading per boat** (fifth loop, item 11): the boat's time
 * and name once, linked to the departure, with its rows under it saying only
 * their own sentence; then the desk's rows, the reader's drafts and the
 * payments row under "The desk". `groupByDeparture` keeps the ranked order,
 * and `rankBoatRows` reorders a boat's rows by boarding impact (A43) before
 * the fold, so the visible five are the five that matter most at the dock.
 *
 * A boat with many divers to name shows its first rows and folds the rest
 * behind "and N more" (`foldBoatRows`), which opens the whole list in place.
 */
export function NeedsYouGroups({
  rows,
  row,
  shopSlug,
  t,
  desk,
}: {
  rows: readonly TodayAction[];
  /** One keyed row; `grouped` is true under a boat's heading. */
  row: (action: TodayAction, grouped: boolean) => ReactNode;
  shopSlug: string;
  /** The desk group's label and a long boat's "and 4 more", on the server. */
  t: StaffTranslator;
  /** Rows that belong to the desk but are not queue rows (drafts, payments). */
  desk?: ReactNode;
}) {
  const groups = groupByDeparture(rows);
  if (desk && !groups.some((group) => group.departure === null)) {
    groups.push({ departure: null, rows: [] });
  }
  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) =>
        group.departure ? (
          <LedgerGroup
            key={group.departure.tripId}
            as="h3"
            label={
              <Link
                href={shopPath(shopSlug, "trips", group.departure.tripId)}
                className={`${tapTargetLinkClass} hover:underline`}
              >
                {group.departure.label}
              </Link>
            }
          >
            <BoatRows
              rows={rankBoatRows(group.rows)}
              row={row}
              moreLabel={(count) => t("shopHome.spine.boatFoldLabel", { count })}
            />
          </LedgerGroup>
        ) : (
          <LedgerGroup key="desk" as="h3" label={t("shopHome.spine.deskGroupLabel")}>
            <ul>
              {group.rows.map((action) => row(action, false))}
              {desk}
            </ul>
          </LedgerGroup>
        ),
      )}
    </div>
  );
}

/** One boat's rows, the long tail folded behind "and N more". */
function BoatRows({
  rows,
  row,
  moreLabel,
}: {
  rows: readonly TodayAction[];
  row: (action: TodayAction, grouped: boolean) => ReactNode;
  moreLabel: (count: number) => string;
}) {
  const { shown, more } = foldBoatRows(rows);
  return (
    <>
      <ul>{shown.map((action) => row(action, true))}</ul>
      {more.length > 0 ? (
        <LedgerGroup as="p" folded label={moreLabel(more.length)} className="mt-2">
          <ul>{more.map((action) => row(action, true))}</ul>
        </LedgerGroup>
      ) : null}
    </>
  );
}

/**
 * **The list says how long it is** (UX audit 2026-10-07, item 1): the summary
 * under the date counts what is due before the next boat and the badge counts
 * blocked divers, so the list carries its own total rather than leaving the
 * reader to reconcile three numbers.
 *
 * **And says how much of it is the next boat's** (#2413) when that is not all
 * of it, so the sentence's smaller number over this one reads as a part of it
 * rather than a contradiction.
 */
function needsYouMeta(
  t: StaffTranslator,
  reading: NeedsYouReading,
  locale: string,
  timeZone: string,
): string {
  const { count, next, dueBeforeNext } = reading;
  if (next == null || dueBeforeNext === count) {
    return t("shopHome.spine.needsYouCount", { count });
  }
  return t("shopHome.spine.needsYouCountBeforeNext", {
    count,
    before: dueBeforeNext,
    time: formatTime(next.startsAt, locale, timeZone),
  });
}

/** Existing queue order and crew lens, with a focusable in-page destination. */
export function NeedsYouQueue({
  reading,
  row,
  shopSlug,
  t,
  locale,
  timeZone,
  drafts,
  payments,
}: {
  reading: NeedsYouReading;
  row: (action: TodayAction, grouped: boolean) => ReactNode;
  shopSlug: string;
  t: StaffTranslator;
  locale: string;
  timeZone: string;
  drafts: ReactNode;
  payments: ReactNode;
}) {
  const { lead, folded } = reading;
  if (lead.length + (folded?.length ?? 0) === 0 && !drafts && !payments) return null;
  return (
    <section
      id="needs-you"
      tabIndex={-1}
      aria-label={t("shopHome.spine.needsYouLabel")}
      className="scroll-mt-24 rounded-lg focus-visible:focus-ring"
    >
      <LedgerGroup
        as="h2"
        label={t("shopHome.spine.needsYouLabel")}
        meta={reading.count > 0 ? needsYouMeta(t, reading, locale, timeZone) : undefined}
      >
        <NeedsYouGroups
          rows={lead}
          row={row}
          shopSlug={shopSlug}
          t={t}
          desk={
            drafts || (!folded && payments) ? (
              <>
                {drafts}
                {folded ? null : payments}
              </>
            ) : undefined
          }
        />
        {folded ? (
          <LedgerGroup
            as="h3"
            folded
            className="mt-4"
            label={t("shopHome.spine.deskFoldLabel", { count: folded.length + (payments ? 1 : 0) })}
          >
            <NeedsYouGroups
              rows={folded}
              row={row}
              shopSlug={shopSlug}
              t={t}
              desk={payments ?? undefined}
            />
          </LedgerGroup>
        ) : null}
      </LedgerGroup>
    </section>
  );
}
