// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { calendarDateInTimezone, shiftCalendarDateMonths } from "@/lib/calendar-date";
import { DAY_MS, nowDate, nowMs } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import {
  deleteSafetyDrill,
  lastSafetyDrills,
  listSafetyDrills,
  recordSafetyDrill,
} from "./safety-drills";
import { people, personRoles, safetyDrills, shops, userAccounts } from "./schema";
import { listStaff } from "./trips";

const ctx = fileScopedShopContext();

/** The shop's owner (may record) and another staffer to take part. */
async function cast() {
  const { db, shop } = ctx;
  const staff = await listStaff(db, shop.id);
  const owner = staff.find((member) => member.roles.includes("owner"));
  const other = staff.find((member) => member !== owner);
  if (!owner || !other) throw new Error("seeded owner and staffer missing");
  const today = calendarDateInTimezone(nowDate(), shop.timezone);
  return { ownerId: owner.person.id, otherId: other.person.id, today };
}

const daysAgo = (days: number, zone: string) =>
  calendarDateInTimezone(new Date(nowMs() - days * DAY_MS), zone);

/**
 * **The drill log's writer and readers** (loop 5, row 2). A record an
 * insurer reads, so the refusals come first: a drill on somebody else's
 * books, in the future, of a kind that does not exist, or naming a person who
 * is not this shop's staff is never written.
 */
describe("recordSafetyDrill", () => {
  it("records a drill with who took part, and reads it back", async () => {
    const { db, shop } = ctx;
    const { ownerId, otherId, today } = await cast();
    const outcome = await recordSafetyDrill(db, {
      shopId: shop.id,
      recordedByPersonId: ownerId,
      kind: "oxygen",
      heldOn: today,
      note: "  Both kits, masks fitted.  ",
      participantIds: [ownerId, otherId, otherId],
    });
    expect(outcome).toEqual({ ok: true, id: expect.any(String) });
    const [drill] = await listSafetyDrills(db, shop.id, { from: today, to: today });
    expect(drill).toMatchObject({
      kind: "oxygen",
      heldOn: today,
      note: "Both kits, masks fitted.",
    });
    expect(drill?.participants).toHaveLength(2);
  });

  it("refuses somebody who may not see the Safety tab", async () => {
    const { db, shop } = ctx;
    const { today } = await cast();
    const [diver] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Ada" })
      .returning();
    if (!diver) throw new Error("person insert failed");
    await expect(
      recordSafetyDrill(db, {
        shopId: shop.id,
        recordedByPersonId: diver.id,
        kind: "fire",
        heldOn: today,
        participantIds: [],
      }),
    ).resolves.toEqual({ ok: false, reason: "not_allowed" });
  });

  it("refuses a date in the future, a date that is not one, and an unknown kind", async () => {
    const { db, shop } = ctx;
    const { ownerId } = await cast();
    const base = { shopId: shop.id, recordedByPersonId: ownerId, participantIds: [] };
    const tomorrow = calendarDateInTimezone(new Date(nowMs() + 2 * DAY_MS), shop.timezone);
    await expect(
      recordSafetyDrill(db, { ...base, kind: "fire", heldOn: tomorrow }),
    ).resolves.toEqual({ ok: false, reason: "invalid_date" });
    await expect(
      recordSafetyDrill(db, { ...base, kind: "fire", heldOn: "2026-02-30" }),
    ).resolves.toEqual({ ok: false, reason: "invalid_date" });
    await expect(
      recordSafetyDrill(db, { ...base, kind: "flood", heldOn: daysAgo(1, shop.timezone) }),
    ).resolves.toEqual({ ok: false, reason: "invalid_kind" });
  });

  it("refuses a drill held more than a year back, and takes one a year back to the day", async () => {
    const { db, shop } = ctx;
    const { ownerId, today } = await cast();
    const base = { shopId: shop.id, recordedByPersonId: ownerId, participantIds: [] };
    const yearBack = shiftCalendarDateMonths(today, -12);
    await expect(
      recordSafetyDrill(db, { ...base, kind: "fire", heldOn: "0001-01-01" }),
    ).resolves.toEqual({ ok: false, reason: "invalid_date" });
    await expect(
      recordSafetyDrill(db, { ...base, kind: "fire", heldOn: daysAgo(400, shop.timezone) }),
    ).resolves.toEqual({ ok: false, reason: "invalid_date" });
    await expect(
      recordSafetyDrill(db, { ...base, kind: "fire", heldOn: yearBack }),
    ).resolves.toEqual({ ok: true, id: expect.any(String) });
  });

  it("reads back who logged each drill and when", async () => {
    const { db, shop } = ctx;
    const { ownerId, today } = await cast();
    await recordSafetyDrill(db, {
      shopId: shop.id,
      recordedByPersonId: ownerId,
      kind: "fire",
      heldOn: today,
      participantIds: [],
    });
    const [owner] = await db.select().from(people).where(eq(people.id, ownerId));
    const [drill] = await listSafetyDrills(db, shop.id, { from: today, to: today });
    expect(drill).toMatchObject({ recordedBy: owner?.fullName, recordedAt: expect.any(Date) });
  });

  it("refuses a participant who is not this shop's staff", async () => {
    const { db, shop } = ctx;
    const { ownerId, today } = await cast();
    const [diver] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Ada" })
      .returning();
    if (!diver) throw new Error("person insert failed");
    await expect(
      recordSafetyDrill(db, {
        shopId: shop.id,
        recordedByPersonId: ownerId,
        kind: "overboard",
        heldOn: today,
        participantIds: [diver.id],
      }),
    ).resolves.toEqual({ ok: false, reason: "invalid_participant" });
    expect(await db.select().from(safetyDrills).where(eq(safetyDrills.shopId, shop.id))).toEqual(
      [],
    );
  });
});

describe("lastSafetyDrills and deleteSafetyDrill", () => {
  it("answers the latest live drill per kind; a deleted drill no longer counts", async () => {
    const { db, shop } = ctx;
    const { ownerId } = await cast();
    const base = { shopId: shop.id, recordedByPersonId: ownerId, participantIds: [] };
    await recordSafetyDrill(db, { ...base, kind: "oxygen", heldOn: daysAgo(94, shop.timezone) });
    const newer = await recordSafetyDrill(db, {
      ...base,
      kind: "oxygen",
      heldOn: daysAgo(3, shop.timezone),
    });
    if (!newer.ok) throw new Error("drill not recorded");
    expect((await lastSafetyDrills(db, shop.id)).get("oxygen")).toBe(daysAgo(3, shop.timezone));

    await expect(
      deleteSafetyDrill(db, { shopId: shop.id, personId: ownerId, drillId: newer.id }),
    ).resolves.toBe(true);
    expect((await lastSafetyDrills(db, shop.id)).get("oxygen")).toBe(daysAgo(94, shop.timezone));
    // Soft: the row is still there, stamped.
    const [row] = await db.select().from(safetyDrills).where(eq(safetyDrills.id, newer.id));
    expect(row?.deletedAt).not.toBeNull();
  });

  it("names who deleted a drill, not who logged it", async () => {
    const { db, shop } = ctx;
    const { ownerId, today } = await cast();
    const [manager] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Mia", email: "mia.drills@shop.example" })
      .returning();
    if (!manager) throw new Error("person insert failed");
    await db.insert(personRoles).values({ personId: manager.id, role: "manager" });
    await db
      .insert(userAccounts)
      .values({ personId: manager.id, email: "mia.drills@shop.example" });
    const drill = await recordSafetyDrill(db, {
      shopId: shop.id,
      recordedByPersonId: ownerId,
      kind: "fire",
      heldOn: today,
      participantIds: [],
    });
    if (!drill.ok) throw new Error("drill not recorded");
    await expect(
      deleteSafetyDrill(db, { shopId: shop.id, personId: manager.id, drillId: drill.id }),
    ).resolves.toBe(true);
    const [row] = await db.select().from(safetyDrills).where(eq(safetyDrills.id, drill.id));
    expect(row).toMatchObject({ recordedByPersonId: ownerId, deletedByPersonId: manager.id });
  });

  it("never stamps a delete without naming who did it", async () => {
    const { db, shop } = ctx;
    const { ownerId, today } = await cast();
    const drill = await recordSafetyDrill(db, {
      shopId: shop.id,
      recordedByPersonId: ownerId,
      kind: "fire",
      heldOn: today,
      participantIds: [],
    });
    if (!drill.ok) throw new Error("drill not recorded");
    await expect(
      db.update(safetyDrills).set({ deletedAt: nowDate() }).where(eq(safetyDrills.id, drill.id)),
    ).rejects.toThrow();
  });

  it("deletes nothing on another shop's books", async () => {
    const { db, shop } = ctx;
    const { ownerId, today } = await cast();
    const made = await recordSafetyDrill(db, {
      shopId: shop.id,
      recordedByPersonId: ownerId,
      kind: "fire",
      heldOn: today,
      participantIds: [],
    });
    if (!made.ok) throw new Error("drill not recorded");
    const [other] = await db
      .insert(shops)
      .values({ name: "Other", slug: "other-drills", timezone: "America/New_York" })
      .returning();
    if (!other) throw new Error("shop insert failed");
    await expect(
      deleteSafetyDrill(db, { shopId: other.id, personId: ownerId, drillId: made.id }),
    ).resolves.toBe(false);
    expect(await lastSafetyDrills(db, other.id)).toEqual(new Map());
  });
});
