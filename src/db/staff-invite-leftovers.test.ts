import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { removeStaffMember, restoreStaffMember } from "../features/staff-accounts/store";
import { consumeAccountToken, issueAccountToken } from "./account-tokens";
import type { AppDb } from "./client";
import { people, personRoles, userAccounts } from "./schema";

/**
 * Leftovers of the invite hardening (issue #4013): which accounts a reset or verification link
 * spends on, and what an Undo does for a removed invitee who never accepted.
 */
const ctx = fileScopedShopContext();

let seq = 0;

async function makeStaff(db: AppDb, shopId: string, status: "invited" | "active" | "disabled") {
  seq += 1;
  const email = `leftover.${seq}@example.com`;
  const [person] = await db
    .insert(people)
    .values({ shopId, fullName: `Leftover ${seq}`, email })
    .returning();
  if (!person) throw new Error("failed to insert staff");
  await db.insert(personRoles).values({ personId: person.id, role: "instructor" });
  const [account] = await db
    .insert(userAccounts)
    .values({ personId: person.id, email, hashedPassword: "x", status })
    .returning();
  if (!account) throw new Error("failed to insert account");
  return { personId: person.id, userAccountId: account.id };
}

async function statusOf(db: AppDb, userAccountId: string) {
  const [row] = await db
    .select({ status: userAccounts.status })
    .from(userAccounts)
    .where(eq(userAccounts.id, userAccountId));
  return row?.status;
}

describe("which accounts a link spends on", () => {
  it("a password reset is spent on an active account only, never an invited one", async () => {
    const { db, shop } = ctx;
    const invited = await makeStaff(db, shop.id, "invited");
    const issued = await issueAccountToken(db, {
      userAccountId: invited.userAccountId,
      purpose: "password_reset",
    });
    expect(await consumeAccountToken(db, { token: issued.token, purpose: "password_reset" })).toBe(
      null,
    );

    const active = await makeStaff(db, shop.id, "active");
    const second = await issueAccountToken(db, {
      userAccountId: active.userAccountId,
      purpose: "password_reset",
    });
    expect(
      await consumeAccountToken(db, { token: second.token, purpose: "password_reset" }),
    ).toEqual({ userAccountId: active.userAccountId });
  });

  it("a verification link still works for an invited account", async () => {
    const { db, shop } = ctx;
    const invited = await makeStaff(db, shop.id, "invited");
    const issued = await issueAccountToken(db, {
      userAccountId: invited.userAccountId,
      purpose: "email_verification",
    });
    expect(
      await consumeAccountToken(db, { token: issued.token, purpose: "email_verification" }),
    ).toEqual({ userAccountId: invited.userAccountId });
  });
});

describe("restoreStaffMember", () => {
  it("brings a removed invitee back on the team but asks for a resent invite", async () => {
    const { db, shop } = ctx;
    const invitee = await makeStaff(db, shop.id, "invited");
    await removeStaffMember(db, { shopId: shop.id, ...invitee });

    const result = await restoreStaffMember(db, {
      shopId: shop.id,
      ...invitee,
      roles: ["instructor"],
    });

    expect(result).toEqual({ ok: true, resendInvite: true });
    expect(await statusOf(db, invitee.userAccountId)).toBe("invited");
    const roles = await db
      .select({ role: personRoles.role })
      .from(personRoles)
      .where(eq(personRoles.personId, invitee.personId));
    expect(roles.map((row) => row.role)).toEqual(["instructor"]);
  });

  it("re-enables a removed active member, with nothing to resend", async () => {
    const { db, shop } = ctx;
    const member = await makeStaff(db, shop.id, "active");
    await removeStaffMember(db, { shopId: shop.id, ...member });
    expect(await statusOf(db, member.userAccountId)).toBe("disabled");

    const result = await restoreStaffMember(db, {
      shopId: shop.id,
      ...member,
      roles: ["instructor"],
    });

    expect(result).toEqual({ ok: true, resendInvite: false });
    expect(await statusOf(db, member.userAccountId)).toBe("active");
  });

  it("refuses a person who is not on this shop's team, and changes nothing", async () => {
    const { db, shop } = ctx;
    const member = await makeStaff(db, shop.id, "active");

    const result = await restoreStaffMember(db, {
      shopId: "00000000-0000-4000-8000-000000000000",
      ...member,
      roles: ["owner"],
    });

    expect(result).toEqual({ ok: false, reason: "not_found" });
    const roles = await db
      .select({ role: personRoles.role })
      .from(personRoles)
      .where(eq(personRoles.personId, member.personId));
    expect(roles.map((row) => row.role)).toEqual(["instructor"]);
  });
});
