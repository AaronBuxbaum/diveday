import type { DepthUnit } from "@/lib/depth-units";
import { siteDepthInUnit } from "@/lib/dive-site-depth";
import type { DepthAdvisory } from "@/lib/findings";
import type { StaffTranslator } from "./staff-messages";

/**
 * The staff-facing sentence for a depth advisory, a finding at strictness zero
 * (`src/lib/findings.ts`). Its params carry numbers, a unit code, and which rule
 * set the ceiling; the words are chosen here (AGENTS.md — domain returns codes, the UI picks the copy).
 *
 * Both numbers arrive already converted to the shop's unit, so this only has to
 * choose a template and drop in "m" or "ft".
 */
export function depthWarningText(t: StaffTranslator, finding: DepthAdvisory): string {
  const messages: string[] = [];
  if (finding.code === "depth_exceeds_ceiling") {
    const values = {
      site: finding.params.siteDepth,
      limit: finding.params.limitDepth,
      unit: t(finding.params.unit === "feet" ? "shared.depth.feet" : "shared.depth.meters"),
    };
    messages.push(
      finding.params.verificationReasons && finding.params.basis !== "junior_card"
        ? t("trips.roster.depthWarningUnconfirmed", values)
        : finding.params.basis === "junior_age"
          ? t("trips.roster.depthWarningJunior", values)
          : finding.params.basis === "junior_card"
            ? t("trips.roster.depthWarningJuniorCard", values)
            : finding.params.basis === "no_card"
              ? t("trips.roster.depthWarningNoCard", values)
              : t("trips.roster.depthWarning", values),
    );
  }
  for (const reason of finding.params.verificationReasons ?? []) {
    messages.push(
      t(
        reason === "card_status"
          ? "trips.roster.depthVerificationCard"
          : "trips.roster.depthVerificationLimits",
      ),
    );
  }
  return messages.join(" ");
}

/** The advisory's visible text, or null when there is none. */
export function depthWarningOrNull(
  t: StaffTranslator,
  advisory: DepthAdvisory | null | undefined,
): string | null {
  return advisory ? depthWarningText(t, advisory) : null;
}

/**
 * A dive site's depth on a staff surface, in the shop's unit: "15–28 m" with a
 * shallow end and a deepest point, "28 m" with only the deepest, the shop's own
 * depth note with neither, null with nothing. The diver pages say the same
 * through `diveSiteDepthText`.
 */
export function staffDiveSiteDepthText(
  t: StaffTranslator,
  depth: {
    depthMinMeters?: number | null;
    maxDepthMeters?: number | null;
    depthRange?: string | null;
  },
  unit: DepthUnit,
): string | null {
  const inUnit = siteDepthInUnit(depth, unit);
  if (!inUnit) return depth.depthRange?.trim() || null;
  const unitWord = t(unit === "feet" ? "shared.depth.feet" : "shared.depth.meters");
  if (inUnit.min === null) return t("shared.depthSingle", { max: inUnit.max, unit: unitWord });
  return t("shared.depthRange", { min: inUnit.min, max: inUnit.max, unit: unitWord });
}
