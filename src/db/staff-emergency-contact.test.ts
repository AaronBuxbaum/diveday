import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Role } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { listShopStaff, setStaffEmergencyContact } from "../features/staff-accounts/store";
import type { AppDb } from "./client";
import { people, personRoles, shops, userAccounts } from "./schema";

const ctx = fileScopedShopContext();

let seq = 0;

/** A staff person with a real account, for scenarios that need one already in place. */
async function makeStaff(
  db: AppDb,
  shopId: string,
  roles: Role[],
  opts: { status?: "invited" | "active" | "disabled" } = {},
): Promise<{ personId: string; userAccountId: string }> {
  seq += 1;
  const [person] = await db
    .insert(people)
    .values({ shopId, fullName: `Staff ${seq}`, email: `staff.${seq}@example.com` })
    .returning();
  if (!person) throw new Error("failed to insert staff");
  if (roles.length > 0) {
    await db.insert(personRoles).values(roles.map((role) => ({ personId: person.id, role })));
  }
  const [account] = await db
    .insert(userAccounts)
    .values({
      personId: person.id,
      email: `staff.${seq}@example.com`,
      hashedPassword: "x",
      status: opts.status ?? "active",
    })
    .returning();
  if (!account) throw new Error("failed to insert account");
  return { personId: person.id, userAccountId: account.id };
}

describe("setStaffEmergencyContact", () => {
  // Why this exists at all: the printed boat manifest carries every diver's
  // emergency contact and carried none for crew, so the paper a coastguard
  // reads answered "who do we call?" for the paying passengers and for neither
  // of the two staff most reliably in the water (dive-domain review 20260810).
  it("stores both halves and reads them back through listShopStaff", async () => {
    const { db, shop } = ctx;
    const { personId } = await makeStaff(db, shop.id, ["captain"]);

    const result = await setStaffEmergencyContact(db, {
      shopId: shop.id,
      personId,
      name: "  Marta Okonkwo (sister)  ",
      phone: "  +1-305-555-0114  ",
    });

    expect(result).toEqual({ ok: true });
    const member = (await listShopStaff(db, shop.id)).find((s) => s.personId === personId);
    // Trimmed on the way in — a trailing space is invisible on screen and
    // makes an exact-match read of the stored value fail for no visible reason.
    expect(member).toMatchObject({
      emergencyContactName: "Marta Okonkwo (sister)",
      emergencyContactPhone: "+1-305-555-0114",
    });
  });

  it("clears both halves when both are emptied", async () => {
    const { db, shop } = ctx;
    const { personId } = await makeStaff(db, shop.id, ["captain"]);
    await setStaffEmergencyContact(db, {
      shopId: shop.id,
      personId,
      name: "Marta",
      phone: "+1-305-555-0114",
    });

    const cleared = await setStaffEmergencyContact(db, {
      shopId: shop.id,
      personId,
      name: "",
      phone: "",
    });

    expect(cleared).toEqual({ ok: true });
    const member = (await listShopStaff(db, shop.id)).find((s) => s.personId === personId);
    // Null, not "" — the manifest renders "Not on file" on absence, and an
    // empty string is a value that prints as a blank instead.
    expect(member).toMatchObject({
      emergencyContactName: null,
      emergencyContactPhone: null,
    });
  });

  it("refuses a name with no number, and a number with no name", async () => {
    // Half a contact is the shape that fails at the exact moment it is needed:
    // a name on the printed sheet with nothing to dial is worse than a blank,
    // because it reads as though somebody can be reached.
    const { db, shop } = ctx;
    const { personId } = await makeStaff(db, shop.id, ["captain"]);

    expect(
      await setStaffEmergencyContact(db, { shopId: shop.id, personId, name: "Marta", phone: " " }),
    ).toEqual({ ok: false, reason: "half_filled" });
    expect(
      await setStaffEmergencyContact(db, { shopId: shop.id, personId, name: "", phone: "+1-305" }),
    ).toEqual({ ok: false, reason: "half_filled" });

    const member = (await listShopStaff(db, shop.id)).find((s) => s.personId === personId);
    expect(member?.emergencyContactName).toBeNull();
  });

  it("refuses a person in another shop", async () => {
    // `people` is the only table here carrying a shop_id, and the action takes
    // a raw personId from a hidden form field — so this is the whole tenant
    // boundary for the write.
    const { db, shop } = ctx;
    seq += 1;
    const [other] = await db
      .insert(shops)
      .values({ name: "Other Shop", slug: `other-shop-${seq}`, timezone: "UTC" })
      .returning();
    if (!other) throw new Error("failed to insert shop");
    const { personId } = await makeStaff(db, other.id, ["captain"]);

    const result = await setStaffEmergencyContact(db, {
      shopId: shop.id,
      personId,
      name: "Marta",
      phone: "+1-305-555-0114",
    });

    expect(result).toEqual({ ok: false, reason: "not_found" });
    const member = (await listShopStaff(db, other.id)).find((s) => s.personId === personId);
    expect(member?.emergencyContactName).toBeNull();
  });

  it("refuses a person in this shop who holds no staff role", async () => {
    // The team page's subjects are staff. Without this the action is a
    // general-purpose writer for any `people` row in the shop — every diver
    // record included — reachable by editing one hidden field.
    const { db, shop } = ctx;
    const [diver] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Ana Diaz", email: "ana.diaz@example.com" })
      .returning();
    if (!diver) throw new Error("failed to insert diver");

    const result = await setStaffEmergencyContact(db, {
      shopId: shop.id,
      personId: diver.id,
      name: "Marta",
      phone: "+1-305-555-0114",
    });

    expect(result).toEqual({ ok: false, reason: "not_found" });
    const [row] = await db.select().from(people).where(eq(people.id, diver.id));
    expect(row?.emergencyContactName).toBeNull();
  });

  it("refuses a deleted person", async () => {
    const { db, shop } = ctx;
    const { personId } = await makeStaff(db, shop.id, ["captain"]);
    await db.update(people).set({ deletedAt: nowDate() }).where(eq(people.id, personId));

    expect(
      await setStaffEmergencyContact(db, {
        shopId: shop.id,
        personId,
        name: "Marta",
        phone: "+1-305-555-0114",
      }),
    ).toEqual({ ok: false, reason: "not_found" });
  });
});
