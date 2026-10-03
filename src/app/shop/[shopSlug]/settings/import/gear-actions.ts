"use server";

import { getDb } from "@/db/client";
import { commitGearImport } from "@/db/gear-import";
import { canPersonImportShopData } from "@/db/import";
import { prepareGearImport } from "@/lib/gear-import";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";

/**
 * Moved from the gear register (`src/app/shop/[shopSlug]/gear/actions.ts`) to
 * Settings' "Data" group, beside the sibling contacts CSV
 * importer this mirrors. That move is also a permission tightening: the
 * register never gated this bulk write, and the sibling importer's own action
 * re-checks the same live, database-backed permission rather than trusting
 * the page gate alone — the same defense-in-depth reasoning applies here
 * (`src/app/shop/[shopSlug]/settings/import/actions.ts`).
 */
export async function importGearServiceHistoryAction(formData: FormData) {
  const session = await requireStaffSession();
  const db = await getDb();
  // One import page with a tab per kind (Aaron, 2026-10-03); the notice comes
  // back on this tab.
  const page = shopPath(session.user.shopSlug, "settings", "import");
  const tab = `${page}?what=gear`;
  if (!(await canPersonImportShopData(db, session.user.shopId, session.user.personId))) {
    const home = shopPath(session.user.shopSlug);
    revalidateAndRedirect(home, noticeUrl(home, "gear-import-not-authorized"));
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0)
    revalidateAndRedirect(page, noticeUrl(tab, "import-empty"));
  const prepared = prepareGearImport(await file.text());
  if (prepared.fatal) revalidateAndRedirect(page, noticeUrl(tab, `import-${prepared.fatal}`));
  const summary = await commitGearImport(db, session.user.shopId, prepared, session.user.personId);
  revalidateAndRedirect(
    page,
    noticeUrl(
      tab,
      `imported-${summary.eventsAdded}-${summary.unitsCreated}-${summary.eventsSkipped}-${summary.assignmentsAdded}-${summary.assignmentsSkipped + summary.assignmentsUnmatched}`,
    ),
  );
}
