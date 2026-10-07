import { randomBytes } from "node:crypto";
import { expect, it } from "vitest";
import { describePostgres, postgresTestDb } from "@/test/postgres";
import type { AppDb, DbExecutor } from "./client";
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
 * outcome but not that the *advisory locks* produced it. Here the first
 * Connect holds its claim mid-signup (its "Meta calls" are a promise this test
 * resolves), and a second Connect on another connection is refused at once as
 * `busy`, without waiting and without registering a number. Refusing rather
 * than waiting is what keeps N concurrent posts from holding N pooled
 * connections (security review). Without the locks both reach the register
 * step.
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

const wabaName = () => `waba_${randomBytes(4).toString("hex")}`;

/** A claim whose Meta calls finish when the test says so. */
function heldClaim(db: AppDb, shopId: string, wabaId: string, registered: string[]) {
  let finish: () => void = () => undefined;
  const metaDone = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let entered: () => void = () => undefined;
  const inside = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const result = claimWhatsAppWaba(db, { shopId, wabaId }, async (tx: DbExecutor) => {
    registered.push(`${shopId}:${wabaId}`);
    entered();
    await metaDone;
    return connectShopWhatsAppAccount(tx, connectInput(shopId, wabaId), { key });
  });
  return { result, inside, finish };
}

describePostgres("claimWhatsAppWaba under real concurrency", () => {
  it("refuses a second shop's Connect on the same WABA at once, without registering", async () => {
    const pg = await postgresTestDb();
    const first = await shop(pg.db, "first");
    const second = await shop(pg.db, "second");
    const wabaId = wabaName();
    const registered: string[] = [];

    const winner = heldClaim(pg.connect(), first, wabaId, registered);
    await winner.inside;

    const loser = await claimWhatsAppWaba(
      pg.connect(),
      { shopId: second, wabaId },
      async (tx: DbExecutor) => {
        registered.push(`${second}:${wabaId}`);
        return connectShopWhatsAppAccount(tx, connectInput(second, wabaId), { key });
      },
    );
    expect(loser).toEqual({ status: "busy" });

    winner.finish();
    expect((await winner.result).status).toBe("claimed");
    expect(registered).toEqual([`${first}:${wabaId}`]);
    expect(await shopIdForWhatsAppWaba(pg.db, wabaId)).toBe(first);

    // Pressing Connect again once the first has landed reads its row.
    const again = await claimWhatsAppWaba(pg.connect(), { shopId: second, wabaId }, async () => {
      registered.push("again");
    });
    expect(again).toEqual({ status: "held_elsewhere" });
    expect(registered).toHaveLength(1);
  });

  it("refuses one shop's second Connect on a different WABA while the first is in flight", async () => {
    const pg = await postgresTestDb();
    const only = await shop(pg.db, "only");
    const registered: string[] = [];

    const first = heldClaim(pg.connect(), only, wabaName(), registered);
    await first.inside;

    const second = await claimWhatsAppWaba(
      pg.connect(),
      { shopId: only, wabaId: wabaName() },
      async () => {
        registered.push("second");
      },
    );
    expect(second).toEqual({ status: "busy" });

    first.finish();
    expect((await first.result).status).toBe("claimed");
    expect(registered).toHaveLength(1);
  });
});
