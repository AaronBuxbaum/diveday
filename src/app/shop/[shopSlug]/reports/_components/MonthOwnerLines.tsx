import { GroupLabel } from "@/components/ui/group-label";
import { type WeatherCalls, weatherCallsInWindow } from "@/db/blowouts";
import type { DbExecutor } from "@/db/client";
import { crewSheetForMonth } from "@/db/crew-sheet";
import { bookingLeadTimes } from "@/db/reporting";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { MonthRef } from "@/lib/calendar";
import { assembleCrewSheet } from "@/lib/crew-sheet";
import { joinFacts, weekdayNames } from "@/lib/format";
import { leadTimeLines, wholePercent } from "@/lib/lead-time";

/**
 * **The month's owner lines** (fifth loop, items 27, 31 and 34): what the
 * weather called off, who the tips go to, and how far ahead boats sell. Each
 * is a sentence under the figures it explains, and each says nothing when
 * there is nothing to say.
 */

/** The month's extra reads, in one wave beside the page's own. */
export async function readMonthOwner(
  db: DbExecutor,
  shop: { id: string; timezone: string },
  month: MonthRef,
  window: { startUtc: Date; endUtc: Date },
  locale: string,
) {
  const [weather, crew] = await Promise.all([
    weatherCallsInWindow(db, shop.id, { ...window, timeZone: shop.timezone }),
    crewSheetForMonth(db, shop.id, shop.timezone, month),
  ]);
  return { weather, crewRows: assembleCrewSheet({ ...crew, locale }) };
}

/**
 * **The Tips figure's split** (item 31): "Equal shares: Keiko $180 · Sal $160",
 * the crew sheet's own equal shares, so the payday conversation reads off the
 * tile instead of a download in Settings. Tips on a departure nobody crewed
 * stay on the shop's line, as the sheet keeps them.
 */
export function tipsSplitLine(
  rows: ReturnType<typeof assembleCrewSheet>,
  t: StaffTranslator,
  money: (cents: number) => string,
): string | undefined {
  const shares = rows
    .filter((row) => row.tipsCents > 0)
    .sort((left, right) => right.tipsCents - left.tipsCents)
    .map((row) =>
      t("reports.tipsShare", {
        name: row.personName ?? t("settings.crewSheet.unassigned"),
        amount: money(row.tipsCents),
      }),
    );
  // The sheet splits equally; many shops split by role, so the line says
  // which rule it shows rather than reading as the shop's own (review N6).
  return shares.length > 0 ? t("reports.tipsSplit", { shares: joinFacts(shares) }) : undefined;
}

/**
 * **The weather's month** (item 27): "Weather called off 3 departures: 26
 * divers, $1,840 refunded, 9 moved to another date." The figure an owner gives
 * the bank in a bad season; Reports otherwise leaves the canceled boats out
 * without a word.
 */
export function WeatherLine({
  weather,
  t,
  money,
}: {
  weather: WeatherCalls;
  t: StaffTranslator;
  money: (cents: number) => string;
}) {
  if (weather.departures === 0) return null;
  return (
    <p data-weather-line="" className="mt-6 max-w-3xl text-sm text-muted">
      {t("reports.weather.month", {
        departures: weather.departures,
        divers: weather.divers,
        refunded: money(weather.refundedCents),
        moved: weather.moved,
      })}
    </p>
  );
}

/**
 * **How far ahead boats sell** (item 34; glossary "Booking lead time"): one
 * line per busy weekday over the last twelve months, quiet until a weekday has
 * the history to say it (`src/lib/lead-time.ts`).
 */
export async function LeadTimes({
  db,
  shopId,
  timeZone,
  now,
  locale,
  t,
}: {
  db: DbExecutor;
  shopId: string;
  timeZone: string;
  now: Date;
  locale: string;
  t: StaffTranslator;
}) {
  const yearAgo = new Date(now.getTime() - 365 * 86_400_000);
  const lines = leadTimeLines(
    await bookingLeadTimes(db, shopId, { startUtc: yearAgo, endUtc: now, timeZone }),
  );
  if (lines.length === 0) return null;
  const weekdays = weekdayNames(locale, "long");
  return (
    <section aria-labelledby="reports-lead-time" className="mt-10">
      {/* The caption is a sentence, not a group's quiet tally, so it sits under
          the heading rather than in `meta`'s column, which squeezed the
          heading onto three lines at phone width. */}
      <GroupLabel as="h2" id="reports-lead-time">
        {t("reports.leadTime.heading")}
      </GroupLabel>
      <p className="mt-1 text-sm text-muted">{t("reports.leadTime.caption")}</p>
      <ul className="mt-2 space-y-1 text-sm">
        {lines.map((line) => (
          <li key={line.isoWeekday}>
            {t("reports.leadTime.line", {
              weekday: weekdays[line.isoWeekday % 7] ?? "",
              days: line.medianDays,
              percent: wholePercent(line.lastThreeDaysShare),
            })}
          </li>
        ))}
      </ul>
    </section>
  );
}
