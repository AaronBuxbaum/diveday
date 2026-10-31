import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import { requireStaffSession } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";

/**
 * **`/shop`, the installed app's `start_url`** (src/app/manifest.ts; issue
 * #2342): a staffer lands on their own shop, anyone else on sign-in.
 *
 * The edge proxy (`src/proxy.ts`) is the fast path. It sends a visitor with no
 * session cookie to sign-in, and a staffer to their shop when its cookie cache
 * names the shop. The cache goes cold after five idle minutes, and then the
 * proxy lets the request through undecided. Before this handler there was
 * nothing here for it to reach, so the home-screen icon could open on a 404.
 *
 * Decided from the live session, as every staff surface is (ADR-0006):
 * `requireStaffSession()` re-reads the account and sends anyone who is not
 * live staff to sign-in. The shop is the session's own, read from the
 * database, so a renamed slug still lands.
 *
 * A Route Handler lets this response choose its destination from the live
 * session. Under `cacheComponents`, a redirect thrown from a page body answers
 * 200 and resolves in the streamed payload. Here it is a real 307, temporary
 * because where `/shop` leads depends on who is asking.
 */
export async function GET() {
  const session = await requireStaffSession();
  const shop = await getShopById(await getDb(), session.user.shopId);
  // The session's shop row is gone: there is no shop to open, the same answer
  // `requireShopSurface` gives.
  if (!shop) notFound();
  // A relative `Location` keeps the redirect on the host the visitor used.
  // `private, no-store`: the answer is this staffer's own shop, and no shared
  // cache may hand it to the next person who asks.
  return new Response(null, {
    status: 307,
    headers: { Location: shopPath(shop.slug), "Cache-Control": "private, no-store" },
  });
}
