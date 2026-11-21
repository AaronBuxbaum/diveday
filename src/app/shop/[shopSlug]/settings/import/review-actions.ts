"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { diveSitePhotoUrlsHeldByShop } from "@/db/dive-site-photos";
import { requireStaffSession } from "@/features/accounts/session";
import {
  commitGearImport,
  GEAR_IMPORT_COLUMNS,
  prepareGearImport,
} from "@/features/gear/gear-import";
import {
  canPersonImportShopData,
  type FileReviewRow,
  previewDiveSiteGuides,
  previewDiveSiteImport,
  previewGearImport,
} from "@/features/records/import";
import {
  commitDiveSiteImport,
  DIVE_SITE_CREATURE_IMPORT_COLUMNS,
  DIVE_SITE_IMPORT_COLUMNS,
  prepareDiveSiteCreaturesImport,
  prepareDiveSiteImport,
} from "@/features/sites/dive-sites";
import { MAX_IMPORT_BYTES } from "@/lib/import";
import { mapImportColumns, parseImportColumnMapping } from "@/lib/import-column-mapping";
import { shopPath } from "@/lib/staff-notices";

export type FileImportReview = {
  error?: string;
  rows?: (Omit<FileReviewRow, "outcome"> & { outcome: FileReviewRow["outcome"] | "processed" })[][];
  counts?: Record<string, number>;
  completed?: boolean;
};

/** Both stages reauthorize, remap raw bytes and reparse; no client-prepared facts are trusted. */
export async function reviewExistingImportAction(
  form: FormData,
  commit = false,
): Promise<FileImportReview> {
  const session = await requireStaffSession();
  const db = await getDb();
  if (!(await canPersonImportShopData(db, session.user.shopId, session.user.personId)))
    return { error: "not_authorized" };
  const kind = form.get("kind");
  const files = form.getAll("file");
  const mappings = parseImportColumnMapping(form.get("mappings"));
  const types = parseImportColumnMapping(form.get("types"));
  if (
    (kind !== "gear" && kind !== "sites") ||
    files.length < 1 ||
    files.length > (kind === "gear" ? 1 : 2) ||
    !Array.isArray(mappings) ||
    !Array.isArray(types) ||
    mappings.length !== files.length ||
    types.length !== files.length
  )
    return { error: "invalid_mapping" };
  const mapped: { csv: string; type: string }[] = [];
  for (const [index, file] of files.entries()) {
    if (!(file instanceof File) || !file.size) return { error: "file_empty" };
    if (file.size > MAX_IMPORT_BYTES) return { error: "file_too_large" };
    const type = types[index];
    if (kind === "gear" ? type !== "gear" : type !== "sites" && type !== "creatures")
      return { error: "invalid_mapping" };
    const columns =
      type === "gear"
        ? GEAR_IMPORT_COLUMNS
        : type === "sites"
          ? DIVE_SITE_IMPORT_COLUMNS
          : DIVE_SITE_CREATURE_IMPORT_COLUMNS;
    const result = mapImportColumns(await file.text(), mappings[index], columns);
    if ("error" in result) return { error: result.error };
    mapped.push({ csv: result.csv, type });
  }
  if (kind === "gear") {
    const prepared = prepareGearImport(mapped[0].csv);
    if (prepared.fatal) return { error: prepared.fatal };
    if (!commit) return { rows: [await previewGearImport(db, session.user.shopId, prepared)] };
    const summary = await commitGearImport(
      db,
      session.user.shopId,
      prepared,
      session.user.personId,
    );
    revalidatePath(shopPath(session.user.shopSlug, "settings", "import"));
    const { rowResults, ...counts } = summary;
    return {
      completed: true,
      counts,
      rows: [
        rowResults.map((row) => ({
          ...row,
          outcome: row.issues.some(
            (issue) => !issue.includes("assignment") && issue !== "service_already_recorded",
          )
            ? "skip"
            : "processed",
        })),
      ],
    };
  }
  const sites = mapped.filter((file) => file.type === "sites");
  const creatures = mapped.filter((file) => file.type === "creatures");
  if (sites.length !== 1 || creatures.length > 1) return { error: "wrong_files" };
  const prepared = prepareDiveSiteImport(
    sites[0].csv,
    await diveSitePhotoUrlsHeldByShop(db, session.user.shopId),
  );
  const guide = creatures.length ? prepareDiveSiteCreaturesImport(creatures[0].csv) : undefined;
  if (prepared.fatal || guide?.fatal)
    return { error: prepared.fatal ?? guide?.fatal ?? "invalid_mapping" };
  const rows = mapped.map((file) => (file.type === "sites" ? prepared.rows : (guide?.rows ?? [])));
  if (!commit) {
    const siteRows = await previewDiveSiteImport(db, session.user.shopId, prepared);
    return {
      rows: mapped.map((file) =>
        file.type === "sites"
          ? siteRows
          : guide
            ? previewDiveSiteGuides(prepared, siteRows, guide)
            : [],
      ),
    };
  }
  const summary = await commitDiveSiteImport(
    db,
    session.user.shopId,
    prepared,
    session.user.personId,
    guide,
  );
  revalidatePath(shopPath(session.user.shopSlug, "settings", "import"));
  return {
    completed: true,
    counts: {
      updated: summary.updated,
      created: summary.created,
      deleted: summary.deleted,
      skipped: summary.skipped.length,
      guides: summary.guides,
      creaturesSkipped: summary.creaturesSkipped.length,
    },
    rows: mapped.map((file, index) =>
      rows[index].map((row) => {
        const refusal = (file.type === "sites" ? summary.skipped : summary.creaturesSkipped).find(
          (skipped) => skipped.rowNumber === row.rowNumber,
        );
        return {
          rowNumber: row.rowNumber,
          issues: refusal?.issues ?? [],
          outcome: refusal ? "skip" : "processed",
        };
      }),
    ),
  };
}
