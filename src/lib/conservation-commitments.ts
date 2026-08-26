import type { DiverTranslator } from "@/i18n/messages";

export const CONSERVATION_COMMITMENT_CODES = [
  "green_fins_member",
  "padi_aware_partner",
  "mooring_buoys_only",
  "no_touch_policy",
  "no_gloves_policy",
  "reef_cleanup_dives",
  "lionfish_containment",
  "coral_nursery_support",
] as const;

export type ConservationCommitmentCode = (typeof CONSERVATION_COMMITMENT_CODES)[number];

export function isConservationCommitmentCode(value: unknown): value is ConservationCommitmentCode {
  return (
    typeof value === "string" &&
    (CONSERVATION_COMMITMENT_CODES as readonly string[]).includes(value)
  );
}

/**
 * Validate submitted commitment selections. Drops unknown strings, deduplicates,
 * and maintains the canonical order defined in CONSERVATION_COMMITMENT_CODES.
 */
export function parseConservationCommitments(input: unknown): ConservationCommitmentCode[] {
  if (!Array.isArray(input)) return [];
  const selected = new Set<ConservationCommitmentCode>();
  for (const item of input) {
    if (isConservationCommitmentCode(item)) {
      selected.add(item);
    }
  }
  return CONSERVATION_COMMITMENT_CODES.filter((code) => selected.has(code));
}

export function conservationCommitmentLabel(
  code: ConservationCommitmentCode,
  t: DiverTranslator,
): string {
  return t(`conservation.commitments.${code}`);
}
