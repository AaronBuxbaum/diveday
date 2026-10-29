import { and, asc, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { SNAG_NOTE_MAX } from "@/lib/pre-departure-check";
import { fileScopedShopContext } from "@/test/db";
import {
  answerSnag,
  noteSnag,
  openSnagsForShop,
  openSnagsForTrip,
  snagsOpenWhenSailed,
} from "./boat-snags";
import { listChecklistItems } from "./pre-departure-check";
import { boatSnags, boats, preDepartureChecklistItems, shops, trips } from "./schema";
import { listStaff } from "./trips";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`); nothing here commits or races.
const ctx = fileScopedShopContext();

/**
 * Two upcoming departures put on one boat, a third on another, and the
 * crew who write and answer.
 */
async function snagContext() {
  const { db, shop } = ctx;
  const [first, second, third] = await db
    .select({ id: trips.id, startsAt: trips.startsAt })
    .from(trips)
    .where(and(eq(trips.shopId, shop.id), eq(trips.status, "scheduled"), isNull(trips.deletedAt)))
    .orderBy(asc(trips.startsAt), asc(trips.id))
    .limit(3);
  const [mantis, other] = await db
    .select({ id: boats.id, name: boats.name })
    .from(boats)
    .where(and(eq(boats.shopId, shop.id), isNull(boats.deletedAt)))
    .orderBy(asc(boats.name))
    .limit(2);
  if (!first || !second || !third || !mantis || !other)
    throw new Error("demo trips or boats missing");
  await db.update(trips).set({ boatId: mantis.id }).where(eq(trips.id, first.id));
  await db.update(trips).set({ boatId: mantis.id }).where(eq(trips.id, second.id));
  await db.update(trips).set({ boatId: other.id }).where(eq(trips.id, third.id));
  const [item] = await listChecklistItems(db, shop.id);
  if (!item) throw new Error("demo checklist missing");
  const staff = await listStaff(db, shop.id);
  const captain = staff[0]?.person;
  const nextCrew = staff[1]?.person;
  if (!captain || !nextCrew) throw new Error("demo staff missing");
  return { db, shop, first, second, third, mantis, item, captain, nextCrew };
}

describe("boat snags (in-memory PGlite)", () => {
  it("hands a snag from one departure to the boat's next, and closes it on Fixed", async () => {
    const { db, shop, first, second, third, item, captain, nextCrew } = await snagContext();
    const noted = await noteSnag(db, {
      shopId: shop.id,
      tripId: first.id,
      checklistItemId: item.id,
      personId: captain.id,
      note: "  VHF crackles on 16  ",
    });
    expect(noted.ok).toBe(true);

    const here = await openSnagsForTrip(db, shop.id, first.id);
    expect(here).toMatchObject([
      { note: "VHF crackles on 16", itemLabel: item.label, notedHere: true, stillThere: null },
    ]);
    const next = await openSnagsForTrip(db, shop.id, second.id);
    expect(next).toMatchObject([
      { note: "VHF crackles on 16", notedByName: captain.fullName, notedHere: false },
    ]);
    // Another hull never wears it.
    expect(await openSnagsForTrip(db, shop.id, third.id)).toEqual([]);

    const snagId = next[0]?.id ?? "";
    const still = await answerSnag(db, {
      shopId: shop.id,
      tripId: second.id,
      snagId,
      personId: nextCrew.id,
      answer: "still_there",
    });
    expect(still.ok).toBe(true);
    expect((await openSnagsForTrip(db, shop.id, second.id))[0]?.stillThere?.byName).toBe(
      nextCrew.fullName,
    );

    const fixed = await answerSnag(db, {
      shopId: shop.id,
      tripId: second.id,
      snagId,
      personId: nextCrew.id,
      answer: "fixed",
    });
    expect(fixed.ok).toBe(true);
    expect(await openSnagsForTrip(db, shop.id, second.id)).toEqual([]);
    expect(await openSnagsForShop(db, shop.id, nowDate())).toEqual([]);
    // A fixed snag stays fixed: a second answer finds nothing open.
    expect(
      await answerSnag(db, {
        shopId: shop.id,
        tripId: second.id,
        snagId,
        personId: nextCrew.id,
        answer: "still_there",
      }),
    ).toEqual({ ok: false, reason: "snag_unavailable" });
  });

  it("is not worn by a departure that sailed before it was written", async () => {
    const { db, shop, first, second, item, captain } = await snagContext();
    await noteSnag(db, {
      shopId: shop.id,
      tripId: second.id,
      checklistItemId: item.id,
      personId: captain.id,
      note: "Ladder bolt loose",
    });
    expect(await openSnagsForTrip(db, shop.id, first.id)).toEqual([]);
    expect(await openSnagsForTrip(db, shop.id, second.id)).toHaveLength(1);
  });

  it("refuses another boat's departure answering it", async () => {
    const { db, shop, first, third, item, captain } = await snagContext();
    const noted = await noteSnag(db, {
      shopId: shop.id,
      tripId: first.id,
      checklistItemId: item.id,
      personId: captain.id,
      note: "Bilge alarm chirps",
    });
    if (!noted.ok) throw new Error("note refused");
    expect(
      await answerSnag(db, {
        shopId: shop.id,
        tripId: third.id,
        snagId: noted.snagId,
        personId: captain.id,
        answer: "fixed",
      }),
    ).toEqual({ ok: false, reason: "snag_unavailable" });
    expect(await openSnagsForTrip(db, shop.id, first.id)).toHaveLength(1);
  });

  it("refuses an earlier departure of the same boat answering it", async () => {
    const { db, shop, first, second, item, captain } = await snagContext();
    const noted = await noteSnag(db, {
      shopId: shop.id,
      tripId: second.id,
      checklistItemId: item.id,
      personId: captain.id,
      note: "Ladder bolt loose",
    });
    if (!noted.ok) throw new Error("note refused");
    // The earlier departure never shows the snag, so it cannot close it.
    expect(
      await answerSnag(db, {
        shopId: shop.id,
        tripId: first.id,
        snagId: noted.snagId,
        personId: captain.id,
        answer: "fixed",
      }),
    ).toEqual({ ok: false, reason: "snag_unavailable" });
    expect(await openSnagsForTrip(db, shop.id, second.id)).toHaveLength(1);
  });

  it("refuses a canceled departure noting or answering one", async () => {
    const { db, shop, first, second, item, captain } = await snagContext();
    const noted = await noteSnag(db, {
      shopId: shop.id,
      tripId: first.id,
      checklistItemId: item.id,
      personId: captain.id,
      note: "Bilge alarm chirps",
    });
    if (!noted.ok) throw new Error("note refused");
    await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, second.id));
    expect(
      await answerSnag(db, {
        shopId: shop.id,
        tripId: second.id,
        snagId: noted.snagId,
        personId: captain.id,
        answer: "fixed",
      }),
    ).toEqual({ ok: false, reason: "trip_unavailable" });
    expect(
      await noteSnag(db, {
        shopId: shop.id,
        tripId: second.id,
        checklistItemId: item.id,
        personId: captain.id,
        note: "VHF",
      }),
    ).toEqual({ ok: false, reason: "trip_unavailable" });
    expect(await openSnagsForTrip(db, shop.id, first.id)).toHaveLength(1);
  });

  it("uses the shop's checklist on both boats and refuses another shop's item", async () => {
    const { db, shop, first, third, item, captain } = await snagContext();
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Another shop", slug: "another-snag-shop", timezone: "UTC" })
      .returning({ id: shops.id });
    if (!otherShop) throw new Error("other shop missing");
    const [foreignItem] = await db
      .insert(preDepartureChecklistItems)
      .values({ shopId: otherShop.id, label: "Other shop's radio" })
      .returning({ id: preDepartureChecklistItems.id });
    if (!foreignItem) throw new Error("other shop's checklist item missing");

    const input = {
      shopId: shop.id,
      tripId: first.id,
      personId: captain.id,
      note: "Radio needs attention",
    };
    expect(await noteSnag(db, { ...input, checklistItemId: foreignItem.id })).toEqual({
      ok: false,
      reason: "item_unavailable",
    });
    expect(await db.select().from(boatSnags).where(eq(boatSnags.shopId, shop.id))).toEqual([]);

    expect((await noteSnag(db, { ...input, checklistItemId: item.id })).ok).toBe(true);
    expect((await noteSnag(db, { ...input, tripId: third.id, checklistItemId: item.id })).ok).toBe(
      true,
    );
    expect(await db.select().from(boatSnags).where(eq(boatSnags.shopId, shop.id))).toHaveLength(2);
  });

  it("refuses an empty or overlong note and a boatless departure", async () => {
    const { db, shop, first, item, captain } = await snagContext();
    const base = {
      shopId: shop.id,
      tripId: first.id,
      checklistItemId: item.id,
      personId: captain.id,
    };
    expect(await noteSnag(db, { ...base, note: "   " })).toEqual({
      ok: false,
      reason: "note_invalid",
    });
    expect(await noteSnag(db, { ...base, note: "x".repeat(SNAG_NOTE_MAX + 1) })).toEqual({
      ok: false,
      reason: "note_invalid",
    });
    await db.update(trips).set({ boatId: null }).where(eq(trips.id, first.id));
    expect(await noteSnag(db, { ...base, note: "VHF" })).toEqual({ ok: false, reason: "no_boat" });
  });

  it("gives the owner one row per open snag, with the boat's next departure", async () => {
    const { db, shop, first, second, mantis, item, captain } = await snagContext();
    await noteSnag(db, {
      shopId: shop.id,
      tripId: first.id,
      checklistItemId: item.id,
      personId: captain.id,
      note: "VHF crackles on 16",
    });
    const rows = await openSnagsForShop(db, shop.id, nowDate());
    expect(rows).toMatchObject([
      {
        boatName: mantis.name,
        itemLabel: item.label,
        note: "VHF crackles on 16",
        notedByName: captain.fullName,
        departuresSince: 0,
        next: { tripId: second.id },
      },
    ]);
  });

  it("names, for the record, the snags open when the boat sailed and no others", async () => {
    const { db, shop, first, second, third, item, captain } = await snagContext();
    const note = async (words: string) => {
      const noted = await noteSnag(db, {
        shopId: shop.id,
        tripId: first.id,
        checklistItemId: item.id,
        personId: captain.id,
        note: words,
      });
      if (!noted.ok) throw new Error("note refused");
      return noted.snagId;
    };
    const carried = await note("VHF crackles on 16");
    const fixedBetween = await note("Ladder bolt loose");
    const fixedBefore = await note("Bilge alarm chirps");
    const writtenAfter = await note("Swim step cracked");
    // Written at the dock two hours before the first boat left, all but one.
    await db
      .update(boatSnags)
      .set({ notedAt: new Date(first.startsAt.getTime() - 2 * 60 * 60_000) })
      .where(eq(boatSnags.shopId, shop.id));
    const between = new Date((first.startsAt.getTime() + second.startsAt.getTime()) / 2);
    await db
      .update(boatSnags)
      .set({ fixedAt: between, fixedByPersonId: captain.id, fixedOnTripId: second.id })
      .where(eq(boatSnags.id, fixedBetween));
    await db
      .update(boatSnags)
      .set({
        fixedAt: new Date(first.startsAt.getTime() - 60_000),
        fixedByPersonId: captain.id,
        fixedOnTripId: first.id,
      })
      .where(eq(boatSnags.id, fixedBefore));
    await db.update(boatSnags).set({ notedAt: between }).where(eq(boatSnags.id, writtenAfter));

    // `writtenAfter` is this crew's own late note (the boat left late): the
    // record carries it whatever the clock said; a carried snag needs the
    // scheduled start to have found it open.
    const atFirst = await snagsOpenWhenSailed(db, shop.id, first.id);
    expect(atFirst.map((snag) => snag.note).sort()).toEqual([
      "Ladder bolt loose",
      "Swim step cracked",
      "VHF crackles on 16",
    ]);
    expect(atFirst[0]).toMatchObject({ itemLabel: item.label, notedByName: captain.fullName });
    const atSecond = await snagsOpenWhenSailed(db, shop.id, second.id);
    expect(atSecond.map((snag) => snag.id).sort()).toEqual([carried, writtenAfter].sort());
    expect(await snagsOpenWhenSailed(db, shop.id, third.id)).toEqual([]);
  });

  it("names nothing open when a canceled departure sailed, because it never did", async () => {
    const { db, shop, first, second, item, captain } = await snagContext();
    const noted = await noteSnag(db, {
      shopId: shop.id,
      tripId: first.id,
      checklistItemId: item.id,
      personId: captain.id,
      note: "VHF crackles on 16",
    });
    if (!noted.ok) throw new Error("note refused");
    await db
      .update(boatSnags)
      .set({ notedAt: new Date(first.startsAt.getTime() - 60 * 60_000) })
      .where(eq(boatSnags.id, noted.snagId));
    expect(await snagsOpenWhenSailed(db, shop.id, second.id)).toHaveLength(1);
    await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, second.id));
    expect(await snagsOpenWhenSailed(db, shop.id, second.id)).toEqual([]);
  });
});
