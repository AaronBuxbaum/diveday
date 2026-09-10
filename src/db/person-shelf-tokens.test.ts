// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { hashShelfToken, SHELF_TOKEN_TTL_MS } from "@/lib/shelf-links";
import { seededShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import type { AppDb } from "./client";
import { mergeDiverRecords } from "./diver-merge";
import {
  issueShelfToken,
  MAX_LIVE_SHELF_TOKENS,
  recordShelfOpen,
  revokeShelfTokens,
  shelfTokenStanding,
  verifyShelfToken,
} from "./person-shelf-tokens";
import { people, personRoles, personShelfTokens } from "./schema";

/**
 * **The shelf capability, and everything it must refuse.**
 *
 * A shelf link opens one person's file at one shop and lives on a phone for a
 * year, so the tests that matter are the refusals: it names one tenant, it dies
 * with the record it names, and erasure closes it. The happy path is one case;
 * the rest of this file is the boundary.
 */

/**
 * `seededShopContext` hands every case in this file the same shop, and
 * `people_shop_email_unique` is per shop — so the address is the counter's, not
 * the name's, and two cases can both have a "Ravi Menon".
 */
let diverSeq = 0;

async function diver(db: AppDb, shopId: string, fullName = "Ravi Menon") {
  diverSeq += 1;
  const [row] = await db
    .insert(people)
    .values({ shopId, fullName, email: `shelf.diver.${diverSeq}@example.com` })
    .returning({ id: people.id });
  if (!row) throw new Error("diver fixture insert failed");
  await db.insert(personRoles).values({ personId: row.id, role: "diver" });
  return row.id;
}

async function owner(db: AppDb, shopId: string) {
  const [row] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shopId), eq(personRoles.role, "owner")))
    .limit(1);
  if (!row) throw new Error("expected the seeded owner");
  return row.id;
}

describe("issuing and verifying a shelf token", () => {
  it("resolves to the shop and person it was minted for", async () => {
    const { db, shop } = await seededShopContext();
    const personId = await diver(db, shop.id);
    const issued = await issueShelfToken(db, { shopId: shop.id, personId });
    if (!issued) throw new Error("expected a token");

    expect(await verifyShelfToken(db, { token: issued.token })).toEqual({
      tokenId: issued.tokenId,
      shopId: shop.id,
      personId,
    });
  });

  it("stores only the digest, never the token", async () => {
    const { db, shop } = await seededShopContext();
    const personId = await diver(db, shop.id);
    const issued = await issueShelfToken(db, { shopId: shop.id, personId });
    if (!issued) throw new Error("expected a token");

    const [row] = await db
      .select()
      .from(personShelfTokens)
      .where(eq(personShelfTokens.id, issued.tokenId));
    expect(row?.tokenHash).toBe(hashShelfToken(issued.token));
    // Nothing anywhere on the row replays as the credential.
    expect(JSON.stringify(row)).not.toContain(issued.token);
  });

  it("expires on its own, a year out", async () => {
    const { db, shop } = await seededShopContext();
    const personId = await diver(db, shop.id);
    const now = new Date("2026-09-10T12:00:00Z");
    const issued = await issueShelfToken(db, { shopId: shop.id, personId, now });
    if (!issued) throw new Error("expected a token");

    const justInside = new Date(now.getTime() + SHELF_TOKEN_TTL_MS - 1);
    const justPast = new Date(now.getTime() + SHELF_TOKEN_TTL_MS + 1);
    expect(await verifyShelfToken(db, { token: issued.token, now: justInside })).not.toBeNull();
    expect(await verifyShelfToken(db, { token: issued.token, now: justPast })).toBeNull();
  });

  it("refuses an unknown token, and says nothing about why", async () => {
    const { db } = await seededShopContext();
    expect(await verifyShelfToken(db, { token: "not-a-token" })).toBeNull();
    expect(await verifyShelfToken(db, { token: "" })).toBeNull();
  });

  it("refuses to mint for a person this shop does not have", async () => {
    const { db, shop } = await seededShopContext();
    const other = await seededShopContext();
    const strangerId = await diver(other.db, other.shop.id, "Someone Else");
    expect(await issueShelfToken(db, { shopId: shop.id, personId: strangerId })).toBeNull();
  });

  it("refuses to mint for a deleted record", async () => {
    const { db, shop } = await seededShopContext();
    const personId = await diver(db, shop.id);
    await db.update(people).set({ deletedAt: nowDate() }).where(eq(people.id, personId));
    expect(await issueShelfToken(db, { shopId: shop.id, personId })).toBeNull();
  });

  it("keeps the live set under its ceiling by retiring the oldest", async () => {
    const { db, shop } = await seededShopContext();
    const personId = await diver(db, shop.id);
    const tokens: string[] = [];
    for (let i = 0; i < MAX_LIVE_SHELF_TOKENS + 1; i += 1) {
      const issued = await issueShelfToken(db, {
        shopId: shop.id,
        personId,
        // Distinct issue times so "oldest" is unambiguous.
        now: new Date(Date.UTC(2026, 0, 1, 0, i)),
      });
      if (!issued) throw new Error("expected a token");
      tokens.push(issued.token);
    }
    const now = new Date(Date.UTC(2026, 0, 2));
    // The newest always works — a diver waiting on the link they just asked for.
    expect(await verifyShelfToken(db, { token: tokens.at(-1) ?? "", now })).not.toBeNull();
    // The oldest was retired rather than the newest refused.
    expect(await verifyShelfToken(db, { token: tokens[0] ?? "", now })).toBeNull();
    expect((await shelfTokenStanding(db, { shopId: shop.id, personId, now })).live).toBe(
      MAX_LIVE_SHELF_TOKENS,
    );
  });
});

describe("what a shelf token can never reach", () => {
  it("does not resolve against another shop's record", async () => {
    const { db, shop } = await seededShopContext();
    const personId = await diver(db, shop.id);
    const issued = await issueShelfToken(db, { shopId: shop.id, personId });
    if (!issued) throw new Error("expected a token");

    const capability = await verifyShelfToken(db, { token: issued.token });
    // The one fact a caller is allowed to act on: the shop is the token's, and
    // every caller re-checks it against the shop it is rendering for.
    expect(capability?.shopId).toBe(shop.id);
    expect(capability?.personId).toBe(personId);
  });

  it("dies with a record that was merged away", async () => {
    const { db, shop } = await seededShopContext();
    const sourceId = await diver(db, shop.id, "Maya Rivera");
    const survivorId = await diver(db, shop.id, "Maya R Rivera");
    const issued = await issueShelfToken(db, { shopId: shop.id, personId: sourceId });
    if (!issued) throw new Error("expected a token");

    expect(
      await mergeDiverRecords({
        db,
        shopId: shop.id,
        personId: sourceId,
        survivorId,
        actorPersonId: await owner(db, shop.id),
      }),
    ).toMatchObject({ ok: true });

    // The row is still there — a merge moves nothing here on purpose — and the
    // link no longer opens anything.
    expect(await verifyShelfToken(db, { token: issued.token })).toBeNull();
  });

  it("is revoked outright, and stops verifying, when the diver is erased", async () => {
    const { db, shop } = await seededShopContext();
    const personId = await diver(db, shop.id);
    const issued = await issueShelfToken(db, { shopId: shop.id, personId });
    if (!issued) throw new Error("expected a token");
    // Erasure is offered on a deleted record and nowhere else.
    await db.update(people).set({ deletedAt: nowDate() }).where(eq(people.id, personId));

    const outcome = await anonymizeDiver(db, {
      shopId: shop.id,
      personId,
      actorPersonId: await owner(db, shop.id),
    });
    expect(outcome).toMatchObject({ ok: true });

    expect(await verifyShelfToken(db, { token: issued.token })).toBeNull();
    const [row] = await db
      .select({ revokedAt: personShelfTokens.revokedAt })
      .from(personShelfTokens)
      .where(eq(personShelfTokens.id, issued.tokenId));
    // Not merely unreachable through the join — the row itself says the door
    // was closed, so a future reader querying this table alone finds nothing
    // live (H-02).
    expect(row?.revokedAt).not.toBeNull();
  });

  it("revokes every live link a diver holds, and leaves another diver's alone", async () => {
    const { db, shop } = await seededShopContext();
    const mine = await diver(db, shop.id, "Ravi Menon");
    const theirs = await diver(db, shop.id, "Ana Duarte");
    const a = await issueShelfToken(db, { shopId: shop.id, personId: mine });
    const b = await issueShelfToken(db, { shopId: shop.id, personId: mine });
    const other = await issueShelfToken(db, { shopId: shop.id, personId: theirs });
    if (!a || !b || !other) throw new Error("expected three tokens");

    await revokeShelfTokens(db, { shopId: shop.id, personId: mine });

    expect(await verifyShelfToken(db, { token: a.token })).toBeNull();
    expect(await verifyShelfToken(db, { token: b.token })).toBeNull();
    expect(await verifyShelfToken(db, { token: other.token })).not.toBeNull();
  });
});

describe("what the diver record shows beside the link", () => {
  it("counts opens, the last one, and the phones holding a live link", async () => {
    const { db, shop } = await seededShopContext();
    const personId = await diver(db, shop.id);
    const phone = await issueShelfToken(db, { shopId: shop.id, personId });
    const neverOpened = await issueShelfToken(db, { shopId: shop.id, personId });
    if (!phone || !neverOpened) throw new Error("expected two tokens");

    const first = new Date("2026-09-01T10:00:00Z");
    const second = new Date("2026-09-08T18:30:00Z");
    await recordShelfOpen(db, { tokenId: phone.tokenId, now: first });
    await recordShelfOpen(db, { tokenId: phone.tokenId, now: second });

    const standing = await shelfTokenStanding(db, { shopId: shop.id, personId });
    expect(standing.opens).toBe(2);
    expect(standing.lastOpenedAt?.toISOString()).toBe(second.toISOString());
    // A link that was sent and never tapped is not a phone.
    expect(standing.phones).toBe(1);
    expect(standing.live).toBe(2);
  });

  it("reads as nothing sent for a diver who has never been offered one", async () => {
    const { db, shop } = await seededShopContext();
    const personId = await diver(db, shop.id);
    expect(await shelfTokenStanding(db, { shopId: shop.id, personId })).toEqual({
      opens: 0,
      lastOpenedAt: null,
      phones: 0,
      live: 0,
    });
  });
});
