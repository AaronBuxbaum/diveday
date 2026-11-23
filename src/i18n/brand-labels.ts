import type { DiverTranslator } from "@/i18n/messages";
import type { BrandBadgeCode } from "@/lib/brand";

/**
 * The words on a shop's badge wall, in the reader's language. A badge is a
 * code on `shops.brand_badges` (Harbor, ADR 20260901-diveday-reimagined); the
 * sentence is DiveDay's; the organization's logo, when there is one, is
 * `BADGE_LOGOS`, beside the words and never in place of them.
 */
export function brandBadgeLabel(code: BrandBadgeCode, t: DiverTranslator): string {
  return t(`brand.badges.${code}`);
}
