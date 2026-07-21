import { and, desc, eq, ilike, isNull, or } from "drizzle-orm";
import { formatShortDate } from "@/lib/format";
import type { AppDb } from "./client";
import { diveSites, people, trips } from "./schema";

/**
 * The shop-scoped index behind the command palette. Every clause is pinned to
 * one shop, so a bearer of one shop's session can never surface another's
 * people or trips. Capped per group so a broad query stays a quick list, not a
 * dump. Kept to indexed `ilike` on the columns staff actually search by — no
 * new dependency, no full-text engine.
 */

export type DiverHit = { id: string; fullName: string; detail: string | null };
export type TripHit = { id: string; title: string; detail: string };
export type SearchResults = { divers: DiverHit[]; trips: TripHit[] };

const PER_GROUP = 8;
/** One character matches everything; wait for a real query. */
const MIN_QUERY = 2;

export async function searchShop(
  db: AppDb,
  shopId: string,
  rawQuery: string,
  timeZone: string,
): Promise<SearchResults> {
  const query = rawQuery.trim();
  if (query.length < MIN_QUERY) return { divers: [], trips: [] };
  const like = `%${query}%`;

  const [diverRows, tripRows] = await Promise.all([
    db
      .select({
        id: people.id,
        fullName: people.fullName,
        email: people.email,
        phone: people.phone,
      })
      .from(people)
      .where(
        and(
          eq(people.shopId, shopId),
          isNull(people.deletedAt),
          or(ilike(people.fullName, like), ilike(people.email, like), ilike(people.phone, like)),
        ),
      )
      .orderBy(people.fullName)
      .limit(PER_GROUP),
    db
      .select({
        id: trips.id,
        title: trips.title,
        startsAt: trips.startsAt,
        siteName: diveSites.name,
      })
      .from(trips)
      .leftJoin(diveSites, eq(diveSites.id, trips.diveSiteId))
      .where(
        and(eq(trips.shopId, shopId), or(ilike(trips.title, like), ilike(diveSites.name, like))),
      )
      .orderBy(desc(trips.startsAt))
      .limit(PER_GROUP),
  ]);

  return {
    divers: diverRows.map((row) => ({
      id: row.id,
      fullName: row.fullName,
      detail: row.email ?? row.phone ?? null,
    })),
    trips: tripRows.map((row) => {
      const date = formatShortDate(row.startsAt, "en-US", timeZone);
      return {
        id: row.id,
        title: row.title,
        detail: row.siteName ? `${date} · ${row.siteName}` : date,
      };
    }),
  };
}
