import { describe, expect, it } from "vitest";
import type { Role } from "@/lib/authz";
import { seededShopContext } from "@/test/db";
import {
  canPersonConfigureTrips,
  canPersonDeleteDiver,
  canPersonManageOrders,
  canPersonManagePaymentSettings,
  canPersonManageStaffAccounts,
  canPersonManageWaiverTemplates,
  canPersonOverrideGearRequest,
  canPersonRefund,
  loadActiveStaffRoles,
} from "./authz";
import type { AppDb } from "./client";
import { people, personRoles, userAccounts } from "./schema";

let seq = 0;

async function makeStaff(
  db: AppDb,
  shopId: string,
  roles: Role[],
  opts: { status?: "active" | "disabled"; deleted?: boolean } = {},
): Promise<string> {
  seq += 1;
  const [person] = await db
    .insert(people)
    .values({
      shopId,
      fullName: `Staff ${seq}`,
      deletedAt: opts.deleted ? new Date("2026-06-01T00:00:00Z") : null,
    })
    .returning();
  if (!person) throw new Error("failed to insert staff");
  if (roles.length > 0) {
    await db.insert(personRoles).values(roles.map((role) => ({ personId: person.id, role })));
  }
  await db.insert(userAccounts).values({
    personId: person.id,
    email: `staff.${seq}@example.com`,
    hashedPassword: "x",
    status: opts.status ?? "active",
  });
  return person.id;
}

describe("loadActiveStaffRoles", () => {
  it("returns the person's live roles for an active staff member", async () => {
    const { db, shop } = await seededShopContext();
    const person = await makeStaff(db, shop.id, ["owner", "manager"]);
    const roles = await loadActiveStaffRoles(db, shop.id, person);
    expect(roles).not.toBeNull();
    expect([...(roles ?? [])].sort()).toEqual(["manager", "owner"]);
  });

  it("returns null for a disabled account, a deleted person, or the wrong shop", async () => {
    const { db, shop } = await seededShopContext();
    const disabled = await makeStaff(db, shop.id, ["owner"], { status: "disabled" });
    const deleted = await makeStaff(db, shop.id, ["owner"], { deleted: true });
    const owner = await makeStaff(db, shop.id, ["owner"]);

    expect(await loadActiveStaffRoles(db, shop.id, disabled)).toBeNull();
    expect(await loadActiveStaffRoles(db, shop.id, deleted)).toBeNull();
    expect(
      await loadActiveStaffRoles(db, "00000000-0000-0000-0000-000000000000", owner),
    ).toBeNull();
  });
});

describe("H-14 owner/manager surfaces", () => {
  it("admit an owner and a manager, refuse instructor and the daily crew", async () => {
    const { db, shop } = await seededShopContext();
    const owner = await makeStaff(db, shop.id, ["owner"]);
    const manager = await makeStaff(db, shop.id, ["manager"]);
    const instructor = await makeStaff(db, shop.id, ["instructor"]);
    const captain = await makeStaff(db, shop.id, ["captain"]);
    const divemaster = await makeStaff(db, shop.id, ["divemaster"]);

    for (const gate of [
      canPersonManageOrders,
      canPersonManagePaymentSettings,
      canPersonRefund,
      canPersonManageWaiverTemplates,
      canPersonDeleteDiver,
      canPersonManageStaffAccounts,
    ]) {
      expect(await gate(db, shop.id, owner)).toBe(true);
      expect(await gate(db, shop.id, manager)).toBe(true);
      expect(await gate(db, shop.id, instructor)).toBe(false);
      expect(await gate(db, shop.id, captain)).toBe(false);
      expect(await gate(db, shop.id, divemaster)).toBe(false);
    }
  });

  it("refuse a disabled or deleted owner immediately (closes the JWT window)", async () => {
    const { db, shop } = await seededShopContext();
    const disabled = await makeStaff(db, shop.id, ["owner"], { status: "disabled" });
    const deleted = await makeStaff(db, shop.id, ["owner"], { deleted: true });

    expect(await canPersonRefund(db, shop.id, disabled)).toBe(false);
    expect(await canPersonDeleteDiver(db, shop.id, deleted)).toBe(false);
  });
});

describe("H-06 gear-request override", () => {
  it("admits owner, manager, instructor, and divemaster; refuses deck crew", async () => {
    const { db, shop } = await seededShopContext();
    const owner = await makeStaff(db, shop.id, ["owner"]);
    const manager = await makeStaff(db, shop.id, ["manager"]);
    const instructor = await makeStaff(db, shop.id, ["instructor"]);
    const divemaster = await makeStaff(db, shop.id, ["divemaster"]);
    const captain = await makeStaff(db, shop.id, ["captain"]);
    const crew = await makeStaff(db, shop.id, ["crew"]);

    expect(await canPersonOverrideGearRequest(db, shop.id, owner)).toBe(true);
    expect(await canPersonOverrideGearRequest(db, shop.id, manager)).toBe(true);
    expect(await canPersonOverrideGearRequest(db, shop.id, instructor)).toBe(true);
    expect(await canPersonOverrideGearRequest(db, shop.id, divemaster)).toBe(true);
    expect(await canPersonOverrideGearRequest(db, shop.id, captain)).toBe(false);
    expect(await canPersonOverrideGearRequest(db, shop.id, crew)).toBe(false);
  });

  it("refuses a disabled divemaster immediately", async () => {
    const { db, shop } = await seededShopContext();
    const disabled = await makeStaff(db, shop.id, ["divemaster"], { status: "disabled" });
    expect(await canPersonOverrideGearRequest(db, shop.id, disabled)).toBe(false);
  });
});

describe("H-14 trip configuration", () => {
  it("admits owner, manager, and instructor; refuses captain, crew, and divemaster", async () => {
    const { db, shop } = await seededShopContext();
    const owner = await makeStaff(db, shop.id, ["owner"]);
    const manager = await makeStaff(db, shop.id, ["manager"]);
    const instructor = await makeStaff(db, shop.id, ["instructor"]);
    const captain = await makeStaff(db, shop.id, ["captain"]);
    const crew = await makeStaff(db, shop.id, ["crew"]);
    const divemaster = await makeStaff(db, shop.id, ["divemaster"]);

    expect(await canPersonConfigureTrips(db, shop.id, owner)).toBe(true);
    expect(await canPersonConfigureTrips(db, shop.id, manager)).toBe(true);
    expect(await canPersonConfigureTrips(db, shop.id, instructor)).toBe(true);
    expect(await canPersonConfigureTrips(db, shop.id, captain)).toBe(false);
    expect(await canPersonConfigureTrips(db, shop.id, crew)).toBe(false);
    expect(await canPersonConfigureTrips(db, shop.id, divemaster)).toBe(false);
  });
});
