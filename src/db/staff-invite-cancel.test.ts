import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import {
  cancelStaffInvite,
  inviteStaffMember,
  listShopStaff,
  restoreStaffMember,
} from "../features/staff-accounts/store";
import { consumeAccountToken, issueAccountToken } from "./account-tokens";
import { userAccounts } from "./schema";

const ctx = fileScopedShopContext();

async function invite(email = "pending.invitee@example.com") {
  const { db, shop } = ctx;
  const result = await inviteStaffMember(db, {
    shopId: shop.id,
    fullName: "Pending Invitee",
    email,
    roles: ["crew"],
  });
  if (!result.ok) throw new Error("invite refused");
  return { personId: result.personId, userAccountId: result.userAccountId };
}

describe("cancelStaffInvite (issue #4013)", () => {
  it("takes a pending invitee off the team and kills their unspent link", async () => {
    const { db, shop } = ctx;
    const invitee = await invite();
    const issued = await issueAccountToken(db, {
      userAccountId: invitee.userAccountId,
      purpose: "invite",
    });

    expect(await cancelStaffInvite(db, { shopId: shop.id, ...invitee })).toEqual({ ok: true });

    const team = await listShopStaff(db, shop.id);
    expect(team.some((member) => member.personId === invitee.personId)).toBe(false);
    expect(await consumeAccountToken(db, { token: issued.token, purpose: "invite" })).toBeNull();
  });

  it("refuses someone who already joined: that is a removal, not a withdrawn invite", async () => {
    const { db, shop } = ctx;
    const invitee = await invite();
    await db
      .update(userAccounts)
      .set({ status: "active" })
      .where(eq(userAccounts.id, invitee.userAccountId));

    expect(await cancelStaffInvite(db, { shopId: shop.id, ...invitee })).toEqual({
      ok: false,
      reason: "not_found",
    });
    const team = await listShopStaff(db, shop.id);
    expect(team.some((member) => member.personId === invitee.personId)).toBe(true);
  });

  it("lets the same address be invited again, on the same account", async () => {
    const { db, shop } = ctx;
    const first = await invite();
    await cancelStaffInvite(db, { shopId: shop.id, ...first });

    const again = await inviteStaffMember(db, {
      shopId: shop.id,
      fullName: "Pending Invitee",
      email: "pending.invitee@example.com",
      roles: ["divemaster"],
    });

    expect(again).toEqual({ ok: true, ...first });
    const member = (await listShopStaff(db, shop.id)).find((m) => m.personId === first.personId);
    expect(member?.roles).toEqual(["divemaster"]);
    expect(member?.accountStatus).toBe("invited");
    await expect(
      issueAccountToken(db, { userAccountId: first.userAccountId, purpose: "invite" }),
    ).resolves.toBeTruthy();
  });

  it("still refuses an address that is on the team", async () => {
    const { db, shop } = ctx;
    await invite();
    expect(
      await inviteStaffMember(db, {
        shopId: shop.id,
        fullName: "Pending Invitee",
        email: "pending.invitee@example.com",
        roles: ["crew"],
      }),
    ).toEqual({ ok: false, reason: "already_on_team" });
  });

  it("is undone by restoring the roles, with a note to resend the invite", async () => {
    const { db, shop } = ctx;
    const invitee = await invite();
    await cancelStaffInvite(db, { shopId: shop.id, ...invitee });

    expect(await restoreStaffMember(db, { shopId: shop.id, ...invitee, roles: ["crew"] })).toEqual({
      ok: true,
      resendInvite: true,
    });
    const team = await listShopStaff(db, shop.id);
    expect(team.some((member) => member.personId === invitee.personId)).toBe(true);
  });
});
