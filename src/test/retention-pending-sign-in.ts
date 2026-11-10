import { randomUUID } from "node:crypto";
import type { DbExecutor } from "@/db/client";
import { accountPasskeyChallenges, accountSignInChallenges } from "@/db/schema";

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

async function passkeyForRetention({ db }: Context, at: Date): Promise<string> {
  const [row] = await db
    .insert(accountPasskeyChallenges)
    .values({
      tokenHash: randomUUID(),
      challenge: randomUUID(),
      ceremony: "sign-in",
      origin: "https://diveday.app",
      rpId: "diveday.app",
      expiresAt: at,
    })
    .returning({ id: accountPasskeyChallenges.id });
  return row.id;
}

export const pendingProofRetentionFixtures = {
  account_sign_in_challenges: pendingSignInForRetention,
  account_passkey_challenges: passkeyForRetention,
};
