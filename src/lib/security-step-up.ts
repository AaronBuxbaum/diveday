import { noticeUrl, safeShopReturnPath, shopPath } from "@/lib/staff-notices";

/** A step-up's purpose, its return path and its challenge link; whether a session holds one is `hasRequiredStepUp` in `src/db/step-up.ts`. */
export type StepUpPurpose = "money" | "export" | "backup";

export function isStepUpPurpose(value: string | null | undefined): value is StepUpPurpose {
  return value === "money" || value === "export" || value === "backup";
}

/**
 * Only return paths inside the current shop can be resumed after a challenge.
 *
 * The body moved to `safeShopReturnPath` when `divers/new` turned out to accept
 * a `?returnTo=` with no check at all; the name stays because the step-up
 * callers read better for it, and one implementation means the next surface to
 * accept a return path cannot re-derive a weaker one.
 */
export const safeStepUpReturnPath = safeShopReturnPath;

export function stepUpChallengeUrl(
  shopSlug: string,
  purpose: StepUpPurpose,
  returnTo: string,
): string {
  return noticeUrl(shopPath(shopSlug, "me", "security"), "step-up-required", {
    purpose,
    returnTo,
  });
}
