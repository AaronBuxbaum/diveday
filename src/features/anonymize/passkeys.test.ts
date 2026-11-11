import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  accountPasskeyChallenges,
  accountPasskeys,
  accountSessions,
  people,
  personRoles,
  userAccounts,
} from "@/db/schema";
import { nowDate, nowMs } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { anonymizeDiver } from "./store";

const ctx = fileScopedShopContext();

async function loginRows(personId: string, email: string) {
  const { db, shop } = ctx;
  const [account] = await db
    .insert(userAccounts)
    .values({ personId, email, hashedPassword: "test-only-unused-hash", status: "active" })
    .returning();
  const [session] = await db
    .insert(accountSessions)
    .values({
      userAccountId: account.id,
      personId,
      shopId: shop.id,
      shopSlug: shop.slug,
      name: "Former captain",
      roles: ["captain"],
      token: randomUUID(),
      expiresAt: new Date(nowMs() + 86_400_000),
    })
    .returning();
  const keys = await db
    .insert(accountPasskeys)
    .values(
      [null, nowDate()].map((deletedAt) => ({
        shopId: shop.id,
        userAccountId: account.id,
        credentialId: randomUUID(),
        publicKey: "test-only-public-material",
        name: "Rafaela’s travel key",
        deletedAt,
      })),
    )
    .returning();
  const [challenge] = await db
    .insert(accountPasskeyChallenges)
    .values({
      shopId: shop.id,
      userAccountId: account.id,
      accountSessionId: session.id,
      tokenHash: randomUUID(),
      challenge: randomUUID(),
      ceremony: "register",
      origin: "https://diveday.app",
      rpId: "diveday.app",
      expiresAt: new Date(nowMs() + 300_000),
    })
    .returning();
  return { account, session, keys, challenge };
}

async function ownerId() {
  const { db, shop } = ctx;
  const [owner] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")));
  return owner.id;
}

describe("passkeys when a former staff member is erased", () => {
  it("destroys live and deleted keys and account-bound ceremonies without touching other accounts or anonymous machinery", async () => {
    const { db, shop } = ctx;
    const [former, other] = await db
      .insert(people)
      .values([
        { shopId: shop.id, fullName: "Rafaela Costa" },
        { shopId: shop.id, fullName: "A different staff member" },
      ])
      .returning();
    await db.insert(personRoles).values([
      { personId: former.id, role: "captain" },
      { personId: former.id, role: "diver" },
      { personId: other.id, role: "captain" },
    ]);
    const target = await loginRows(former.id, "former@example.test");
    const control = await loginRows(other.id, "other@example.test");
    // Staff-only credentials can outlive a person's last staff role.
    await db
      .delete(personRoles)
      .where(and(eq(personRoles.personId, former.id), eq(personRoles.role, "captain")));
    const [anonymous] = await db
      .insert(accountPasskeyChallenges)
      .values({
        tokenHash: randomUUID(),
        challenge: randomUUID(),
        ceremony: "sign-in",
        origin: "https://diveday.app",
        rpId: "diveday.app",
        expiresAt: new Date(nowMs() + 300_000),
      })
      .returning();

    const result = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: former.id,
      actorPersonId: await ownerId(),
    });
    expect(result.ok).toBe(true);
    expect(
      await db
        .select()
        .from(accountPasskeys)
        .where(eq(accountPasskeys.userAccountId, target.account.id)),
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(accountPasskeyChallenges)
        .where(eq(accountPasskeyChallenges.userAccountId, target.account.id)),
    ).toEqual([]);
    const [redactedAccount] = await db
      .select()
      .from(userAccounts)
      .where(eq(userAccounts.id, target.account.id));
    // Erasure retains/redacts this row, so its credential FK cannot do the cleanup.
    expect(redactedAccount.status).toBe("disabled");
    expect(redactedAccount.email).not.toBe(target.account.email);
    expect(
      await db
        .select()
        .from(accountPasskeys)
        .where(eq(accountPasskeys.userAccountId, control.account.id)),
    ).toEqual(control.keys);
    expect(
      await db
        .select()
        .from(accountPasskeyChallenges)
        .where(eq(accountPasskeyChallenges.userAccountId, control.account.id)),
    ).toEqual([control.challenge]);
    expect(
      await db
        .select()
        .from(accountPasskeyChallenges)
        .where(eq(accountPasskeyChallenges.id, anonymous.id)),
    ).toEqual([anonymous]);
  });

  it("still refuses a current staff erasure and leaves their keys and ceremonies intact", async () => {
    const { db, shop } = ctx;
    const [staff] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Current captain" })
      .returning();
    await db.insert(personRoles).values({ personId: staff.id, role: "captain" });
    const target = await loginRows(staff.id, "captain@example.test");
    expect(
      await anonymizeDiver(db, {
        shopId: shop.id,
        personId: staff.id,
        actorPersonId: await ownerId(),
      }),
    ).toEqual({ ok: false, reason: "staff_member" });
    expect(
      await db
        .select()
        .from(accountPasskeys)
        .where(eq(accountPasskeys.userAccountId, target.account.id)),
    ).toEqual(target.keys);
    expect(
      await db
        .select()
        .from(accountPasskeyChallenges)
        .where(eq(accountPasskeyChallenges.userAccountId, target.account.id)),
    ).toEqual([target.challenge]);
  });
});
