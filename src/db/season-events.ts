/**
 * **The reef's calendar** — reads and writes for the shop's own year (issue
 * #1485). The rules about *when* a window is live live in
 * `src/lib/season-events.ts`; this file only fetches and stores.
 *
 * Every read filters `deleted_at is null` (ADR 20260820-every-delete-is-soft)
 * and joins the shop's own word for the kind of day, because every surface that
 * shows a season also shows that word: the Settings inset renders it beside the
 * dates, and the storefront band uses its slug to hand a visitor the narrowed
 * schedule.
 */

import { and, asc, eq, isNull } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { AppDb } from "./client";
import { seasonEvents, tripLenses } from "./schema";

export type SeasonEvent = typeof seasonEvents.$inferSelect;

/** A season plus the shop's word for the kind of day it fills the board with. */
export type SeasonEventWithLens = SeasonEvent & {
  lens: { id: string; name: string; slug: string } | null;
};

/**
 * The shop's whole calendar, earliest first — including seasons already over,
 * because the Settings inset is where a shop reads last summer's dates to write
 * this summer's.
 *
 * A season whose lens was deleted comes back with `lens: null`: the join is
 * narrowed to live words, so a band never links a visitor at a chip the rail
 * has stopped rendering.
 */
export async function listSeasonEvents(db: AppDb, shopId: string): Promise<SeasonEventWithLens[]> {
  const rows = await db
    .select({ event: seasonEvents, lens: tripLenses })
    .from(seasonEvents)
    .leftJoin(
      tripLenses,
      and(
        eq(tripLenses.id, seasonEvents.lensId),
        // The tenant condition on the join itself, not only on the write that
        // stored the id. The action already re-scopes a `lensId` arriving on a
        // form through `getTripLens`, so this is defence in depth — but a join
        // that trusts a stored id is the shape a later writer gets wrong, and
        // the row it would leak is another shop's own word, rendered on this
        // shop's public storefront.
        eq(tripLenses.shopId, seasonEvents.shopId),
        isNull(tripLenses.deletedAt),
      ),
    )
    .where(and(eq(seasonEvents.shopId, shopId), isNull(seasonEvents.deletedAt)))
    .orderBy(asc(seasonEvents.startsOn), asc(seasonEvents.id));
  return rows.map((row) => ({
    ...row.event,
    lens: row.lens ? { id: row.lens.id, name: row.lens.name, slug: row.lens.slug } : null,
  }));
}

/** One live season, for the tenant check every write runs on an id off a form. */
export async function getSeasonEvent(
  db: AppDb,
  shopId: string,
  eventId: string,
): Promise<SeasonEvent | null> {
  const [event] = await db
    .select()
    .from(seasonEvents)
    .where(
      and(
        eq(seasonEvents.shopId, shopId),
        eq(seasonEvents.id, eventId),
        isNull(seasonEvents.deletedAt),
      ),
    )
    .limit(1);
  return event ?? null;
}

/** What a caller may set on a season. The shop's words and its own days. */
export type SeasonEventInput = {
  name: string;
  note: string | null;
  startsOn: string;
  endsOn: string;
  lensId: string | null;
};

export async function createSeasonEvent(
  db: AppDb,
  shopId: string,
  input: SeasonEventInput,
): Promise<SeasonEvent | null> {
  const [event] = await db
    .insert(seasonEvents)
    .values({ shopId, ...input })
    .returning();
  return event ?? null;
}

export async function updateSeasonEvent(
  db: AppDb,
  shopId: string,
  eventId: string,
  input: SeasonEventInput,
): Promise<SeasonEvent | null> {
  const [event] = await db
    .update(seasonEvents)
    .set(input)
    .where(
      and(
        eq(seasonEvents.shopId, shopId),
        eq(seasonEvents.id, eventId),
        isNull(seasonEvents.deletedAt),
      ),
    )
    .returning();
  return event ?? null;
}

/**
 * **Stamps, never removes** (ADR 20260820-every-delete-is-soft). The word on
 * screen is still "Delete". An already-stamped row is left alone, so the date
 * keeps saying when the shop actually took the season off its calendar.
 */
export async function deleteSeasonEvent(
  db: AppDb,
  shopId: string,
  eventId: string,
): Promise<boolean> {
  const result = await db
    .update(seasonEvents)
    .set({ deletedAt: nowDate() })
    .where(
      and(
        eq(seasonEvents.shopId, shopId),
        eq(seasonEvents.id, eventId),
        isNull(seasonEvents.deletedAt),
      ),
    )
    .returning({ id: seasonEvents.id });
  return result.length > 0;
}
