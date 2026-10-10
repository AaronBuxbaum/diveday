import { z } from "zod";
import type { AppDb } from "@/db/client";
import { importGlobalDiveSiteTemplate } from "@/db/dive-sites";
import { parseForm } from "@/lib/form-parse";

/**
 * The dive-site pages' small form reads, through one parser (issue #2233),
 * kept beside the routes so the route files stay their length.
 */

const siteExtrasForm = z.object({
  expectedVersion: z.string().default(""),
  requiresNitrox: z.string().optional(),
});

/**
 * The two fields the site form posts beside the ones `parseDiveSiteFields`
 * reads: the version the tab last saw (`null` when absent or not a number) and
 * the nitrox box.
 */
export function siteFormExtras(formData: FormData): {
  expectedVersion: number | null;
  requiresNitrox: boolean;
} {
  const parsed = parseForm(siteExtrasForm, formData);
  const sentVersion = Number.parseInt(parsed.ok ? parsed.data.expectedVersion : "", 10);
  return {
    expectedVersion: Number.isNaN(sentVersion) ? null : sentVersion,
    requiresNitrox: parsed.ok && parsed.data.requiresNitrox === "on",
  };
}

const templatePullForm = z.object({ mode: z.string().optional() });

/** The posted template-update mode, unnarrowed; the caller decides what it accepts. */
export function templatePullMode(formData: FormData): string | undefined {
  const parsed = parseForm(templatePullForm, formData);
  return parsed.ok ? parsed.data.mode : undefined;
}

const templateImportForm = z.object({ templateId: z.string().default("") });

/** Import the catalog template the form names into the shop; `null` when it names none. */
export function importTemplateFromForm(db: AppDb, shopId: string, formData: FormData) {
  const parsed = parseForm(templateImportForm, formData);
  return importGlobalDiveSiteTemplate(db, shopId, parsed.ok ? parsed.data.templateId : "");
}
