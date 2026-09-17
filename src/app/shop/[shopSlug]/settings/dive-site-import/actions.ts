"use server";

import { getDb } from "@/db/client";
import { commitDiveSiteImport } from "@/db/dive-site-import";
import { canPersonImportShopData } from "@/db/import";
import { prepareDiveSiteImport } from "@/lib/dive-site-import";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";

/**
 * The same shape as the contacts and gear importers beside it, including the
 * permission re-check: the page gate is not the only thing standing in front of
 * a bulk write, because a server action is reachable without rendering the page
 * that draws its form.
 */
export async function restoreDiveSitesAction(formData: FormData) {
  const session = await requireStaffSession();
  const db = await getDb();
  const page = shopPath(session.user.shopSlug, "settings", "dive-site-import");
  if (!(await canPersonImportShopData(db, session.user.shopId, session.user.personId))) {
    const home = shopPath(session.user.shopSlug);
    revalidateAndRedirect(home, noticeUrl(home, "dive-site-import-not-authorized"));
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0)
    revalidateAndRedirect(page, noticeUrl(page, "import-empty"));
  const prepared = prepareDiveSiteImport(await file.text());
  // A fatal is the whole file refused, and each one has words of its own —
  // "a column I do not recognise" and "no name column" want different fixes.
  if (prepared.fatal) revalidateAndRedirect(page, noticeUrl(page, `import-${prepared.fatal}`));
  const summary = await commitDiveSiteImport(
    db,
    session.user.shopId,
    prepared,
    session.user.personId,
  );
  revalidateAndRedirect(
    page,
    noticeUrl(
      page,
      `imported-${summary.updated}-${summary.created}-${summary.deleted}-${summary.skipped.length}`,
    ),
  );
}
