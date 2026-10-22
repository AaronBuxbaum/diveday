import {
  importAssistFrom,
  importAssistSample,
  importMappingCall,
} from "@/lib/assists/import-mapping";
import {
  looksLikePdf,
  WAIVER_PDF_MAX_BYTES,
  waiverDraftBody,
  waiverDraftCall,
} from "@/lib/assists/waiver-draft";
import type { ImportAssist } from "@/lib/import";
import { type AssistOptions, runAssist } from "./assists";
import type { AppDb } from "./client";

/**
 * **The two assists that read a file the owner brought** (ADR
 * 20261018-claude-assists; the `import` and `waiver-import` assists). Nothing
 * here writes: an import mapping goes back to the wizard's preview, where the
 * owner confirms it and the importer re-reads it, and a waiver draft fills the
 * release editor, where the owner publishes it or not.
 */

/**
 * A mapping for the columns and level spellings the importer could not read
 * itself, from the headers and a masked sample of at most fifty rows. Null when
 * there was nothing to ask, or the assist is dark or failed.
 */
export async function importAssistFor(
  db: AppDb,
  input: { shopId: string; csv: string } & AssistOptions,
): Promise<ImportAssist | null> {
  const sample = importAssistSample(input.csv);
  if (!sample) return null;
  const value = await runAssist(db, {
    ...input,
    feature: "import_mapping",
    call: importMappingCall(sample),
  });
  return value ? importAssistFrom(value, sample) : null;
}

/** A release's text, laid out from the PDF the owner chose. Null for anything else. */
export async function waiverDraftFromPdf(
  db: AppDb,
  input: { shopId: string; bytes: Uint8Array } & AssistOptions,
): Promise<string | null> {
  if (input.bytes.length > WAIVER_PDF_MAX_BYTES || !looksLikePdf(input.bytes)) return null;
  const value = await runAssist(db, {
    ...input,
    feature: "waiver_import",
    call: waiverDraftCall(Buffer.from(input.bytes).toString("base64")),
  });
  return value ? waiverDraftBody(value) : null;
}
