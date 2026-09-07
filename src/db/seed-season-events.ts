import { and, eq, isNull } from "drizzle-orm";
import { calendarDateInTimezone, shiftCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import type { DbExecutor } from "./client";
import { seasonEvents, shops, tripLenses } from "./schema";

/**
 * **The demo shop's own year** — the reef's calendar for Blue Mantis, Key Largo
 * (issue #1485).
 *
 * Three windows, because a screenshot can only see what is on the page and the
 * feature has three states worth looking at: two **live**, which is what the
 * storefront band renders and what makes its "ends soonest first" order
 * visible, one of those naming a kind of day and one not — the band has to read
 * well both with the link under it and without. The third is **upcoming inside
 * the month-out horizon**, which is what puts a row in the shop's queue.
 *
 * Anchored on the clock rather than written as literal dates. The e2e fleet
 * freezes one instant and the dev seed runs on whatever day somebody opens it,
 * so a hard-coded July window would be live in a visual run and silently over
 * by the time a human looked at the page.
 *
 * They are Blue Mantis's words, not DiveDay's, so they are seed data and never
 * a message bundle — the same contract as a boat's description, a site's fit
 * tone, or the kinds of day beside them.
 */
export async function seedSeasonEvents(db: DbExecutor, shopId: string): Promise<void> {
  // The shop's own day, not the seeder's: a window written from a UTC "today"
  // would open and close a few hours out of step with the storefront reading it.
  const [shop] = await db
    .select({ timezone: shops.timezone })
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1);
  if (!shop) return;
  const today = calendarDateInTimezone(nowDate(), shop.timezone);

  const lensRows = await db
    .select({ id: tripLenses.id, name: tripLenses.name })
    .from(tripLenses)
    .where(and(eq(tripLenses.shopId, shopId), isNull(tripLenses.deletedAt)));
  const lensIdByName = new Map(lensRows.map((row) => [row.name, row.id]));

  const demoSeasons = [
    {
      // The long window, and the one that names a kind of day: the band's link
      // out to the narrowed schedule is only drawn for a season that has one.
      name: "Turtle nesting",
      note: "Loggerheads are on the beaches through October. We stay off the nests and keep the lights low after sunset.",
      startsOn: shiftCalendarDate(today, -34),
      endsOn: shiftCalendarDate(today, 68),
      lensId: lensIdByName.get("After dark") ?? null,
    },
    {
      // Live and ending first, so the band's ordering rule is visible: the week
      // a visitor still has time to act on leads. No kind of day, because most
      // seasons a shop writes will not have one and the band has to read well
      // with no link under it.
      name: "Coral spawning",
      note: "A few nights after the August full moon. We run the late boat and keep the group small.",
      startsOn: shiftCalendarDate(today, -1),
      endsOn: shiftCalendarDate(today, 2),
      lensId: null,
    },
    {
      // The one the queue reminds the board about, eighteen days out.
      name: "Lobster mini-season",
      note: "Two days, and every reef in the Keys is busy. We run three boats and they fill.",
      startsOn: shiftCalendarDate(today, 18),
      endsOn: shiftCalendarDate(today, 19),
      lensId: lensIdByName.get("Easygoing reef") ?? null,
    },
  ];

  /**
   * **Runs on every reset, and writes the calendar only once.** A season is
   * shop *configuration*, like a hull or a kind of day, and the reset
   * deliberately leaves it standing — so the insert is skipped where the name
   * is already there rather than duplicating the shop's year on each e2e test.
   */
  const existing = await db
    .select({ name: seasonEvents.name })
    .from(seasonEvents)
    .where(and(eq(seasonEvents.shopId, shopId), isNull(seasonEvents.deletedAt)));
  const written = new Set(existing.map((row) => row.name));
  const missing = demoSeasons.filter((season) => !written.has(season.name));
  if (missing.length === 0) return;

  await db.insert(seasonEvents).values(missing.map((season) => ({ shopId, ...season })));
}
