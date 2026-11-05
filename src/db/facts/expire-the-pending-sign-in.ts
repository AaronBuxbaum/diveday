import { and, eq } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { accountSignInChallenges } from "@/db/schema";
import { APP_ORIGIN, publicAppUrl } from "@/lib/notifications";
import {
  hashPendingHandle,
  pendingCookie,
  readPendingHandle,
  signInOrigins,
} from "@/lib/pending-sign-in";
import { runtimeMode } from "@/lib/runtime-mode";
import { FactRefused } from "./refusal";

/**
 * **The caller's own sign-in challenge, expired** (`authChallengeExpired`): the
 * pending handle the browser holds in its cookie is found in this shop and
 * aged past its five minutes, so the code page shows its expired state. Only
 * the presented handle moves, and only inside this shop; a missing or tampered
 * handle is the one refusal. A private shop's fact.
 */
export async function expireThePendingSignIn(
  db: AppDb,
  shop: { id: string },
  headers: Headers,
  now: Date,
) {
  const cookie = pendingCookie(
    signInOrigins(publicAppUrl() ?? APP_ORIGIN, process.env)[0],
    runtimeMode().e2eHarness,
  );
  const handle = readPendingHandle(headers, cookie.name);
  if (!handle) throw new FactRefused("not_available", 404);
  const [row] = await db
    .update(accountSignInChallenges)
    .set({
      createdAt: new Date(now.getTime() - 301_000),
      expiresAt: new Date(now.getTime() - 1_000),
    })
    .where(
      and(
        eq(accountSignInChallenges.shopId, shop.id),
        eq(accountSignInChallenges.tokenHash, hashPendingHandle(handle)),
      ),
    )
    .returning({ id: accountSignInChallenges.id });
  if (!row) throw new FactRefused("not_available", 404);
}
