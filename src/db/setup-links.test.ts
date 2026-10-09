import { describe, expect, it } from "vitest";
import { hashAccountToken } from "@/lib/account-tokens";
import { SETUP_LINK_TTL_MS, setupLinkPath } from "@/lib/setup-links";
import { unseededTestDb } from "@/test/db";
import { deleteSetupRequestsByEmail, recordSetupRequest } from "./funnel";
import { shopSetupLinks, shops } from "./schema";
import { issueSetupLink, openSetupLink, recordSetupLinkShop, spendSetupLink } from "./setup-links";

const NOW = new Date("2026-10-09T12:00:00Z");

async function requestedLink(db: Awaited<ReturnType<typeof unseededTestDb>>) {
  const request = await recordSetupRequest(db, {
    shopName: "Reef Line Divers",
    region: "Key Largo",
    runsBoat: true,
    currentSystem: "paper",
    contactName: "Ana Ruiz",
    email: "ana@reefline.example",
    phone: null,
    source: "pricing",
    locale: "en-US",
  });
  return { request, link: await issueSetupLink(db, { setupRequestId: request.id, now: NOW }) };
}

describe("a setup link (ADR 20261009-single-use-setup-links)", () => {
  it("is stored only as a hash, and expires two weeks after it is minted", async () => {
    const db = await unseededTestDb();
    const { link } = await requestedLink(db);
    const [row] = await db.select().from(shopSetupLinks);
    expect(row?.tokenHash).toBe(hashAccountToken(link.token));
    expect(JSON.stringify(row)).not.toContain(link.token);
    expect(link.expiresAt.getTime() - NOW.getTime()).toBe(SETUP_LINK_TTL_MS);
    expect(setupLinkPath(link.token)).toBe(`/onboard?setup=${link.token}`);
  });

  it("opens the form with the request's own answers", async () => {
    const db = await unseededTestDb();
    const { link } = await requestedLink(db);
    expect(await openSetupLink(db, link.token, NOW)).toEqual({
      shopName: "Reef Line Divers",
      contactName: "Ana Ruiz",
      email: "ana@reefline.example",
    });
  });

  it("opens one shop: the first spend wins and every later one, and the page, says no", async () => {
    const db = await unseededTestDb();
    const { link } = await requestedLink(db);
    const [first, second] = await Promise.all([
      spendSetupLink(db, link.token, NOW),
      spendSetupLink(db, link.token, NOW),
    ]);
    expect([first, second].sort()).toEqual([false, true]);
    expect(await spendSetupLink(db, link.token, NOW)).toBe(false);
    expect(await openSetupLink(db, link.token, NOW)).toBeNull();
  });

  it("stays unspent when the transaction that spent it rolls back", async () => {
    const db = await unseededTestDb();
    const { link } = await requestedLink(db);
    await db
      .transaction(async (tx) => {
        expect(await spendSetupLink(tx, link.token, NOW)).toBe(true);
        tx.rollback();
      })
      .catch(() => undefined);
    expect(await openSetupLink(db, link.token, NOW)).not.toBeNull();
  });

  it("opens nothing at or after its expiry", async () => {
    const db = await unseededTestDb();
    const { link } = await requestedLink(db);
    expect(await openSetupLink(db, link.token, link.expiresAt)).toBeNull();
    expect(await spendSetupLink(db, link.token, link.expiresAt)).toBe(false);
    const justBefore = new Date(link.expiresAt.getTime() - 1);
    expect(await openSetupLink(db, link.token, justBefore)).not.toBeNull();
  });

  it("refuses an unknown token, a near miss, and anything that is not one string", async () => {
    const db = await unseededTestDb();
    const { link } = await requestedLink(db);
    const nearMiss = `${link.token.slice(0, -1)}${link.token.endsWith("A") ? "B" : "A"}`;
    for (const candidate of [
      nearMiss,
      "A".repeat(43),
      link.token.slice(1),
      `${link.token} `,
      "",
      undefined,
      null,
      [link.token],
      // The old standing key's shape: a link is never a key.
      "diveday-dev-setup-key-not-for-production",
    ]) {
      expect(await openSetupLink(db, candidate, NOW)).toBeNull();
      expect(await spendSetupLink(db, candidate, NOW)).toBe(false);
    }
    expect(await openSetupLink(db, link.token, NOW)).not.toBeNull();
  });

  it("goes with its request when the requester asks to be forgotten", async () => {
    const db = await unseededTestDb();
    const { link } = await requestedLink(db);
    await deleteSetupRequestsByEmail(db, "ana@reefline.example");
    expect(await db.select().from(shopSetupLinks)).toEqual([]);
    expect(await openSetupLink(db, link.token, NOW)).toBeNull();
  });

  it("names the shop it opened, and forgets it when that shop is deleted", async () => {
    const db = await unseededTestDb();
    const { link } = await requestedLink(db);
    const [shop] = await db
      .insert(shops)
      .values({ name: "Reef Line Divers", slug: "reef-line-divers", timezone: "America/New_York" })
      .returning({ id: shops.id });
    if (!shop) throw new Error("expected a shop");
    expect(await spendSetupLink(db, link.token, NOW)).toBe(true);
    await recordSetupLinkShop(db, link.token, shop.id);
    const [row] = await db.select().from(shopSetupLinks);
    expect(row?.spentByShopId).toBe(shop.id);

    const { eq } = await import("drizzle-orm");
    await db.delete(shops).where(eq(shops.id, shop.id));
    const [after] = await db.select().from(shopSetupLinks);
    expect(after?.spentByShopId).toBeNull();
    expect(after?.spentAt).not.toBeNull();
  });
});
