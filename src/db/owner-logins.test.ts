import { ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { ownerLogins, roleLogins } from "./owner-logins";
import { people, personRoles, shops, userAccounts } from "./schema";

const ctx = fileScopedShopContext();

async function addStaff(
  label: string,
  roles: Array<"owner" | "manager">,
  options: {
    shopId?: string;
    status?: "active" | "disabled";
    deleted?: boolean;
    anonymized?: boolean;
  } = {},
) {
  const { db, shop } = ctx;
  const [person] = await db
    .insert(people)
    .values({
      shopId: options.shopId ?? shop.id,
      fullName: label,
      deletedAt: options.deleted ? new Date("2026-01-01T00:00:00Z") : null,
      anonymizedAt: options.anonymized ? new Date("2026-01-01T00:00:00Z") : null,
    })
    .returning({ id: people.id });
  if (!person) throw new Error("staff person insert failed");
  await db.insert(personRoles).values(roles.map((role) => ({ personId: person.id, role })));
  await db.insert(userAccounts).values({
    personId: person.id,
    email: `${label}@example.test`,
    status: options.status ?? "active",
  });
  return { personId: person.id, email: `${label}@example.test` };
}

describe("roleLogins", () => {
  it("keeps owner-only recipients and selects each active owner-or-manager once", async () => {
    const { db, shop } = ctx;
    const owner = await addStaff("owner-only", ["owner"]);
    const manager = await addStaff("manager-only", ["manager"]);
    const both = await addStaff("both-roles", ["owner", "manager"]);
    const otherShop = await db
      .select({ id: shops.id })
      .from(shops)
      .where(ne(shops.id, shop.id))
      .limit(1);
    if (!otherShop[0]) throw new Error("second seeded shop missing");
    const foreignOwner = await addStaff("foreign-owner", ["owner"], { shopId: otherShop[0].id });

    expect((await ownerLogins(db, shop.id)).map((row) => row.email)).toContain(owner.email);
    expect((await ownerLogins(db, shop.id)).map((row) => row.email)).not.toContain(manager.email);
    expect((await roleLogins(db, shop.id, "manager")).map((row) => row.email)).toContain(
      manager.email,
    );
    expect((await roleLogins(db, shop.id, "manager")).map((row) => row.email)).not.toContain(
      owner.email,
    );

    const recipients = await roleLogins(db, shop.id, ["owner", "manager"]);
    const recipientEmails = recipients.map((row) => row.email);
    expect(recipientEmails).toContain(owner.email);
    expect(recipientEmails).toContain(manager.email);
    expect(recipientEmails).toContain(both.email);
    expect(recipientEmails).not.toContain(foreignOwner.email);
    expect(recipients.filter((row) => row.personId === both.personId)).toHaveLength(1);
    expect(new Set(recipients.map((row) => row.personId)).size).toBe(recipients.length);
  });

  it("excludes inactive accounts, deleted people, anonymized people and foreign shops", async () => {
    const { db, shop } = ctx;
    const foreignShop = await db
      .select({ id: shops.id })
      .from(shops)
      .where(ne(shops.id, shop.id))
      .limit(1);
    if (!foreignShop[0]) throw new Error("second seeded shop missing");
    const inactive = await addStaff("inactive", ["manager"], { status: "disabled" });
    const deleted = await addStaff("deleted", ["manager"], { deleted: true });
    const anonymized = await addStaff("anonymized", ["manager"], {
      deleted: true,
      anonymized: true,
    });
    const elsewhere = await addStaff("elsewhere", ["manager"], { shopId: foreignShop[0].id });

    const recipients = await roleLogins(db, shop.id, ["owner", "manager"]);
    const recipientEmails = recipients.map((row) => row.email);
    expect(recipientEmails).not.toContain(inactive.email);
    expect(recipientEmails).not.toContain(deleted.email);
    expect(recipientEmails).not.toContain(anonymized.email);
    expect(recipientEmails).not.toContain(elsewhere.email);
  });
});
