import { cookies } from "next/headers";
import type { DbExecutor } from "@/db/client";
import {
  type DiverSession,
  endDiverSession,
  issueDiverSignIn,
  readDiverSession,
} from "@/db/diver-sign-in";
import { sendNotification } from "@/db/notifications";
import { DIVER_SESSION_TTL_MS } from "@/lib/capabilities";
import { type NotificationProvider, publicAppUrl, recipientLocale } from "@/lib/notifications";
import { diverSignInLinkPath, publicSchedulePath } from "@/lib/public-routes";
import { runtimeMode } from "@/lib/runtime-mode";

/**
 * **A diver's own sign-in** (ADR 20261125-diver-sign-in): the emailed link, the
 * session cookie it leaves, and who that cookie names on a shop's pages.
 *
 * The cookie is its own name and scoped to one shop's `/s/<slug>` path, so it
 * never rides a `/shop/**` request and never reaches another shop's pages; the
 * staff session (better-auth) neither reads nor writes it.
 */

/** The cookie's name; its path, not its name, says which shop it is for. */
export const DIVER_SESSION_COOKIE = "diveday_diver";

type Shop = { id: string; slug: string; name: string; timezone: string; defaultLocale: string };

/**
 * Sends a sign-in link to the shop's person at this address, if there is one.
 * Nothing comes back: the page answers the same whether a mail went or not.
 */
export async function sendDiverSignInMail(
  db: DbExecutor,
  input: { shop: Shop; email: string },
  provider?: NotificationProvider,
): Promise<void> {
  const origin = publicAppUrl();
  if (!origin) return;
  const issued = await issueDiverSignIn(db, { shopId: input.shop.id, email: input.email });
  if (!issued) return;
  await sendNotification(
    db,
    {
      kind: "diver_sign_in_request",
      personId: issued.person.id,
      tokenId: issued.tokenId,
      shopId: input.shop.id,
      to: issued.person.email,
      locale: recipientLocale(issued.person.locale, input.shop.defaultLocale),
      diverName: issued.person.fullName,
      shopName: input.shop.name,
      signInUrl: new URL(diverSignInLinkPath(issued.token), `${origin}/`).toString(),
      expiresAt: issued.expiresAt,
      timezone: input.shop.timezone,
    },
    provider,
  ).catch(() => ({ status: "failed" as const }));
}

/** The cookie a fresh session is kept in: HttpOnly, this shop's pages only. */
export function diverSessionCookie(shopSlug: string, token: string) {
  return {
    name: DIVER_SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: runtimeMode().secureSessionCookies,
    path: publicSchedulePath(shopSlug),
    maxAge: Math.floor(DIVER_SESSION_TTL_MS / 1000),
  };
}

/** The signed-in diver on this shop's pages, or null. */
export async function currentDiver(db: DbExecutor, shopId: string): Promise<DiverSession | null> {
  const token = (await cookies()).get(DIVER_SESSION_COOKIE)?.value;
  return readDiverSession(db, { shopId, token });
}

/** The raw session token this request carries, for a writer that re-proves it under its locks. */
export async function currentDiverToken(): Promise<string | null> {
  return (await cookies()).get(DIVER_SESSION_COOKIE)?.value ?? null;
}

/** Sign out of this shop's pages: the session opens nothing and the cookie goes. */
export async function signOutDiver(db: DbExecutor, shopSlug: string): Promise<void> {
  const jar = await cookies();
  await endDiverSession(db, { token: jar.get(DIVER_SESSION_COOKIE)?.value });
  jar.set({ ...diverSessionCookie(shopSlug, ""), maxAge: 0 });
}
