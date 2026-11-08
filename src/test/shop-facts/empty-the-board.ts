import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { AppDb } from "../../db/client";
import { trips } from "../../db/schema/index";
import { createTrip, liveTrip } from "../../db/trips";
import { DAY_MS, HOUR_MS } from "../../lib/clock";
import { hasSailed } from "../../lib/trips";
import { FactRefused } from "./refusal";

export const offSeasonArgs = z
  .object({ opensInDays: z.number().int().positive().optional() })
  .strict();

/**
 * **A board with nothing ahead on it** (`offSeason`, N-45), so the storefront's
 * quiet state can be photographed: the one thing the seeded fixture can never
 * be, because `blue-mantis` exists to have a full board.
 *
 * Two shapes, because the card has two and they say different things. Without
 * `opensInDays` every upcoming departure is deleted and the card names no date;
 * with it, the same clear-out and then one ordinary departure that far out,
 * whose date the card names (`src/features/off-season/rules.ts`).
 *
 * The delete is the product's own soft delete (ADR 20260820-every-delete-is-soft),
 * since every read this exercises filters through `liveTrip()`. Departures
 * already in the past stay: a shop between seasons has a season behind it, and
 * that keeps the deal list and the find-my-link door on the page. "Still ahead"
 * is `hasSailed`, the one place the repository decides it.
 */
export async function emptyTheBoard(
  db: AppDb,
  shopId: string,
  { opensInDays }: z.output<typeof offSeasonArgs>,
  now: Date,
) {
  const live = await db
    .select({ id: trips.id, startsAt: trips.startsAt })
    .from(trips)
    .where(and(liveTrip(), eq(trips.shopId, shopId)));
  const ahead = live.filter((trip) => !hasSailed(trip.startsAt, now)).map((trip) => trip.id);
  if (ahead.length > 0) {
    await db.update(trips).set({ deletedAt: now }).where(inArray(trips.id, ahead));
  }

  let openedTripId: string | null = null;
  if (opensInDays !== undefined) {
    const startsAt = new Date(now.getTime() + opensInDays * DAY_MS);
    const created = await createTrip(db, {
      shopId,
      // i18n-exempt: a test fixture's departure title, never a rendered string
      // the product owns — the same status the seed's own titles have.
      title: "Season Opener Two-Tank",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS),
      capacity: 12,
      priceCents: 14_500,
    });
    if (!created) throw new FactRefused("create_failed");
    openedTripId = created.id;
  }
  return { cleared: ahead.length, openedTripId };
}
