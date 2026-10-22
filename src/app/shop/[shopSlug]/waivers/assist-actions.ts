"use server";

import { canPersonManageWaiverTemplates } from "@/db/authz";
import { getDb } from "@/db/client";
import { waiverDraftFromPdf } from "@/db/file-assists";
import { WAIVER_PDF_MAX_BYTES } from "@/lib/assists/waiver-draft";
import { requireStaffSession } from "@/lib/session";

/**
 * **The release, drafted from the shop's current PDF** (ADR
 * 20261018-claude-assists; the `waiver-import` assist). Answers text for the
 * release editor, and writes nothing: the owner reads it there and publishes
 * through `saveWaiverAction`, with its materiality choice, or does not. The
 * file is checked here for size and for a PDF's own header before anything is
 * sent. Gated like the editor itself.
 */
export async function draftWaiverFromPdfAction(formData: FormData): Promise<string | null> {
  const session = await requireStaffSession();
  const db = await getDb();
  if (!(await canPersonManageWaiverTemplates(db, session.user.shopId, session.user.personId))) {
    return null;
  }
  const file = formData.get("pdf");
  if (!(file instanceof File) || file.size === 0 || file.size > WAIVER_PDF_MAX_BYTES) return null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  return waiverDraftFromPdf(db, { shopId: session.user.shopId, bytes });
}
