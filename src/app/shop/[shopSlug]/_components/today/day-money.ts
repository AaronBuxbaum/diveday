import type { CrewReading } from "@/app/shop/[shopSlug]/_components/today/CrewLines";
import type { DbExecutor } from "@/db/client";
import { crewMonth, crewTipsOnBoats, tipsByDeparture } from "@/db/crew-tips";
import { getMonthlyReport } from "@/db/reporting";
import { nowDate } from "@/lib/clock";
import { type DayTakings, dayTakings } from "@/lib/closeout";
import { summarizeMonth } from "@/lib/reporting";
import { shiftInstantByCalendarDays, shopMonthBounds, utcToWallTime } from "@/lib/zoned";

/**
 * **The Today page's money reads**, in one round trip of the second wave.
 *
 * **What today made** — the evening's one money reading (issue #1930; ADR
 * 20260919-one-idea, decision I · Tide: "money is what the day made").
 * `DayTakings.tsx` carries the placement and its decision.
 *
 * **The month's own derivation, over the day's bounds.** `getMonthlyReport`
 * is window-shaped — nothing in it is month-specific but its name — and it
 * anchors every figure to `trips.startsAt`, so the day is the same query with
 * `shopDayBounds` in place of `shopMonthBounds`. That is deliberate rather
 * than convenient: a second derivation would let tonight's figure and the same
 * day inside `/reports` disagree. `reporting.test.ts` pins the two together by
 * summing the days of a month against the month itself.
 *
 * **Gated before it is read.** `withTakings` is the caller's live money gate
 * and "the day is closing", so a reader who may not have the number never
 * causes the query that would produce it, and the ordinary morning render
 * pays nothing for it. The evening's tips split by boat ride the same gate.
 *
 * **Tips, seen from the boat** (UX review 2026-10-11, item 18): what the
 * divers left on the boats this reader crewed over the last seven shop days.
 * It is the reader's own and needs no money gate: it is their boats, and
 * nothing else.
 *
 * **The reader's month on the boats** (fifth-loop ideas, item 51): the
 * departures they crewed this shop month that are back, with their dives and
 * hours (`crewMonth`). Their own, like the tips, so no gate. Not money, but
 * the same one-line-under-the-spine reading, so it rides this round trip.
 */
export async function readDayMoney(
  db: DbExecutor,
  shop: { id: string; currency: string; timezone: string },
  day: { from: Date; to: Date },
  reader: { personId: string; withTakings: boolean },
): Promise<{ takings: DayTakings | null; crew: CrewReading }> {
  const week = { from: shiftInstantByCalendarDays(day.from, -6, shop.timezone), to: day.to };
  const wall = utcToWallTime(day.from, shop.timezone);
  const month = shopMonthBounds({ year: wall.year, month: wall.month }, shop.timezone);
  const [report, boatTips, tipsCents, season] = await Promise.all([
    reader.withTakings
      ? getMonthlyReport(db, shop.id, day.from, day.to, {
          currency: shop.currency,
          timeZone: shop.timezone,
        })
      : null,
    reader.withTakings ? tipsByDeparture(db, shop.id, day) : [],
    crewTipsOnBoats(db, shop.id, reader.personId, week),
    crewMonth(db, shop.id, reader.personId, { from: month.from, now: nowDate() }),
  ]);
  return {
    takings: report ? dayTakings(summarizeMonth(report), boatTips) : null,
    crew: { tipsCents, month: season.boats > 0 ? { ...season, month: wall.month } : null },
  };
}
