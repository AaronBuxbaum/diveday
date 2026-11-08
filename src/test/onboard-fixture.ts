import { and, eq, isNotNull } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { capabilities } from "@/db/schema";
import { deleteDemoShopCascade } from "@/db/seed";

const KEY = Symbol.for("diveday.e2e.onboardFixtures");
function fixtures(): Map<string, string> {
  const holder = globalThis as { [KEY]?: Map<string, string> };
  holder[KEY] ??= new Map();
  return holder[KEY];
}

/** Only the test door's setupLink fact calls this, never ordinary setup-link issuance. */
export function holdOnboardFixture(token: string, setupRequestId: string): void {
  fixtures().set(token, setupRequestId);
}

/**
 * Release a real signup made through a setup link this test server minted.
 * The caller cannot nominate a shop: provenance in server memory and the
 * signup transaction's spentByShopId must agree. Ordinary real shops and
 * ordinary setup links are not fixtures, even with the harness bearer.
 */
export async function dropOnboardFixture(db: AppDb, token: string): Promise<boolean> {
  const setupRequestId = fixtures().get(token);
  if (!setupRequestId) return false;
  const [link] = await db
    .select({ shopId: capabilities.spentByShopId })
    .from(capabilities)
    .where(
      and(
        eq(capabilities.purpose, "shop_setup"),
        eq(capabilities.setupRequestId, setupRequestId),
        isNotNull(capabilities.usedAt),
        isNotNull(capabilities.spentByShopId),
      ),
    );
  const shopId = link?.shopId;
  if (shopId) {
    await db.transaction((tx) => deleteDemoShopCascade(tx, shopId));
  }
  // A failed cascade keeps the proof so teardown can be retried safely.
  fixtures().delete(token);
  return !!link?.shopId;
}
