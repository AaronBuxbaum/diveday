"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { canPersonImportShopData, commitContactImport, type ImportSummary } from "@/db/import";
import { parseForm } from "@/lib/form-parse";
import type { ImportFatalCode, ImportFatalParams } from "@/lib/import";
import { prepareContactImport } from "@/lib/import";
import { requireStaffSession } from "@/lib/session";

/** The pasted or uploaded CSV, as text the client read off the file. */
const contactsForm = z.object({ csv: z.string().default("") });

export type ImportActionErrorCode =
  | ImportFatalCode
  | "not_owner_or_manager"
  | "csv_required"
  | "no_importable_rows";

export type ImportActionState =
  | { status: "idle" }
  | { status: "error"; code: ImportActionErrorCode; params?: ImportFatalParams }
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
    return { status: "error", code: "not_owner_or_manager" };
  }

  const parsed = parseForm(contactsForm, formData);
  const csv = parsed.ok ? parsed.data.csv : "";
  if (!csv.trim()) return { status: "error", code: "csv_required" };

  const prepared = prepareContactImport(csv);
  if (prepared.fatal) {
    return { status: "error", code: prepared.fatal.code, params: prepared.fatal.params };
  }
  if (prepared.totals.importable === 0) {
    return { status: "error", code: "no_importable_rows" };
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
