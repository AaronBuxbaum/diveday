import { eq, inArray } from "drizzle-orm";
import { expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { pendingSignInForRetention } from "@/test/retention-account-tokens";
import { PRUNE_ARMS, pruneExpiredRecords } from "./retention";
import { people, userAccounts } from "./schema";

const ctx = fileScopedShopContext();

it("prunes pending proof one millisecond past expiry while keeping the boundary and live proof", async () => {
  const { db, shop } = ctx;
  const [owner] = await db
    .select({ id: userAccounts.id })
    .from(userAccounts)
    .innerJoin(people, eq(people.id, userAccounts.personId))
    .where(eq(people.shopId, shop.id))
    .limit(1);
  if (!owner) throw new Error("seeded account missing");
  const fixture = { db, shop, owner };
  const now = new Date("2026-08-03T12:34:56.789Z");
  const expired = await pendingSignInForRetention(fixture, new Date(now.getTime() - 1));
  const boundary = await pendingSignInForRetention(fixture, now);
  const live = await pendingSignInForRetention(fixture, new Date(now.getTime() + 1));

  await pruneExpiredRecords(db, { now });

  const arm = PRUNE_ARMS.account_sign_in_challenges;
  const left = await db
    .select({ id: arm.id })
    .from(arm.from)
    .where(inArray(arm.id, [expired, boundary, live]));
  expect(left.map((row) => row.id).sort()).toEqual([boundary, live].sort());
});
