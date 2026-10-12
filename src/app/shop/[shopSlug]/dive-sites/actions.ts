"use server";

import { getDb } from "@/db/client";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { importTemplateFromForm } from "./site-forms";

/**
 * Copy a DiveDay catalog template into the session's own shop and open the new
 * site. A form that names no template in the catalog lands back on the library
 * with nothing written. It was an inline closure in `page.tsx` until the
 * 2026-10-11 review moved it here to be testable; the way back comes from the
 * session, never from the page's URL.
 */
export async function importDiveSiteTemplateAction(formData: FormData) {
  const active = await requireStaffSession();
  const back = shopPath(active.user.shopSlug, "dive-sites");
  const site = await importTemplateFromForm(await getDb(), active.user.shopId, formData);
  if (!site) revalidateAndRedirect(back);
  revalidateAndRedirect(back, noticeUrl(`${back}/${site.id}`, "imported"));
}
