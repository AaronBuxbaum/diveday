import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { removeStaffMember } from "../features/staff-accounts/store";
import { issueAccountToken } from "./account-tokens";
import { capabilities, people, personRoles, shops, userAccounts } from "./schema";
import { claimStaffInvite } from "./user-accounts";

/**
 * An invitee accepting while an owner removes them, on two real connections (issue #4013).
 * Accepting used to lock the invite's capability row and then the account; a removal locks the
 * account and then withdraws the capability, so each could wait on the other and Postgres killed
 * one with `40P01`, which reached the invitee as a 500. Both now take the account first.
 *
 * The gate parks both contenders on the account row. It makes them simultaneous and, with the old
 * order, makes the cross wait certain; the assertion is that neither call throws and the account
 * ends in a state one of the two orders allows (docs/engineering/testing.md, "Reading a race test
 * correctly").
 */

describePostgres("accepting an invite while the invitee is removed", () => {
  it("never deadlocks, and leaves either an accepted invite or a withdrawn one", async () => {
    const pg = await postgresTestDb();
    const suffix = randomBytes(4).toString("hex");
    const [shop] = await pg.db
      .insert(shops)
      .values({ name: `Invite ${suffix}`, slug: `invite-${suffix}`, timezone: "UTC" })
      .returning();
    if (!shop) throw new Error("shop insert returned no row");
    const email = `invitee-${suffix}@example.com`;
    const [person] = await pg.db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Invitee", email })
      .returning();
    if (!person) throw new Error("person insert returned no row");
    await pg.db.insert(personRoles).values({ personId: person.id, role: "instructor" });
    const [account] = await pg.db
      .insert(userAccounts)
      .values({ personId: person.id, email, hashedPassword: "x", status: "invited" })
      .returning();
    if (!account) throw new Error("account insert returned no row");
    const issued = await issueAccountToken(pg.db, {
      userAccountId: account.id,
      purpose: "invite",
    });

    const gate = await holdRowLock(
      pg,
      sql`select id from user_accounts where id = ${account.id} for update`,
    );
    // The removal queues for the account first, so it is the one granted it when the gate opens;
    // the acceptance then needs the account while the removal needs the invite.
    const removing = removeStaffMember(pg.connect(), {
      shopId: shop.id,
      personId: person.id,
      userAccountId: account.id,
    });
    await waitForLockWaiters(pg.db, 1);
    const accepting = claimStaffInvite(pg.connect(), {
      token: issued.token,
      hashedPassword: "hashed",
    });
    await waitForLockWaiters(pg.db, 2);
    await gate.release();
    const [claimed, removed] = await Promise.all([accepting, removing]);

    expect(removed).toEqual({ ok: true });
    const [after] = await pg.db
      .select({ status: userAccounts.status })
      .from(userAccounts)
      .where(eq(userAccounts.id, account.id));
    if (claimed) {
      // Accepted first: the removal then disabled the active account.
      expect(claimed).toEqual({ userAccountId: account.id });
      expect(after?.status).toBe("disabled");
    } else {
      // Removed first: the invite was withdrawn, and the account never became active.
      expect(after?.status).toBe("invited");
      const [token] = await pg.db
        .select({ revokedAt: capabilities.revokedAt })
        .from(capabilities)
        .where(eq(capabilities.id, issued.tokenId));
      expect(token?.revokedAt).not.toBeNull();
    }
  });
});
