import type { DepthCeilingCheck } from "@/lib/depth-ceiling";
import type { StaffTranslator } from "./staff-messages";

/**
 * The staff-facing sentence for a depth advisory. `src/lib/depth-ceiling.ts`
 * returns numbers, a unit code, and which rule set the ceiling; the words are
 * chosen here (AGENTS.md — domain returns codes, the UI picks the copy).
 *
 * Both numbers arrive already converted to the shop's unit, so this only has to
 * choose a template and drop in "m" or "ft".
 */
export function depthWarningText(
  t: StaffTranslator,
  advisory: Extract<DepthCeilingCheck, { status: "exceeds" }>,
): string {
  const values = {
    site: advisory.siteDepth,
    limit: advisory.limitDepth,
    unit: t(advisory.unit === "feet" ? "shared.depth.feet" : "shared.depth.meters"),
  };
  if (advisory.basis === "junior_age") return t("trips.roster.depthWarningJunior", values);
  if (advisory.basis === "no_card") return t("trips.roster.depthWarningNoCard", values);
  return t("trips.roster.depthWarning", values);
}
