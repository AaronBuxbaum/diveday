import type { ImportAssist, PreparedImport } from "@/lib/import";
import { prepareContactImport as prepareOn } from "@/lib/import";

/** The shop's today for import fixtures: every booking a fixture holds is on or before it. */
export const IMPORT_FIXTURE_TODAY = "2026-10-22";

/**
 * `prepareContactImport` on {@link IMPORT_FIXTURE_TODAY}, so a fixture's
 * bookings file as visits. A test about bookings after today calls the real
 * one with its own day. `assist` passes a Claude assist's mapping through.
 */
export function prepareContactImport(text: string, assist?: ImportAssist): PreparedImport {
  return prepareOn(text, { today: IMPORT_FIXTURE_TODAY, assist });
}
