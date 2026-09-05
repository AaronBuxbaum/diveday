import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { normalizeEmbedSetMembers } from "@/lib/embed-sets";
import type { AppDb } from "./client";
import { listActiveCourses } from "./courses";
import type { EmbedSet, EmbedSetKind } from "./schema";
import { courses, embedSets, trips } from "./schema";
import { liveTrip } from "./trips-live";
import { pagedUpcomingTripsWithCounts } from "./trips-queries";

/**
 * **A shop's named embed lists** (issue #1284): read them, write them, and
 * resolve one into the departures or courses its widget renders.
 *
 * Every read carries the shop *and* `deleted_at is null` in the query itself.
 * The reason is that the consumer of the resolved list is a **public,
 * unauthenticated, framed page**: a `?set=` that fell through to another
 * tenant's departures, or to a list the shop deleted, is an information-shaped
 * bug on the one surface a stranger can point a browser at.
 *
 * Every write validates each member against this shop's own rows before
 * storing. The membership arrives from a checkbox list, and a checkbox list is
 * one devtools edit away from carrying whatever a caller likes.
 *
 * Refusals are codes; the words live in `staff/settings.json`.
 */

export type EmbedSetRefusal = "invalid" | "too_many" | "not_found";

/**
 * A member that is not a uuid never reaches a comparison against `trips.id`:
 * Postgres errors on the cast rather than answering "no such trip", which
 * would turn a hand-built request into a 500 instead of a refusal.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type EmbedSetOutcome = { ok: true; set: EmbedSet } | { ok: false; reason: EmbedSetRefusal };

export type EmbedSetDraft = {
  name: string;
  kind: EmbedSetKind;
  memberIds: readonly string[];
};

/** This shop's live lists, by name. */
export async function listEmbedSets(db: AppDb, shopId: string): Promise<EmbedSet[]> {
  return db
    .select()
    .from(embedSets)
    .where(and(eq(embedSets.shopId, shopId), isNull(embedSets.deletedAt)))
    .orderBy(asc(embedSets.name), asc(embedSets.id));
}

/** One live list of this shop's, or null — for an unknown, deleted or foreign id. */
export async function getEmbedSet(
  db: AppDb,
  shopId: string,
  setId: string,
): Promise<EmbedSet | null> {
  const [row] = await db
    .select()
    .from(embedSets)
    .where(and(eq(embedSets.id, setId), eq(embedSets.shopId, shopId), isNull(embedSets.deletedAt)))
    .limit(1);
  return row ?? null;
}

/**
 * The submitted membership, reduced to the ids this shop actually owns.
 *
 * Trip ids are checked against the shop's live departures and course members
 * against its own course slugs — including inactive ones, because a shop
 * unpublishing a course is not a reason to silently drop it from a list they
 * named; the widget's own read is what leaves it out while it is unpublished.
 */
async function ownedMembers(
  db: AppDb,
  shopId: string,
  kind: EmbedSetKind,
  ids: readonly string[],
): Promise<{ ok: true; ids: string[] } | { ok: false; reason: EmbedSetRefusal }> {
  const normalized = normalizeEmbedSetMembers(ids);
  // The cap keeps its own answer all the way to the screen: "a list holds up
  // to 24" and "pick at least one" are different things to fix.
  if (!normalized.ok) {
    return { ok: false, reason: normalized.reason === "too_many" ? "too_many" : "invalid" };
  }
  if (kind === "trip") {
    const candidates = normalized.ids.filter((id) => UUID_PATTERN.test(id));
    if (candidates.length === 0) return { ok: false, reason: "invalid" };
    const rows = await db
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.shopId, shopId), inArray(trips.id, candidates), liveTrip()));
    const owned = new Set(rows.map((row) => row.id));
    const kept = normalized.ids.filter((id) => owned.has(id));
    return kept.length > 0 ? { ok: true, ids: kept } : { ok: false, reason: "invalid" };
  }
  const rows = await db
    .select({ slug: courses.slug })
    .from(courses)
    .where(and(eq(courses.shopId, shopId), inArray(courses.slug, [...normalized.ids])));
  const owned = new Set(rows.map((row) => row.slug));
  const kept = normalized.ids.filter((slug) => owned.has(slug));
  return kept.length > 0 ? { ok: true, ids: kept } : { ok: false, reason: "invalid" };
}

export async function createEmbedSet(
  db: AppDb,
  shopId: string,
  draft: EmbedSetDraft,
): Promise<EmbedSetOutcome> {
  const name = draft.name.trim();
  if (!name) return { ok: false, reason: "invalid" };
  const members = await ownedMembers(db, shopId, draft.kind, draft.memberIds);
  if (!members.ok) return members;

  const [row] = await db
    .insert(embedSets)
    .values({ shopId, name, kind: draft.kind, memberIds: members.ids })
    .returning();
  return row ? { ok: true, set: row } : { ok: false, reason: "invalid" };
}

/**
 * Rename a list or change what is on it. The `kind` is not editable: a list of
 * departures and a list of courses are read by different widgets, and flipping
 * one under a snippet a shop already pasted would change what its page renders
 * without anybody touching that page.
 */
export async function updateEmbedSet(
  db: AppDb,
  shopId: string,
  setId: string,
  draft: Omit<EmbedSetDraft, "kind">,
): Promise<EmbedSetOutcome> {
  const existing = await getEmbedSet(db, shopId, setId);
  if (!existing) return { ok: false, reason: "not_found" };
  const name = draft.name.trim();
  if (!name) return { ok: false, reason: "invalid" };
  const members = await ownedMembers(db, shopId, existing.kind, draft.memberIds);
  if (!members.ok) return members;

  const [row] = await db
    .update(embedSets)
    .set({ name, memberIds: members.ids })
    .where(and(eq(embedSets.id, setId), eq(embedSets.shopId, shopId)))
    .returning();
  return row ? { ok: true, set: row } : { ok: false, reason: "not_found" };
}

/** ADR 20260820-every-delete-is-soft: the row stays, the list stops resolving. */
export async function deleteEmbedSet(
  db: AppDb,
  shopId: string,
  setId: string,
  now: Date = nowDate(),
): Promise<EmbedSetOutcome> {
  const [row] = await db
    .update(embedSets)
    .set({ deletedAt: now })
    .where(and(eq(embedSets.id, setId), eq(embedSets.shopId, shopId), isNull(embedSets.deletedAt)))
    .returning();
  return row ? { ok: true, set: row } : { ok: false, reason: "not_found" };
}

/**
 * The departures a `trip` list frames, in the shop's own order — by departure
 * time, which is the order the whole board already reads in.
 *
 * Composed from `pagedUpcomingTripsWithCounts` rather than a query of its own,
 * so a list inherits every filter the public board applies: scheduled, live,
 * not private, and not yet sailed (with the shop's late-arrival buffer). A
 * member that has since been cancelled, deleted, made private or has already
 * gone simply is not in the answer — and a list whose every member has sailed
 * comes back empty, which is the same empty the grid widget already renders
 * when nothing is upcoming.
 */
export async function listEmbedSetTrips(
  db: AppDb,
  shopId: string,
  memberIds: readonly string[],
  now: Date = nowDate(),
) {
  if (memberIds.length === 0) return [];
  const { trips: rows } = await pagedUpcomingTripsWithCounts(db, shopId, {
    now,
    ids: memberIds,
    limit: memberIds.length,
    publicOnly: true,
  });
  return rows;
}

/**
 * The courses a `course` list frames, in the roster's progression order — the
 * order `listActiveCourses` gives every other surface, so a list reads the way
 * the catalogue beside it does. An unpublished member drops out.
 */
export async function listEmbedSetCourses(
  db: AppDb,
  shopId: string,
  memberSlugs: readonly string[],
) {
  if (memberSlugs.length === 0) return [];
  const wanted = new Set(memberSlugs);
  return (await listActiveCourses(db, shopId)).filter((course) => wanted.has(course.slug));
}
