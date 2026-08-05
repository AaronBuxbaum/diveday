import type { ShopWaiverStatus } from "@/lib/waivers";
import type { StaffMessageKey, StaffTranslator } from "./staff-messages";

/**
 * The words and tone a diver's **shop-level** waiver standing wears.
 *
 * A release is signed once and carries across every booking a diver has at the
 * shop (`effectiveWaiverForBooking`, src/lib/waivers.ts), so this is a fact
 * about the person, not about Saturday's boat. `shopWaiverStatus` hands back a
 * code; this is the one resolver staff surfaces render it through, so the same
 * standing can never read differently on two screens — the rule
 * `src/i18n/readiness-labels.ts` states for Blocked/Ready.
 *
 * "Expired" is deliberately its own word rather than folded into "not signed":
 * a diver who signed here last season needs a fresh signature, and one who
 * never has needs a first one. They are different conversations at the desk.
 */
const WAIVER_STATUS_KEYS: Record<ShopWaiverStatus["state"], StaffMessageKey> = {
  none: "shared.waiverStatus.none",
  current: "shared.waiverStatus.current",
  expired: "shared.waiverStatus.expired",
  medical_review: "shared.waiverStatus.medicalReview",
};

/** The one word a shop-level waiver standing goes by, in the staff bundle's language. */
export function shopWaiverStatusText(t: StaffTranslator, status: ShopWaiverStatus): string {
  return t(WAIVER_STATUS_KEYS[status.state]);
}

/**
 * The one tone that standing wears. A held medical is danger — it fails closed
 * and nobody boards on it. A missing or lapsed signature is warning: real work
 * to do, and ordinary, since it is the state every new diver starts in. Colour
 * never carries the meaning on its own (design/principles.md #6); it only has
 * to stop contradicting the word beside it.
 */
export function shopWaiverStatusTone(status: ShopWaiverStatus): "success" | "warning" | "danger" {
  switch (status.state) {
    case "current":
      return "success";
    case "medical_review":
      return "danger";
    default:
      return "warning";
  }
}
