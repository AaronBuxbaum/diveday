import { Fragment, type ReactNode } from "react";
import type { DiverTranslator } from "@/i18n/messages";
import { DIVER_CERTIFICATION_LEVEL_KEYS } from "@/i18n/readiness-labels";
import { formatDateWithYear, formatTimeRangeTz, formatWeekday } from "@/lib/format";
import { publicSchedulePath } from "@/lib/public-routes";
import { PaperRule, type PaperShop, PublicPaperSheet } from "./PublicPaperSheet";
import type { ScheduleView } from "./schedule-view";
import type { WeekLedgerRow } from "./WeekLedger";

/** What the reader narrowed the storefront's list by, in the words its controls use. */
export type ScheduleSheetView = Pick<
  ScheduleView,
  "hasSpaceFilter" | "tripTypeFilter" | "canDiveFilter" | "hideAboveFilter"
> & { monthLabel: string | null; lensName: string | null };

/** A day's rule on paper: "Saturday · Jul 25, 2026", in the shop's zone. */
function paperDay(date: Date, locale: string, zone: string): string {
  return `${formatWeekday(date, locale, zone)} · ${formatDateWithYear(date, locale, zone)}`;
}

/** What stands in for the storefront's empty list, in the screen's own words. */
export function scheduleSheetEmpty(
  t: DiverTranslator,
  filtered: boolean,
  hasUpcoming: boolean,
): string {
  if (filtered) return t("schedule.filters.noMatches");
  return t(hasUpcoming ? "schedule.noTripsMonth" : "schedule.noTrips");
}

function scopeWords(view: ScheduleSheetView, t: DiverTranslator): string[] {
  const { tripTypeFilter, canDiveFilter } = view;
  return [
    view.monthLabel,
    view.lensName,
    tripTypeFilter
      ? t(tripTypeFilter === "course" ? "schedule.filters.course" : "schedule.filters.funDive")
      : null,
    view.hasSpaceFilter ? t("schedule.filters.hasSpace") : null,
    canDiveFilter
      ? `${t("schedule.filters.canDive")} ${t(DIVER_CERTIFICATION_LEVEL_KEYS[canDiveFilter])}`
      : null,
    view.hideAboveFilter ? t("schedule.filters.hideAboveLevel") : null,
  ].filter((word): word is string => Boolean(word));
}

/**
 * **The schedule on paper** (issue #2745): what the storefront's schedule and
 * the framed calendar print. The screen (its month rail, day strip, filters,
 * pager, shelves, photographs, reviews and asks) never reaches a printer; this
 * sheet is drawn under it from the same ledger rows, so paper lists exactly the
 * departures the screen listed, in the same order, with nothing to tap.
 *
 * A departure on paper states its date with the year and its time with the
 * zone, each its own (a list that crosses a daylight-saving change is two
 * zones), because paper outlives the week it was printed. A list the reader
 * narrowed (a month, a kind of day, a filter) says what narrowed it, so a
 * short list is never read as the whole board.
 */
export function SchedulePaperSheet({
  shop,
  shopSlug,
  rows,
  view,
  lead,
  empty,
  locale,
  t,
  now,
}: {
  shop: PaperShop;
  shopSlug: string;
  rows: readonly WeekLedgerRow[];
  /** What narrowed the list; absent for a list nobody can narrow (the frame). */
  view?: ScheduleSheetView;
  /** Lines under the heading: the zone note, or the off-season's. */
  lead: readonly (string | null)[];
  /** What stands in for an empty list. */
  empty: string;
  locale: string;
  t: DiverTranslator;
  now: Date;
}) {
  const zone = shop.timezone;
  const scope = view ? scopeWords(view, t) : [];
  const days: { key: string; rows: WeekLedgerRow[] }[] = [];
  for (const row of rows) {
    const last = days.at(-1);
    if (last?.key === row.dayKey) last.rows.push(row);
    else days.push({ key: row.dayKey, rows: [row] });
  }
  return (
    <PublicPaperSheet
      shop={shop}
      pageName="departure-public-schedule"
      identity={[shop.name, t("schedule.title")]}
      path={publicSchedulePath(shopSlug)}
      locale={locale}
      t={t}
      now={now}
    >
      <h1 className="font-brand-display text-xl leading-tight font-extrabold">
        {t("schedule.title")}
      </h1>
      {scope.length > 0 ? (
        <p className="mt-1 text-base font-semibold">{scope.join(" · ")}</p>
      ) : null}
      {lead.map((line) =>
        line ? (
          <p key={line} className="mt-1 text-sm">
            {line}
          </p>
        ) : null,
      )}
      {days.length === 0 ? (
        <PaperRule>
          <p className="text-sm">{empty}</p>
        </PaperRule>
      ) : (
        days.map((day) => (
          <PaperRule key={day.key}>
            <h2 className="font-semibold">
              {paperDay(day.rows[0]?.startsAt ?? now, locale, zone)}
            </h2>
            <ul className="mt-1 space-y-2">
              {day.rows.map((row) => (
                <PaperRow key={row.id} row={row} locale={locale} zone={zone} />
              ))}
            </ul>
          </PaperRule>
        ))
      )}
    </PublicPaperSheet>
  );
}

function PaperRow({ row, locale, zone }: { row: WeekLedgerRow; locale: string; zone: string }) {
  const meta: ReactNode[] = [
    row.lens,
    row.course ? `${row.course.label} · ${row.course.title}` : null,
    row.site,
    ...row.requirements,
    row.aboveLevel,
  ].filter((part) => part !== null && part !== "");
  return (
    <li className="text-sm">
      <span className="tabular-nums">
        {formatTimeRangeTz(row.startsAt, row.endsAt, locale, zone)}
      </span>{" "}
      · <span className="font-semibold">{row.title}</span>
      {meta.length > 0 ? (
        <span className="block">
          {meta.map((part, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the separator's only identity is its position
            <Fragment key={index}>
              {index > 0 ? " · " : null}
              {part}
            </Fragment>
          ))}
        </span>
      ) : null}
      <span className="block tabular-nums">
        {[row.capacityText, row.price].filter(Boolean).join(" · ")}
      </span>
    </li>
  );
}
