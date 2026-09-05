import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { EMBED_SET_MAX } from "@/lib/embed-sets";
import { seededShopContext } from "@/test/db";
import { listActiveCourses } from "./courses";
import {
  createEmbedSet,
  deleteEmbedSet,
  getEmbedSet,
  listEmbedSetCourses,
  listEmbedSets,
  listEmbedSetTrips,
  updateEmbedSet,
} from "./embed-sets";
import { embedSets, trips } from "./schema";
import { pagedUpcomingTripsWithCounts } from "./trips";

async function context() {
  const { db, shop } = await seededShopContext();
  const { trips: upcoming } = await pagedUpcomingTripsWithCounts(db, shop.id, {
    limit: 6,
    publicOnly: true,
  });
  if (upcoming.length < 3) throw new Error("seeded shop needs three upcoming public departures");
  return { db, shop, upcoming };
}

describe("named embed lists", () => {
  it("stores a list of this shop's departures and reads it back", async () => {
    const { db, shop, upcoming } = await context();
    const created = await createEmbedSet(db, shop.id, {
      name: "Beginner boats",
      kind: "trip",
      memberIds: [upcoming[0].id, upcoming[1].id],
    });
    expect(created.ok).toBe(true);

    const listed = await listEmbedSets(db, shop.id);
    const mine = listed.find((set) => set.name === "Beginner boats");
    expect(mine?.memberIds).toEqual([upcoming[0].id, upcoming[1].id]);
    expect(mine?.kind).toBe("trip");
  });

  it("drops a member belonging to another shop rather than storing it", async () => {
    // The membership arrives from a checkbox list, which is one devtools edit
    // away from carrying another tenant's departure onto a public widget.
    const { db, shop, upcoming } = await context();
    const other = await seededShopContext();
    const { trips: theirs } = await pagedUpcomingTripsWithCounts(other.db, other.shop.id, {
      limit: 1,
      publicOnly: true,
    });
    // Their database is a separate PGlite, so their trip id cannot resolve in
    // ours — which is exactly the shape of the id an attacker would submit.
    const created = await createEmbedSet(db, shop.id, {
      name: "Mixed",
      kind: "trip",
      memberIds: [upcoming[0].id, theirs[0].id],
    });
    expect(created).toMatchObject({ ok: true });
    if (!created.ok) throw new Error("expected the list to save");
    expect(created.set.memberIds).toEqual([upcoming[0].id]);
  });

  it("refuses a list naming nothing this shop owns", async () => {
    const { db, shop } = await context();
    expect(
      await createEmbedSet(db, shop.id, {
        name: "Nothing",
        kind: "trip",
        memberIds: ["00000000-0000-4000-8000-0000000000ff"],
      }),
    ).toEqual({ ok: false, reason: "invalid" });
    // A member that is not a uuid at all is a refusal too, never a 500 from a
    // failed cast against `trips.id`.
    expect(
      await createEmbedSet(db, shop.id, {
        name: "Nothing",
        kind: "trip",
        memberIds: ["../../etc"],
      }),
    ).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses a nameless list", async () => {
    const { db, shop, upcoming } = await context();
    expect(
      await createEmbedSet(db, shop.id, {
        name: "   ",
        kind: "trip",
        memberIds: [upcoming[0].id],
      }),
    ).toEqual({ ok: false, reason: "invalid" });
  });

  it("scopes every reader and writer to the shop that owns the list", async () => {
    const { db, shop, upcoming } = await context();
    const created = await createEmbedSet(db, shop.id, {
      name: "Beginner boats",
      kind: "trip",
      memberIds: [upcoming[0].id],
    });
    if (!created.ok) throw new Error("expected the list to save");
    const foreignShop = "00000000-0000-4000-8000-0000000000aa";

    expect(await getEmbedSet(db, foreignShop, created.set.id)).toBeNull();
    expect(await listEmbedSets(db, foreignShop)).toEqual([]);
    expect(
      await updateEmbedSet(db, foreignShop, created.set.id, {
        name: "Theirs now",
        memberIds: [upcoming[0].id],
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(await deleteEmbedSet(db, foreignShop, created.set.id)).toEqual({
      ok: false,
      reason: "not_found",
    });
    // Untouched by any of it.
    expect((await getEmbedSet(db, shop.id, created.set.id))?.name).toBe("Beginner boats");
  });

  it("keeps a deleted list out of every read while the row stays", async () => {
    const { db, shop, upcoming } = await context();
    const created = await createEmbedSet(db, shop.id, {
      name: "Retired",
      kind: "trip",
      memberIds: [upcoming[0].id],
    });
    if (!created.ok) throw new Error("expected the list to save");

    expect(await deleteEmbedSet(db, shop.id, created.set.id)).toMatchObject({ ok: true });
    expect(await getEmbedSet(db, shop.id, created.set.id)).toBeNull();
    expect((await listEmbedSets(db, shop.id)).some((set) => set.id === created.set.id)).toBe(false);
    // Soft, so history holds (ADR 20260820-every-delete-is-soft).
    const [row] = await db.select().from(embedSets).where(eq(embedSets.id, created.set.id));
    expect(row?.deletedAt).not.toBeNull();
    // And a second delete is a refusal rather than a silent success.
    expect(await deleteEmbedSet(db, shop.id, created.set.id)).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("refuses a 25th member at the database rather than truncating it", async () => {
    const { db, shop, upcoming } = await context();
    const tooMany = Array.from({ length: EMBED_SET_MAX + 1 }, () => upcoming[0].id);
    // The normalizer collapses duplicates, so build the over-cap case at the
    // constraint itself: this is the guard against a writer that bypasses it.
    await expect(
      db.insert(embedSets).values({
        shopId: shop.id,
        name: "Everything",
        kind: "trip",
        memberIds: tooMany.map((id, index) => `${id}-${index}`),
      }),
    ).rejects.toThrow();
  });
});

describe("resolving a list into what a widget renders", () => {
  it("orders departures by when they leave", async () => {
    const { db, shop, upcoming } = await context();
    const shuffled = [upcoming[2].id, upcoming[0].id, upcoming[1].id];
    const resolved = await listEmbedSetTrips(db, shop.id, shuffled);
    expect(resolved.map((trip) => trip.id)).toEqual([
      upcoming[0].id,
      upcoming[1].id,
      upcoming[2].id,
    ]);
  });

  it("drops a member the shop has cancelled, deleted or made private", async () => {
    const { db, shop, upcoming } = await context();
    await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, upcoming[0].id));
    await db.update(trips).set({ deletedAt: nowDate() }).where(eq(trips.id, upcoming[1].id));
    await db.update(trips).set({ isPrivate: true }).where(eq(trips.id, upcoming[2].id));

    expect(
      await listEmbedSetTrips(db, shop.id, [upcoming[0].id, upcoming[1].id, upcoming[2].id]),
    ).toEqual([]);
  });

  it("comes back empty rather than throwing when every member has sailed", async () => {
    // The same empty the whole grid renders when nothing is upcoming — no
    // second empty state to keep consistent with the first.
    const { db, shop, upcoming } = await context();
    const longAfter = new Date(upcoming[2].startsAt.getTime() + 365 * 24 * 60 * 60 * 1000);
    expect(await listEmbedSetTrips(db, shop.id, [upcoming[0].id], longAfter)).toEqual([]);
    expect(await listEmbedSetTrips(db, shop.id, [])).toEqual([]);
  });

  it("resolves course members in the roster's progression order", async () => {
    const { db, shop } = await context();
    const active = await listActiveCourses(db, shop.id);
    if (active.length < 2) throw new Error("seeded shop needs two active courses");
    const reversed = [active[1].slug, active[0].slug];

    const resolved = await listEmbedSetCourses(db, shop.id, reversed);
    expect(resolved.map((course) => course.slug)).toEqual([active[0].slug, active[1].slug]);
  });
});
