import { randomBytes } from "node:crypto";
import { expect, it } from "vitest";
import { describePostgres, postgresTestDb } from "@/test/postgres";
import type { AppDb, DbExecutor } from "./client";
import { shops } from "./schema";
import {
  claimWhatsAppNumber,
  connectShopWhatsAppAccount,
  shopIdForWhatsAppEvent,
} from "./whatsapp-accounts";

/**
 * The WhatsApp Connect race (issues #1769 and #1767, H-20260916-may-dive-chain-share), on two real connections.
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

function connectInput(shopId: string, wabaId: string, phoneNumberId: string) {
  return {
    shopId,
    phoneNumberId,
    accessToken: "EAAG-token",
    templateName: "diveday_courtesy_update",
    templateLanguage: "en_US",
    wabaId,
  };
}

const wabaName = () => `waba_${randomBytes(4).toString("hex")}`;
const numberName = () => `${randomBytes(4).readUInt32BE()}`;

type Claim = { shopId: string; wabaId: string; phoneNumberId: string };

/** A claim whose Meta calls finish when the test says so. */
function heldClaim(db: AppDb, claim: Claim, registered: string[]) {
  let finish: () => void = () => undefined;
  const metaDone = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let entered: () => void = () => undefined;
  const inside = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const result = claimWhatsAppNumber(db, claim, async (tx: DbExecutor) => {
    registered.push(`${claim.shopId}:${claim.phoneNumberId}`);
    entered();
    await metaDone;
    return connectShopWhatsAppAccount(
      tx,
      connectInput(claim.shopId, claim.wabaId, claim.phoneNumberId),
      { key },
    );
  });
  return { result, inside, finish };
}

describePostgres("claimWhatsAppNumber under real concurrency", () => {
  it("refuses a second shop's Connect on the same number at once, without registering", async () => {
    const pg = await postgresTestDb();
    const first = await shop(pg.db, "first");
    const second = await shop(pg.db, "second");
    const wabaId = wabaName();
    const phoneNumberId = numberName();
    const registered: string[] = [];

    const winner = heldClaim(pg.connect(), { shopId: first, wabaId, phoneNumberId }, registered);
    await winner.inside;

    const loser = await claimWhatsAppNumber(
      pg.connect(),
      { shopId: second, wabaId, phoneNumberId },
      async (tx: DbExecutor) => {
        registered.push(`${second}:${phoneNumberId}`);
        return connectShopWhatsAppAccount(tx, connectInput(second, wabaId, phoneNumberId), {
          key,
        });
      },
    );
    expect(loser).toEqual({ status: "busy" });

    winner.finish();
    expect((await winner.result).status).toBe("claimed");
    expect(registered).toEqual([`${first}:${phoneNumberId}`]);
    expect(await shopIdForWhatsAppEvent(pg.db, { phoneNumberId, wabaId })).toBe(first);

    // Pressing Connect again once the first has landed reads its row.
    const again = await claimWhatsAppNumber(
      pg.connect(),
      { shopId: second, wabaId, phoneNumberId },
      async () => {
        registered.push("again");
      },
    );
    expect(again).toEqual({ status: "held_elsewhere" });
    expect(registered).toHaveLength(1);

    // A number of its own under the same WABA is the chain's ordinary shape (H-20260916-may-dive-chain-share).
    const ownNumber = numberName();
    const sibling = await claimWhatsAppNumber(
      pg.connect(),
      { shopId: second, wabaId, phoneNumberId: ownNumber },
      (tx: DbExecutor) =>
        connectShopWhatsAppAccount(tx, connectInput(second, wabaId, ownNumber), { key }),
    );
    expect(sibling.status === "claimed" && sibling.value.status).toBe("connected");
    expect(await shopIdForWhatsAppEvent(pg.db, { phoneNumberId: ownNumber, wabaId })).toBe(second);
  });

  it("refuses one shop's second Connect on a different number while the first is in flight", async () => {
    const pg = await postgresTestDb();
    const only = await shop(pg.db, "only");
    const registered: string[] = [];

    const first = heldClaim(
      pg.connect(),
      { shopId: only, wabaId: wabaName(), phoneNumberId: numberName() },
      registered,
    );
    await first.inside;

    const second = await claimWhatsAppNumber(
      pg.connect(),
      { shopId: only, wabaId: wabaName(), phoneNumberId: numberName() },
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
