import type {
  CardDisplayStatus,
  CertificationCardRowState,
  HeldCardDisplayStatus,
} from "@/lib/certification-cards";
import type { StaffMessageKey } from "./staff-messages";

/**
 * Certification-card status keys and tones. Domain codes map to staff copy
 * here; component types are not imported across the i18n architecture boundary.
 */
/**
 * Staff-facing "certified" labels the stored `verified` status, which readiness reads.
 */
export const CARD_STATUS_KEYS: Record<CardDisplayStatus, StaffMessageKey> = {
  pending: "divers.shared.cardStatus.pending",
  verified: "divers.shared.cardStatus.verified",
};

export function cardStatusTone(status: CardDisplayStatus): "success" | "warning" {
  return status === "verified" ? "success" : "warning";
}

export const HELD_CARD_STATUS_KEYS: Record<HeldCardDisplayStatus, StaffMessageKey> = {
  ...CARD_STATUS_KEYS,
  confirm_to_clear: "divers.shared.cardStatus.confirmToClear",
};

/**
 * Held summaries use warning for `confirm_to_clear`; the row badge below uses
 * neutral for the same state. Tests pin both contexts.
 */
export function heldCardStatusTone(status: HeldCardDisplayStatus): "success" | "warning" {
  // Warning, not success: the card is on file, and the gate is not open yet.
  return status === "confirm_to_clear" ? "warning" : cardStatusTone(status);
}

/**
 * Shared row badge states (ADR 20260827-people-not-lists, decision 6):
 * verified is silent; pending and self-declared are warning; imported,
 * unconfirmed cards prompt with a neutral tone. Held summaries use warning for
 * that same confirmation blocker. Badges describe card state; readiness decides
 * boarding eligibility (`src/lib/readiness.ts`).
 */
export const CERTIFICATION_ROW_STATE_BADGE: Record<
  CertificationCardRowState,
  { key: StaffMessageKey; tone: "warning" | "neutral" } | null
> = {
  verified: null,
  pending: { key: "divers.shared.cardStatus.pending", tone: "warning" },
  self_declared: { key: "divers.certifications.selfDeclaredLabel", tone: "warning" },
  imported_unconfirmed: { key: "divers.shared.cardStatus.confirmToClear", tone: "neutral" },
};
