import { desc, eq, gte } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { AppDb } from "./client";
import { marineLifeRequests } from "./schema";

/**
 * Species a shop asked for and DiveDay's catalog does not carry.
 *
 * The write side of the field-guide picker's refusal (ADR
 * 20260813-marine-life-is-diveday-copy). Nothing in the app reads these back —
 * they are queried directly out of the database when someone decides which
 * species the catalog grows by next, which is the whole design: the requests
 * are the roadmap, and guessing at a region before any shop has asked is how
 * the first 93 came out Florida-shaped.
 */

/** As much of a typed query as is worth keeping; the picker's own box caps at 80. */
const MAX_QUERY = 120;

export async function recordMarineLifeRequest(
  db: AppDb,
  input: { shopId: string; requestedByPersonId: string; query: string; diveSiteId?: string | null },
): Promise<void> {
  const query = input.query.trim().slice(0, MAX_QUERY);
  // A blank ask is not a request. Refused here rather than at the form so a
  // hand-rolled post cannot fill the table with empty rows either.
  if (!query) return;
  await db.insert(marineLifeRequests).values({
    shopId: input.shopId,
    requestedByPersonId: input.requestedByPersonId,
    query,
    diveSiteId: input.diveSiteId ?? null,
    createdAt: nowDate(),
  });
}

/**
 * What has been asked for, newest first — for the human running the query, not
 * for a page. Exported so the reading side is a tested function rather than a
 * SQL snippet pasted into a console, and so the follow-up that turns this into
 * a real triage surface has somewhere to start.
 */
export async function listMarineLifeRequests(
  db: AppDb,
  options: { since?: Date; limit?: number } = {},
) {
  const rows = db
    .select()
    .from(marineLifeRequests)
    .orderBy(desc(marineLifeRequests.createdAt))
    .limit(options.limit ?? 200);
  return options.since ? rows.where(gte(marineLifeRequests.createdAt, options.since)) : rows;
}

/** Every request one shop has made — the per-tenant read, for an export or an erasure. */
export async function listShopMarineLifeRequests(db: AppDb, shopId: string) {
  return db
    .select()
    .from(marineLifeRequests)
    .where(eq(marineLifeRequests.shopId, shopId))
    .orderBy(desc(marineLifeRequests.createdAt));
}
