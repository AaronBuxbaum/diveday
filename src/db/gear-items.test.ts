import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext, seededShopContext } from "@/test/db";
import {
  countGearItems,
  createGearItem,
  deleteGearItem,
  restoreGearItem,
  setGearItemStatus,
  updateGearItem,
} from "./gear-items";
import {
  countGearItemsByKind,
  getGearItemDetail,
  listDeletedGearItems,
  listGearItems,
} from "./gear-register";
import {
  checkOutGearReservation,
  reserveGearUnit,
  returnGearReservation,
} from "./gear-reservations";
import { listGearServiceEvents, recordGearService } from "./gear-service";
import {
  gearShopContext,
  mustCreate,
  rivalShop,
  SETUP_PICK,
  shopBooking,
  TODAY,
} from "./gear-test-fixtures";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();

describe("gear items", () => {
  it("names exactly one holder: a booking or a person-held counter rental", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const bookingUnit = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "bcd", label: "BCD #holder-booking" }),
    );
    const personUnit = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "bcd", label: "BCD #holder-person" }),
    );
    const blankUnit = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "bcd", label: "BCD #holder-blank" }),
    );
    const doubleUnit = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "bcd", label: "BCD #holder-double" }),
    );
    const maya = await shopBooking(db, shop.id, "Maya Holder");

    const insertReservation = (input: {
      gearItemId: string;
      bookingId?: string;
      personId?: string;
    }) =>
      db.execute(sql`
        insert into gear_reservations (
          shop_id, gear_item_id, booking_id, person_id, reserved_from, reserved_until
        ) values (
          ${shop.id}, ${input.gearItemId}, ${input.bookingId ?? null}, ${input.personId ?? null},
          ${"2026-09-01"}, ${"2026-09-02"}
        )
      `);

    await expect(
      insertReservation({ gearItemId: bookingUnit.id, bookingId: maya.bookingId }),
    ).resolves.toBeDefined();
    await expect(
      insertReservation({ gearItemId: personUnit.id, personId: maya.personId }),
    ).resolves.toBeDefined();
    await expect(insertReservation({ gearItemId: blankUnit.id })).rejects.toThrow();
    await expect(
      insertReservation({
        gearItemId: doubleUnit.id,
        bookingId: maya.bookingId,
        personId: maya.personId,
      }),
    ).rejects.toThrow();
  });

  it("adds, edits, lists, and counts units — the register is presence, not a setting", async () => {
    const { db, shop } = await gearShopContext(ctx);
    expect(await countGearItems(db, shop.id)).toBe(0);

    const bcd = mustCreate(
      await createGearItem(db, {
        shopId: shop.id,
        kind: "bcd",
        label: "BCD #1",
        size: "M",
        brandModel: "Cressi Start",
      }),
    );
    mustCreate(await createGearItem(db, { shopId: shop.id, kind: "tank", label: "AL80-01" }));

    expect(await countGearItems(db, shop.id)).toBe(2);
    const byKind = await countGearItemsByKind(db, shop.id);
    expect(byKind.get("bcd")).toBe(1);
    expect(byKind.get("tank")).toBe(1);

    const page = await listGearItems(db, shop.id, { todayLocal: TODAY });
    expect(page.total).toBe(2);
    // Kind order matches the prep list: bcd before tank.
    expect(page.rows.map((row) => row.item.label)).toEqual(["BCD #1", "AL80-01"]);
    expect(page.rows[0]?.serviceState).toEqual({ state: "no_clock" });
    expect(page.rows[0]?.reservation).toBeNull();

    const updated = await updateGearItem(db, {
      shopId: shop.id,
      gearItemId: bcd.id,
      kind: "bcd",
      label: "BCD #1",
      size: "L",
      serialNumber: "C-991",
    });
    expect(updated).toMatchObject({ ok: true, item: { size: "L", serialNumber: "C-991" } });
  });

  // Issue #2207: only a regulator holds a nitrox answer; an edit that does
  // not carry the box leaves it; a kind change away from regulator clears it.
  it("holds a nitrox answer on a regulator only, and keeps it across an edit that does not say", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const reg = mustCreate(
      await createGearItem(db, {
        shopId: shop.id,
        kind: "regulator",
        label: "Reg #nx-1",
        nitroxDesignated: true,
      }),
    );
    expect(reg.nitroxDesignated).toBe(true);

    const bcd = mustCreate(
      await createGearItem(db, {
        shopId: shop.id,
        kind: "bcd",
        label: "BCD #nx-forged",
        nitroxDesignated: true,
      }),
    );
    expect(bcd.nitroxDesignated).toBeNull();

    const untouched = await updateGearItem(db, {
      shopId: shop.id,
      gearItemId: reg.id,
      kind: "regulator",
      label: "Reg #nx-1",
    });
    expect(untouched).toMatchObject({ ok: true, item: { nitroxDesignated: true } });

    const unticked = await updateGearItem(db, {
      shopId: shop.id,
      gearItemId: reg.id,
      kind: "regulator",
      label: "Reg #nx-1",
      nitroxDesignated: false,
    });
    expect(unticked).toMatchObject({ ok: true, item: { nitroxDesignated: false } });

    await updateGearItem(db, {
      shopId: shop.id,
      gearItemId: reg.id,
      kind: "regulator",
      label: "Reg #nx-1",
      nitroxDesignated: true,
    });
    const nowAnOctopus = await updateGearItem(db, {
      shopId: shop.id,
      gearItemId: reg.id,
      kind: "other",
      label: "Reg #nx-1",
    });
    expect(nowAnOctopus).toMatchObject({ ok: true, item: { nitroxDesignated: null } });
  });

  // Issue #2206: only a wetsuit holds a thickness, and the database refuses
  // one outside 1–10 mm whatever writes it.
  it("holds a thickness on a wetsuit only, keeps it across an edit that does not say, and refuses one out of range", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const suit = mustCreate(
      await createGearItem(db, {
        shopId: shop.id,
        kind: "wetsuit",
        label: "WS #mm-7",
        size: "L",
        thicknessMm: 7,
      }),
    );
    expect(suit.thicknessMm).toBe(7);
    const bcd = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "bcd", label: "BCD #mm", thicknessMm: 5 }),
    );
    expect(bcd.thicknessMm).toBeNull();

    const untouched = await updateGearItem(db, {
      shopId: shop.id,
      gearItemId: suit.id,
      kind: "wetsuit",
      label: "WS #mm-7",
      size: "L",
    });
    expect(untouched).toMatchObject({ ok: true, item: { thicknessMm: 7 } });
    const cleared = await updateGearItem(db, {
      shopId: shop.id,
      gearItemId: suit.id,
      kind: "wetsuit",
      label: "WS #mm-7",
      size: "L",
      thicknessMm: null,
    });
    expect(cleared).toMatchObject({ ok: true, item: { thicknessMm: null } });

    await expect(
      db.transaction((tx) =>
        tx.execute(sql`update gear_items set thickness_mm = 11 where id = ${suit.id}`),
      ),
    ).rejects.toThrow();
  });

  it("refuses a duplicate tag and an empty one — the tag is how a wet hand finds the row", async () => {
    // A database of its own, not the file's shared transaction: the duplicate
    // is refused by the unique index, a violation aborts a wrapping
    // transaction, and the rival shop's create after it would fail for that
    // reason alone (src/test/db.ts, "When NOT to use this").
    const { db, shop } = await gearShopContext(await seededShopContext());
    mustCreate(await createGearItem(db, { shopId: shop.id, kind: "regulator", label: "Reg #4" }));

    expect(
      await createGearItem(db, { shopId: shop.id, kind: "regulator", label: " Reg #4 " }),
    ).toEqual({ ok: false, reason: "duplicate_label" });
    expect(await createGearItem(db, { shopId: shop.id, kind: "regulator", label: "   " })).toEqual({
      ok: false,
      reason: "empty_label",
    });

    // The same tag at another shop is fine — uniqueness is per shop.
    const rival = await rivalShop(db);
    expect(
      (await createGearItem(db, { shopId: rival.id, kind: "regulator", label: "Reg #4" })).ok,
    ).toBe(true);
  });

  it("moves a unit through needs-service and back, clearing the complaint on the way in", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const item = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "bcd", label: "BCD #2" }),
    );

    const pulled = await setGearItemStatus(db, {
      shopId: shop.id,
      gearItemId: item.id,
      status: "needs_service",
      serviceNote: "inflator sticks",
    });
    expect(pulled).toMatchObject({
      ok: true,
      item: { status: "needs_service", serviceNote: "inflator sticks" },
    });

    const back = await setGearItemStatus(db, {
      shopId: shop.id,
      gearItemId: item.id,
      status: "in_service",
      serviceNote: "stale words that must not survive",
    });
    expect(back).toMatchObject({ ok: true, item: { status: "in_service", serviceNote: null } });
  });

  it("deletes a unit softly — off the register, history intact — and other tenants cannot reach it", async () => {
    // A database of its own: the refused restore below is the unique index
    // answering, which aborts a wrapping transaction (src/test/db.ts, "When NOT to use this").
    const { db, shop } = await gearShopContext(await seededShopContext());
    const rival = await rivalShop(db);
    const item = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "gopro", label: "GoPro A" }),
    );
    expect(
      await recordGearService(db, {
        shopId: shop.id,
        gearItemId: item.id,
        kind: "service",
        servicedOn: "2026-08-01",
        nextDueOn: "2027-08-01",
        note: "housing seal replaced",
      }),
    ).toEqual({ ok: true });

    expect(
      await deleteGearItem(db, { shopId: rival.id, gearItemId: item.id, todayLocal: TODAY }),
    ).toEqual({ ok: false, reason: "not_found" });

    const deleted = await deleteGearItem(db, {
      shopId: shop.id,
      gearItemId: item.id,
      todayLocal: TODAY,
    });
    expect(deleted).toMatchObject({ ok: true, deleted: { label: "GoPro A" } });

    // Off the register…
    expect(await countGearItems(db, shop.id)).toBe(0);
    expect((await listGearItems(db, shop.id, { todayLocal: TODAY })).rows).toHaveLength(0);
    // …but the row and its care history are still there, which is the point —
    // and its own record still reads them back, carrying the stamp that tells
    // the surface to render read-only (issue #614). Reading a deleted unit's
    // service history must not cost a restore onto the live register.
    expect(await listGearServiceEvents(db, shop.id, item.id)).toHaveLength(1);
    const record = await getGearItemDetail(db, shop.id, item.id);
    expect(record?.item.deletedAt).toBeInstanceOf(Date);
    expect(record?.history.map((event) => event.note)).toEqual(["housing seal replaced"]);
    // Still nobody else's to read, deleted or not.
    expect(await getGearItemDetail(db, rival.id, item.id)).toBeNull();
    const gone = await listDeletedGearItems(db, shop.id);
    expect(gone.rows.map((row) => row.label)).toEqual(["GoPro A"]);

    // And the tag it wore is free while it is gone, then refused on the way back.
    const replacement = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "gopro", label: "GoPro A" }),
    );
    expect(await restoreGearItem(db, { shopId: shop.id, gearItemId: item.id })).toEqual({
      ok: false,
      reason: "duplicate_label",
    });

    await updateGearItem(db, {
      shopId: shop.id,
      gearItemId: replacement.id,
      kind: "gopro",
      label: "GoPro B",
    });
    expect(await restoreGearItem(db, { shopId: shop.id, gearItemId: item.id })).toMatchObject({
      ok: true,
      item: { label: "GoPro A", deletedAt: null },
    });
    expect(await countGearItems(db, shop.id)).toBe(2);
    expect(await listGearServiceEvents(db, shop.id, item.id)).toHaveLength(1);
  });

  // Issue #2295: the refusal runs in a savepoint, so a caller's transaction
  // (here the file's shared one) is still usable after it.
  it("leaves a caller's transaction usable after refusing a restore onto a taken tag", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const item = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "bcd", label: "BCD #40" }),
    );
    await deleteGearItem(db, { shopId: shop.id, gearItemId: item.id, todayLocal: TODAY });
    mustCreate(await createGearItem(db, { shopId: shop.id, kind: "bcd", label: "BCD #40" }));

    expect(await restoreGearItem(db, { shopId: shop.id, gearItemId: item.id })).toEqual({
      ok: false,
      reason: "duplicate_label",
    });
    expect(await countGearItems(db, shop.id)).toBe(1);
  });

  it("refuses to delete a unit that is reserved for later or out on a rental", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const bcd = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "bcd", label: "BCD #11" }),
    );
    const maya = await shopBooking(db, shop.id, "Maya Reyes");
    const reserved = await reserveGearUnit(db, {
      shopId: shop.id,
      gearItemId: bcd.id,
      bookingId: maya.bookingId,
      // The seeded departure is in September; TODAY is 2026-08-20.
      reservedFrom: "2026-09-01",
      reservedUntil: "2026-09-02",
      screen: SETUP_PICK,
    });
    if (!reserved.ok) throw new Error(`reservation failed: ${reserved.reason}`);

    expect(
      await deleteGearItem(db, { shopId: shop.id, gearItemId: bcd.id, todayLocal: TODAY }),
    ).toEqual({ ok: false, reason: "reserved" });

    // Out the door and past its window still refuses: it is with a diver.
    await checkOutGearReservation(db, { shopId: shop.id, reservationId: reserved.reservation.id });
    expect(
      await deleteGearItem(db, { shopId: shop.id, gearItemId: bcd.id, todayLocal: "2026-09-30" }),
    ).toEqual({ ok: false, reason: "reserved" });

    // Home again, and the unit is the shop's to take off the register.
    await returnGearReservation(db, { shopId: shop.id, reservationId: reserved.reservation.id });
    expect(
      await deleteGearItem(db, { shopId: shop.id, gearItemId: bcd.id, todayLocal: "2026-09-30" }),
    ).toMatchObject({ ok: true });
  });
});
