import type { DbExecutor } from "@/db/client";
import { type CrewYear, crewYearFacts } from "@/db/reporting";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { joinFacts } from "@/lib/format";
import { utcToWallTime } from "@/lib/zoned";

export type { CrewYear };

/**
 * **Each teammate's year so far** (fifth loop, item 32): the cards they
 * issued and the days they went to sea, read once for the whole roster
 * (`crewYearFacts`), in the shop's own calendar year.
 */
export function readStaffYears(
  db: DbExecutor,
  shop: { id: string; timezone: string },
  now: Date,
): Promise<Map<string, CrewYear>> {
  const year = utcToWallTime(now, shop.timezone).year;
  return crewYearFacts(db, shop.id, { timeZone: shop.timezone, year, now });
}

/**
 * "4 students certified this year · 38 days at sea": the line under a
 * teammate's name. Each half only when it is more than none, and nothing at
 * all for somebody who has neither yet.
 */
export function StaffYearLine({ year, t }: { year: CrewYear | undefined; t: StaffTranslator }) {
  if (!year || (year.certified === 0 && year.daysAtSea === 0)) return null;
  return (
    <p data-staff-year="" className="text-sm text-muted">
      {joinFacts([
        year.certified > 0 ? t("settings.team.year.certified", { count: year.certified }) : null,
        year.daysAtSea > 0 ? t("settings.team.year.daysAtSea", { count: year.daysAtSea }) : null,
      ])}
    </p>
  );
}
