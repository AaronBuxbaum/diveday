import type { CrewMonth } from "@/db/crew-tips";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatMoneyScanned, monthNames } from "@/lib/format";

/**
 * The reader's own crew lines on Today, read by `readDayMoney`: their share of
 * the paid tips on the boats they crewed this week, and their month on the
 * boats so far (null before they have crewed one).
 */
export type CrewReading = { tipsCents: number; month: (CrewMonth & { month: number }) | null };

/**
 * The reader's share of the week's paid tips on boats they crewed (`crewTipShare`;
 * UX review 2026-10-11, item 18; issue #2468): the crew seeing the shop pass
 * tips on. A plain line, never coral. The only shop money shown below the
 * money gate, and not precedent for more (H-20261015-crew-see-tips-on). Zero renders nothing.
 */
function CrewTipsLine({
  cents,
  currency,
  locale,
  t,
}: {
  cents: number;
  currency: string;
  locale: string;
  t: StaffTranslator;
}) {
  if (cents <= 0) return null;
  return (
    <p className="text-sm text-muted tabular-nums">
      {t("shopHome.spine.crewTips", { amount: formatMoneyScanned(cents, currency, locale) })}
    </p>
  );
}

/**
 * **The reader's month on the boats** (fifth-loop ideas, item 51): "October:
 * 14 boats · 26 dives · 31 hours on the water." Their own working record,
 * counted from the departures they crewed (`crewMonth`). Quiet, under the
 * tips line; nothing when they have not crewed this month.
 */
function CrewMonthLine({
  season,
  locale,
  t,
}: {
  season: { boats: number; dives: number; minutes: number; month: number } | null;
  locale: string;
  t: StaffTranslator;
}) {
  if (!season) return null;
  return (
    <p className="text-sm text-muted tabular-nums">
      {t("shopHome.spine.crewMonth", {
        month: monthNames(locale)[season.month - 1] ?? "",
        boats: season.boats,
        dives: season.dives,
        hours: Math.round(season.minutes / 60),
      })}
    </p>
  );
}

/** Both crew lines, in the spine's order: the week's tips, then the month. */
export function CrewLines({
  crew,
  currency,
  locale,
  t,
}: {
  crew: CrewReading;
  currency: string;
  locale: string;
  t: StaffTranslator;
}) {
  return (
    <>
      <CrewTipsLine cents={crew.tipsCents} currency={currency} locale={locale} t={t} />
      <CrewMonthLine season={crew.month} locale={locale} t={t} />
    </>
  );
}
