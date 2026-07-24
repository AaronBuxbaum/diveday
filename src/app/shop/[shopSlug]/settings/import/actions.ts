"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { canPersonImportShopData, commitContactImport, type ImportSummary } from "@/db/import";
import { prepareContactImport } from "@/lib/import";
import { requireStaffSession } from "@/lib/session";

export type ImportActionState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "done"; summary: ImportSummary };

/**
 * Commits a pasted/uploaded contacts CSV. The client previews with the same
 * pure preparation, but this is the authority: it re-checks owner/manager
 * against the database, re-prepares the raw text server-side (so the safety
 * normalization is never client-trusted), and only then writes. The shop comes
 * from the session, never the URL.
 */
export async function importContactsAction(
  _prev: ImportActionState,
  formData: FormData,
): Promise<ImportActionState> {
  const session = await requireStaffSession();
  const db = await getDb();
  if (!(await canPersonImportShopData(db, session.user.shopId, session.user.personId))) {
    return {
      status: "error",
      message: "Importing contacts is limited to the shop's owner or manager.",
    };
  }

  const csv = String(formData.get("csv") ?? "");
  if (!csv.trim()) return { status: "error", message: "Choose a CSV file to import." };

  const prepared = prepareContactImport(csv);
  if (prepared.fatal) return { status: "error", message: prepared.fatal };
  if (prepared.totals.importable === 0) {
    return {
      status: "error",
      message: "No importable rows — every row was missing a name or duplicated.",
    };
  }

  const summary = await commitContactImport(
    db,
    session.user.shopId,
    prepared,
    session.user.personId,
  );
  // The roster and its counts change; refresh the divers surface.
  revalidatePath(`/shop/${session.user.shopSlug}/divers`);
  return { status: "done", summary };
}
