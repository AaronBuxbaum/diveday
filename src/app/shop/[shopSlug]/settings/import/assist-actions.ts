"use server";

import { getDb } from "@/db/client";
import { importAssistFor } from "@/db/file-assists";
import { canPersonImportShopData } from "@/db/import";
import { type ImportAssist, MAX_IMPORT_BYTES } from "@/lib/import";
import { requireStaffSession } from "@/lib/session";

/**
 * **Map the columns the importer could not** (ADR 20261018-claude-assists; the
 * `import` assist). The wizard posts the file's text; the sample Claude sees is
 * built here, on the server, from the headers and at most fifty rows, masked,
 * with any column that mentions health left out (`importAssistSample`). The
 * answer goes back to the preview, where the owner reads every mapped column
 * before confirming, and the confirm re-reads it through its schema. Gated to
 * owner and manager, like the import itself.
 */
export async function mapImportColumnsAction(csv: string): Promise<ImportAssist | null> {
  if (typeof csv !== "string" || !csv.trim() || csv.length > MAX_IMPORT_BYTES) return null;
  const session = await requireStaffSession();
  const db = await getDb();
  if (!(await canPersonImportShopData(db, session.user.shopId, session.user.personId))) {
    return null;
  }
  return importAssistFor(db, { shopId: session.user.shopId, csv });
}
