import type { DbExecutor } from "@/db/client";
import { getDb } from "@/db/client";
import { revalidateAndRedirect } from "@/lib/navigation";
import { noticeUrl, shopPath } from "@/lib/staff-notices";

/**
 * **A register's write gate** (issue #2659, glossary "Register and setting"):
 * each register (boats, trip tags) passes its own live-roles check, so a
 * demoted staffer loses it on their next request rather than at next sign-in.
 * A refusal goes to Settings, where the not-authorized notice is read, the way
 * every settings write has refused; the redirect throws, so a caller cannot
 * forget to act on it.
 */
export async function registerBlock(
  session: { user: { shopId: string; personId: string; shopSlug: string } },
  allowed: (db: DbExecutor, shopId: string, personId: string) => Promise<boolean>,
): Promise<void> {
  if (await allowed(await getDb(), session.user.shopId, session.user.personId)) return;
  const settings = shopPath(session.user.shopSlug, "settings");
  revalidateAndRedirect(settings, noticeUrl(settings, "not-authorized"));
}
