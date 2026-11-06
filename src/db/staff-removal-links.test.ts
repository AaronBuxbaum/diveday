import { and, eq, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Role } from "@/lib/authz";
import { fileScopedShopContext } from "@/test/db";
import {
  checkAccountToken,
  consumeAccountToken,
  DisabledAccountError,
  issueAccountToken,
} from "./account-tokens";
import type { AppDb } from "./client";
import { capabilities, people, personRoles, userAccounts } from "./schema";
import { removeStaffMember, setStaffAccountStatus } from "./staff-accounts";

const ctx = fileScopedShopContext();
let seq = 0;

async function makeStaff(
  db: AppDb,
  shopId: string,
  roles: Role[],
): Promise<{ personId: string; userAccountId: string }> {
  seq += 1;
  const email = `removal.links.${seq}@example.com`;
  const [person] = await db
    .insert(people)
    .values({ shopId, fullName: `Leaver ${seq}`, email })
    .returning();
  if (!person) throw new Error("failed to insert staff");
  await db.insert(personRoles).values(roles.map((role) => ({ personId: person.id, role })));
  const [account] = await db
    .insert(userAccounts)
    .values({ personId: person.id, email, hashedPassword: "x", status: "active" })
    .returning();
  if (!account) throw new Error("failed to insert account");
  return { personId: person.id, userAccountId: account.id };
}

/** The seeded shop has its own owner; a last-owner case must strip it first. */
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

describe("removing a staffer withdraws their account links (issue #3989)", () => {
  it("withdraws unspent reset, invite and verification links, so a re-enable revives none", async () => {
    // Spending a token refuses a disabled account, which is the only thing that kept these dead.
    // A plain re-enable (the Undo banner) lifted that refusal and a link mailed before the removal
    // worked again.
    const { db, shop } = ctx;
    const staff = await makeStaff(db, shop.id, ["crew"]);
    const other = await makeStaff(db, shop.id, ["crew"]);
    const reset = await issueAccountToken(db, {
      userAccountId: staff.userAccountId,
      purpose: "password_reset",
    });
    const invite = await issueAccountToken(db, {
      userAccountId: staff.userAccountId,
      purpose: "invite",
    });
    const verify = await issueAccountToken(db, {
      userAccountId: staff.userAccountId,
      purpose: "email_verification",
    });
    const othersReset = await issueAccountToken(db, {
      userAccountId: other.userAccountId,
      purpose: "password_reset",
    });

    await removeStaffMember(db, {
      shopId: shop.id,
      personId: staff.personId,
      userAccountId: staff.userAccountId,
    });
    await setStaffAccountStatus(db, {
      shopId: shop.id,
      personId: staff.personId,
      userAccountId: staff.userAccountId,
      status: "active",
    });

    for (const [purpose, issued] of [
      ["password_reset", reset],
      ["invite", invite],
      ["email_verification", verify],
    ] as const) {
      expect(await checkAccountToken(db, { token: issued.token, purpose })).toBeNull();
      expect(await consumeAccountToken(db, { token: issued.token, purpose })).toBeNull();
    }
    expect(
      await checkAccountToken(db, { token: othersReset.token, purpose: "password_reset" }),
    ).toEqual({ userAccountId: other.userAccountId });
  });

  it("mints no link for a removed account, so one issued just after cannot be revived", async () => {
    // A forgot-password or resend that read the account before the removal committed mints after it.
    const { db, shop } = ctx;
    const staff = await makeStaff(db, shop.id, ["crew"]);
    await removeStaffMember(db, {
      shopId: shop.id,
      personId: staff.personId,
      userAccountId: staff.userAccountId,
    });
    await expect(
      issueAccountToken(db, { userAccountId: staff.userAccountId, purpose: "invite" }),
    ).rejects.toBeInstanceOf(DisabledAccountError);
    expect(
      await db
        .select()
        .from(capabilities)
        .where(eq(capabilities.userAccountId, staff.userAccountId)),
    ).toHaveLength(0);
  });

  it("withdraws nothing when the removal is refused, and keeps the withdrawn rows on record", async () => {
    const { db, shop } = ctx;
    const owner = await makeStaff(db, shop.id, ["owner"]);
    await stripOtherOwners(db, shop.id, owner.personId);
    const kept = await issueAccountToken(db, {
      userAccountId: owner.userAccountId,
      purpose: "password_reset",
    });
    const refused = await removeStaffMember(db, {
      shopId: shop.id,
      personId: owner.personId,
      userAccountId: owner.userAccountId,
    });
    expect(refused).toMatchObject({ ok: false, reason: "last_owner" });
    expect(
      await checkAccountToken(db, { token: kept.token, purpose: "password_reset" }),
    ).not.toBeNull();

    const staff = await makeStaff(db, shop.id, ["crew"]);
    await issueAccountToken(db, { userAccountId: staff.userAccountId, purpose: "password_reset" });
    await removeStaffMember(db, {
      shopId: shop.id,
      personId: staff.personId,
      userAccountId: staff.userAccountId,
    });
    const rows = await db
      .select({ revokedAt: capabilities.revokedAt, usedAt: capabilities.usedAt })
      .from(capabilities)
      .where(eq(capabilities.userAccountId, staff.userAccountId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.revokedAt).toBeInstanceOf(Date);
    expect(rows[0]?.usedAt).toBeNull();
  });

  it("keeps a temporarily disabled account's links for its own re-enable", async () => {
    const { db, shop } = ctx;
    const staff = await makeStaff(db, shop.id, ["crew"]);
    const reset = await issueAccountToken(db, {
      userAccountId: staff.userAccountId,
      purpose: "password_reset",
    });
    for (const status of ["disabled", "active"] as const) {
      await setStaffAccountStatus(db, {
        shopId: shop.id,
        personId: staff.personId,
        userAccountId: staff.userAccountId,
        status,
      });
    }
    expect(await checkAccountToken(db, { token: reset.token, purpose: "password_reset" })).toEqual({
      userAccountId: staff.userAccountId,
    });
  });
});
