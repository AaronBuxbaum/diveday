import { canPersonEditDiveSites } from "@/db/authz";
import { getDb } from "@/db/client";
import { revalidateAndRedirect } from "@/features/navigation";
import type { requireStaffSession } from "@/features/session";
import { shopPath } from "@/lib/staff-notices";

/**
 * **Editing the dive-site library is owner/manager work** (`canEditDiveSites`).
 * Every staff role reads a site and schedules a trip at it, so the doors a
 * crew member sees never offer an edit; this is the server's answer to a stale
 * tab or a forged post, which lands quietly back on the library with nothing
 * written, and no sentence to explain it.
 */
export async function requireSiteEditor(session: Awaited<ReturnType<typeof requireStaffSession>>) {
  const allowed = await canPersonEditDiveSites(
    await getDb(),
    session.user.shopId,
    session.user.personId,
  );
  if (!allowed) revalidateAndRedirect(shopPath(session.user.shopSlug, "dive-sites"));
}
