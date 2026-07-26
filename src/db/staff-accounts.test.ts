// @vitest-environment node
import { and, eq, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Role } from "@/lib/authz";
import { seededShopContext } from "@/test/db";
import type { AppDb } from "./client";
import { people, personRoles, shops, userAccounts } from "./schema";
import {
  inviteStaffMember,
  listShopStaff,
  removeStaffMember,
  setStaffAccountStatus,
  setStaffRoles,
} from "./staff-accounts";

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

/**
 * The seeded demo shop already has its own owner (the seed's dev login), so a
 * test proving "last owner" behavior must first strip every *other* owner —
 * otherwise the freshly-made test owner is never actually the shop's only one.
 */
async function stripOtherOwners(db: AppDb, shopId: string, keepPersonId: string): Promise<void> {
  const others = await db
    .select({ personId: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(
      and(eq(people.shopId, shopId), eq(personRoles.role, "owner"), ne(people.id, keepPersonId)),
    );
  for (const other of others) {
    await db
      .delete(personRoles)
      .where(and(eq(personRoles.personId, other.personId), eq(personRoles.role, "owner")));
  }
}

async function makeOtherShop(db: AppDb): Promise<string> {
  seq += 1;
  const [shop] = await db
    .insert(shops)
    .values({ name: `Other Shop ${seq}`, slug: `other-shop-${seq}`, timezone: "UTC" })
    .returning();
  if (!shop) throw new Error("failed to insert shop");
  return shop.id;
}

describe("inviteStaffMember", () => {
  it("creates a new person, roles, and an invited account when no person matches the email", async () => {
    const { db, shop } = await seededShopContext();
    const result = await inviteStaffMember(db, {
      shopId: shop.id,
      fullName: "Nadia Reyes",
      email: "Nadia@Example.com",
      roles: ["instructor"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    const [account] = await db
      .select()
      .from(userAccounts)
      .where(eq(userAccounts.id, result.userAccountId));
    expect(account?.status).toBe("invited");
    expect(account?.email).toBe("nadia@example.com");

    const roles = await db
      .select({ role: personRoles.role })
      .from(personRoles)
      .where(eq(personRoles.personId, result.personId));
    expect(roles.map((r) => r.role)).toEqual(["instructor"]);
  });

  it("reuses an existing active diver's person record instead of forking a new one", async () => {
    const { db, shop } = await seededShopContext();
    const [diver] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Theo Marsh", email: "theo@example.com" })
      .returning();
    if (!diver) throw new Error("failed to insert diver");
    await db.insert(personRoles).values({ personId: diver.id, role: "diver" });

    const result = await inviteStaffMember(db, {
      shopId: shop.id,
      fullName: "Theo Marsh",
      email: "theo@example.com",
      roles: ["captain"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.personId).toBe(diver.id);

    const roles = (
      await db
        .select({ role: personRoles.role })
        .from(personRoles)
        .where(eq(personRoles.personId, diver.id))
    ).map((r) => r.role);
    expect(roles.sort()).toEqual(["captain", "diver"]);
  });

  it("refuses already_on_team when the matched person already has an account", async () => {
    const { db, shop } = await seededShopContext();
    const existing = await makeStaff(db, shop.id, ["crew"]);
    const [person] = await db.select().from(people).where(eq(people.id, existing.personId));
    if (!person?.email) throw new Error("expected seeded email");

    const result = await inviteStaffMember(db, {
      shopId: shop.id,
      fullName: person.fullName,
      email: person.email,
      roles: ["captain"],
    });
    expect(result).toEqual({ ok: false, reason: "already_on_team" });
  });

  it("refuses email_registered_elsewhere when the email belongs to a different shop's account", async () => {
    const { db, shop } = await seededShopContext();
    const otherShopId = await makeOtherShop(db);
    await makeStaff(db, otherShopId, ["owner"]);
    // makeStaff's account email is staff.<seq>@example.com — reuse that seq for the invite.
    const [account] = await db
      .select({ email: userAccounts.email })
      .from(userAccounts)
      .innerJoin(people, eq(people.id, userAccounts.personId))
      .where(eq(people.shopId, otherShopId));
    if (!account) throw new Error("expected seeded account");

    const result = await inviteStaffMember(db, {
      shopId: shop.id,
      fullName: "Cross Shop",
      email: account.email,
      roles: ["crew"],
    });
    expect(result).toEqual({ ok: false, reason: "email_registered_elsewhere" });
  });
});

describe("setStaffRoles", () => {
  it("replaces the staff-role subset without touching a diver role", async () => {
    const { db, shop } = await seededShopContext();
    const staff = await makeStaff(db, shop.id, ["crew"]);
    await db.insert(personRoles).values({ personId: staff.personId, role: "diver" });

    const result = await setStaffRoles(db, {
      shopId: shop.id,
      personId: staff.personId,
      roles: ["divemaster", "instructor"],
    });
    expect(result).toEqual({ ok: true });

    const roles = (
      await db
        .select({ role: personRoles.role })
        .from(personRoles)
        .where(eq(personRoles.personId, staff.personId))
    ).map((r) => r.role);
    expect(roles.sort()).toEqual(["divemaster", "diver", "instructor"]);
  });

  it("refuses to strip the shop's last owner", async () => {
    const { db, shop } = await seededShopContext();
    const owner = await makeStaff(db, shop.id, ["owner"]);
    await stripOtherOwners(db, shop.id, owner.personId);

    const result = await setStaffRoles(db, {
      shopId: shop.id,
      personId: owner.personId,
      roles: ["manager"],
    });
    expect(result).toEqual({ ok: false, reason: "last_owner" });

    const roles = (
      await db
        .select({ role: personRoles.role })
        .from(personRoles)
        .where(eq(personRoles.personId, owner.personId))
    ).map((r) => r.role);
    expect(roles).toEqual(["owner"]);
  });

  it("allows demoting an owner when a second owner remains", async () => {
    const { db, shop } = await seededShopContext();
    const first = await makeStaff(db, shop.id, ["owner"]);
    await makeStaff(db, shop.id, ["owner"]);

    const result = await setStaffRoles(db, {
      shopId: shop.id,
      personId: first.personId,
      roles: ["manager"],
    });
    expect(result).toEqual({ ok: true });
  });
});

describe("setStaffAccountStatus", () => {
  it("refuses to disable the shop's last owner", async () => {
    const { db, shop } = await seededShopContext();
    const owner = await makeStaff(db, shop.id, ["owner"]);
    await stripOtherOwners(db, shop.id, owner.personId);

    const result = await setStaffAccountStatus(db, {
      shopId: shop.id,
      personId: owner.personId,
      userAccountId: owner.userAccountId,
      status: "disabled",
    });
    expect(result).toEqual({ ok: false, reason: "last_owner" });

    const [account] = await db
      .select()
      .from(userAccounts)
      .where(eq(userAccounts.id, owner.userAccountId));
    expect(account?.status).toBe("active");
  });

  it("disables a non-owner's account", async () => {
    const { db, shop } = await seededShopContext();
    const crew = await makeStaff(db, shop.id, ["crew"]);

    const result = await setStaffAccountStatus(db, {
      shopId: shop.id,
      personId: crew.personId,
      userAccountId: crew.userAccountId,
      status: "disabled",
    });
    expect(result).toEqual({ ok: true });

    const [account] = await db
      .select()
      .from(userAccounts)
      .where(eq(userAccounts.id, crew.userAccountId));
    expect(account?.status).toBe("disabled");
  });
});

describe("removeStaffMember", () => {
  it("strips staff roles and disables the account, leaving a diver role in place", async () => {
    const { db, shop } = await seededShopContext();
    const staff = await makeStaff(db, shop.id, ["crew"]);
    await db.insert(personRoles).values({ personId: staff.personId, role: "diver" });

    const result = await removeStaffMember(db, {
      shopId: shop.id,
      personId: staff.personId,
      userAccountId: staff.userAccountId,
    });
    expect(result).toEqual({ ok: true });

    const roles = (
      await db
        .select({ role: personRoles.role })
        .from(personRoles)
        .where(eq(personRoles.personId, staff.personId))
    ).map((r) => r.role);
    expect(roles).toEqual(["diver"]);

    const [account] = await db
      .select()
      .from(userAccounts)
      .where(eq(userAccounts.id, staff.userAccountId));
    expect(account?.status).toBe("disabled");
  });

  it("refuses to remove the shop's last owner", async () => {
    const { db, shop } = await seededShopContext();
    const owner = await makeStaff(db, shop.id, ["owner"]);
    await stripOtherOwners(db, shop.id, owner.personId);

    const result = await removeStaffMember(db, {
      shopId: shop.id,
      personId: owner.personId,
      userAccountId: owner.userAccountId,
    });
    expect(result).toEqual({ ok: false, reason: "last_owner" });
  });
});

describe("tenant isolation (security review finding, 20260726-staff-invite-accounts)", () => {
  it("setStaffRoles refuses a personId that belongs to a different shop", async () => {
    const { db, shop } = await seededShopContext();
    const otherShopId = await makeOtherShop(db);
    const outsider = await makeStaff(db, otherShopId, ["crew"]);

    const result = await setStaffRoles(db, {
      shopId: shop.id,
      personId: outsider.personId,
      roles: ["owner"],
    });
    expect(result).toEqual({ ok: false, reason: "not_found" });

    const roles = (
      await db
        .select({ role: personRoles.role })
        .from(personRoles)
        .where(eq(personRoles.personId, outsider.personId))
    ).map((r) => r.role);
    expect(roles).toEqual(["crew"]);
  });

  it("setStaffAccountStatus refuses a personId/userAccountId pair from a different shop", async () => {
    const { db, shop } = await seededShopContext();
    const otherShopId = await makeOtherShop(db);
    const outsider = await makeStaff(db, otherShopId, ["crew"]);

    const result = await setStaffAccountStatus(db, {
      shopId: shop.id,
      personId: outsider.personId,
      userAccountId: outsider.userAccountId,
      status: "disabled",
    });
    expect(result).toEqual({ ok: false, reason: "not_found" });

    const [account] = await db
      .select()
      .from(userAccounts)
      .where(eq(userAccounts.id, outsider.userAccountId));
    expect(account?.status).toBe("active");
  });

  it("setStaffAccountStatus refuses a userAccountId that doesn't belong to the given personId", async () => {
    const { db, shop } = await seededShopContext();
    const a = await makeStaff(db, shop.id, ["crew"]);
    const b = await makeStaff(db, shop.id, ["crew"]);

    // a's personId paired with b's userAccountId — the two must belong to
    // the same person, not merely the same shop.
    const result = await setStaffAccountStatus(db, {
      shopId: shop.id,
      personId: a.personId,
      userAccountId: b.userAccountId,
      status: "disabled",
    });
    expect(result).toEqual({ ok: false, reason: "not_found" });

    const [account] = await db
      .select()
      .from(userAccounts)
      .where(eq(userAccounts.id, b.userAccountId));
    expect(account?.status).toBe("active");
  });

  it("removeStaffMember refuses a personId/userAccountId pair from a different shop", async () => {
    const { db, shop } = await seededShopContext();
    const otherShopId = await makeOtherShop(db);
    const outsider = await makeStaff(db, otherShopId, ["crew"]);

    const result = await removeStaffMember(db, {
      shopId: shop.id,
      personId: outsider.personId,
      userAccountId: outsider.userAccountId,
    });
    expect(result).toEqual({ ok: false, reason: "not_found" });

    const roles = (
      await db
        .select({ role: personRoles.role })
        .from(personRoles)
        .where(eq(personRoles.personId, outsider.personId))
    ).map((r) => r.role);
    expect(roles).toEqual(["crew"]);
    const [account] = await db
      .select()
      .from(userAccounts)
      .where(eq(userAccounts.id, outsider.userAccountId));
    expect(account?.status).toBe("active");
  });
});

describe("listShopStaff", () => {
  it("aggregates each staff person's roles once, sorted by name, excluding divers-only", async () => {
    const { db, shop } = await seededShopContext();
    const zed = await makeStaff(db, shop.id, ["instructor", "divemaster"]);
    const [diverOnly] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Diver Only", email: "diver-only@example.com" })
      .returning();
    if (!diverOnly) throw new Error("failed to insert diver");
    await db.insert(personRoles).values({ personId: diverOnly.id, role: "diver" });

    const staff = await listShopStaff(db, shop.id);
    const zedRow = staff.find((member) => member.personId === zed.personId);
    expect(zedRow?.roles.sort()).toEqual(["divemaster", "instructor"]);
    expect(staff.some((member) => member.personId === diverOnly.id)).toBe(false);

    const names = staff.map((member) => member.fullName);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});
