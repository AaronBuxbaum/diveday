"use server";

import { getDb } from "@/db/client";
import { commitDiveSiteImport } from "@/db/dive-site-import";
import { canPersonImportShopData } from "@/db/import";
import {
  isDiveSiteCreaturesCsv,
  prepareDiveSiteCreaturesImport,
  prepareDiveSiteImport,
} from "@/lib/dive-site-import";
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
  // One import page with a tab per kind (Aaron, 2026-10-03); the notice comes
  // back on this tab.
  const page = shopPath(session.user.shopSlug, "settings", "import");
  const tab = `${page}?what=dive-sites`;
  if (!(await canPersonImportShopData(db, session.user.shopId, session.user.personId))) {
    const home = shopPath(session.user.shopSlug);
    revalidateAndRedirect(home, noticeUrl(home, "dive-site-import-not-authorized"));
  }

  // **One upload, up to two files** (issue #1841): the sites, and the field
  // guide beside them. Told apart by their headers rather than their names, so
  // a shop that renamed a file is not refused for it; anything other than one
  // sites file and at most one creatures file is refused before a row is read.
  const files = formData
    .getAll("file")
    .filter((file): file is File => file instanceof File && file.size > 0);
  if (files.length === 0) revalidateAndRedirect(page, noticeUrl(tab, "import-empty"));
  if (files.length > 2) revalidateAndRedirect(page, noticeUrl(tab, "import-wrong-files"));
  const texts = await Promise.all(files.map((file) => file.text()));
  const creatureTexts = texts.filter(isDiveSiteCreaturesCsv);
  const siteTexts = texts.filter((text) => !isDiveSiteCreaturesCsv(text));
  const [sitesCsv] = siteTexts;
  if (siteTexts.length !== 1 || sitesCsv === undefined || creatureTexts.length > 1)
    revalidateAndRedirect(page, noticeUrl(tab, "import-wrong-files"));
  const prepared = prepareDiveSiteImport(sitesCsv);
  // A fatal is the whole file refused, and each one has words of its own —
  // "a column I do not recognise" and "no name column" want different fixes.
  if (prepared.fatal) revalidateAndRedirect(page, noticeUrl(tab, `import-${prepared.fatal}`));
  const [creaturesCsv] = creatureTexts;
  const creatures =
    creaturesCsv === undefined ? undefined : prepareDiveSiteCreaturesImport(creaturesCsv);
  // Refused whole, before the sites are written: half a restore — the sites
  // back and their guides not — is the outcome the shop could not tell apart
  // from a finished one.
  if (creatures?.fatal) revalidateAndRedirect(page, noticeUrl(tab, "import-creatures-refused"));
  const summary = await commitDiveSiteImport(
    db,
    session.user.shopId,
    prepared,
    session.user.personId,
    creatures,
  );
  const guides = creatures ? `-${summary.guides}-${summary.creaturesSkipped.length}` : "";
  revalidateAndRedirect(
    page,
    noticeUrl(
      tab,
      `imported-${summary.updated}-${summary.created}-${summary.deleted}-${summary.skipped.length}${guides}`,
    ),
  );
}
