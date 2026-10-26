import { randomUUID } from "node:crypto";
import type { DbExecutor } from "@/db/client";
import { accountSignInChallenges, accountTokens } from "@/db/schema";

type Context = { db: DbExecutor; shop: { id: string }; owner?: { id: string } };

export async function pendingSignInForRetention(
  { db, shop, owner }: Context,
  at: Date,
): Promise<string> {
  const [row] = await db
    .insert(accountSignInChallenges)
    .values({
      shopId: shop.id,
      userAccountId: owner?.id ?? "",
      tokenHash: randomUUID(),
      expiresAt: at,
      createdAt: new Date(at.getTime() - 300_000),
    })
    .returning({ id: accountSignInChallenges.id });
  return row.id;
}

export async function accountTokenForRetention({ db, owner }: Context, at: Date): Promise<string> {
  const [row] = await db
    .insert(accountTokens)
    .values({
      userAccountId: owner?.id ?? "",
      purpose: "password_reset",
      tokenHash: randomUUID(),
      expiresAt: at,
    })
    .returning({ id: accountTokens.id });
  return row.id;
}
