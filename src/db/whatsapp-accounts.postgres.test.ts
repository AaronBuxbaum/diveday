import { randomBytes } from "node:crypto";
import { expect, it } from "vitest";
import { describePostgres, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import type { AppDb } from "./client";
import { shops } from "./schema";
import {
  claimWhatsAppWaba,
  connectShopWhatsAppAccount,
  shopIdForWhatsAppWaba,
} from "./whatsapp-accounts";

/**
 * The WhatsApp Connect race (issue #1769, H-83), on two real connections.
 *
 * PGlite is single-connection, so `whatsapp-accounts.test.ts` can show the
 * outcome but not that the *advisory lock* is what produced it. Here the first
 * Connect holds the lock mid-signup (its "Meta call" is a promise this test
 * resolves), the second is provably parked on the lock (`waitForLockWaiters`),
 * and the assertion is the one that matters: the second never registers a
 * number. Without the lock both reach the register step.
 */

const key = randomBytes(32);

async function shop(db: AppDb, slug: string) {
  const [row] = await db
    .insert(shops)
    .values({ name: slug, slug: `${slug}-${randomBytes(4).toString("hex")}`, timezone: "UTC" })
    .returning();
  if (!row) throw new Error("shop insert returned no row");
  return row.id;
}

function connectInput(shopId: string, wabaId: string) {
  return {
    shopId,
    phoneNumberId: `${randomBytes(4).readUInt32BE()}`,
    accessToken: "EAAG-token",
    templateName: "diveday_courtesy_update",
    templateLanguage: "en_US",
    wabaId,
  };
}

describePostgres("claimWhatsAppWaba under real concurrency", () => {
  it("parks the second Connect on the lock and refuses it without registering", async () => {
    const pg = await postgresTestDb();
    const first = await shop(pg.db, "first");
    const second = await shop(pg.db, "second");
    const wabaId = `waba_${randomBytes(4).toString("hex")}`;
    const registered: string[] = [];

    let finishMeta: () => void = () => undefined;
    const metaDone = new Promise<void>((resolve) => {
      finishMeta = resolve;
    });
    let firstInside: () => void = () => undefined;
    const firstHoldsLock = new Promise<void>((resolve) => {
      firstInside = resolve;
    });

    const winner = claimWhatsAppWaba(pg.connect(), { shopId: first, wabaId }, async (tx) => {
      registered.push(first);
      firstInside();
      await metaDone;
      return connectShopWhatsAppAccount(tx, connectInput(first, wabaId), { key });
    });
    await firstHoldsLock;

    const loser = claimWhatsAppWaba(pg.connect(), { shopId: second, wabaId }, async (tx) => {
      registered.push(second);
      return connectShopWhatsAppAccount(tx, connectInput(second, wabaId), { key });
    });
    // Setup, not the assertion: proves the two met on the lock rather than
    // running one after the other by luck.
    await waitForLockWaiters(pg.db, 1);
    finishMeta();

    const [won, lost] = await Promise.all([winner, loser]);
    expect(won.status).toBe("claimed");
    expect(lost).toEqual({ status: "held_elsewhere" });
    expect(registered).toEqual([first]);
    expect(await shopIdForWhatsAppWaba(pg.db, wabaId)).toBe(first);
  });
});
