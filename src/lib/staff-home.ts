import { auth } from "./auth";
import { isStaff } from "./authz";
import { shopSlugFromStaffUrl } from "./public-routes";
import { shopPath } from "./staff-notices";

/**
 * **A staffer who misses inside `/shop/**` goes back to their day, never to
 * the sales site** (UX audit 2026-10-07, item 13). An unknown staff URL and
 * every `notFound()` a staff page throws both land on the root 404 page
 * (`src/app/not-found.tsx`), under the root layout where the shop's chrome
 * never runs, and the one door that page used to offer was `/`, DiveDay's
 * marketing homepage.
 *
 * The door is the reader's *own* shop, read off their session, never the slug
 * the URL claimed: a cross-tenant refusal is the commonest way here, and the
 * slug in that URL is the shop they were just refused. The path is only the
 * question of whether to ask (a staff URL at all), so a diver's dead link
 * pays no session read. A signed-in reader who is not staff gets DiveDay's
 * own refusal, as before; a stale staff session follows the door into
 * `requireStaffSession()`, which sends it to sign-in like any other.
 *
 * The session's slug is held to the slug charset on the way out, so a
 * malformed one costs the door rather than producing a wrong link.
 */
export async function staffHomeSlug(path: string | null): Promise<string | null> {
  if (!shopSlugFromStaffUrl(path)) return null;
  const session = await auth();
  if (!session?.user || !isStaff(session.user.roles)) return null;
  return shopSlugFromStaffUrl(shopPath(session.user.shopSlug));
}
