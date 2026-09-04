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
  medical_not_cleared: "shared.waiverStatus.medicalNotCleared",
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
  return waiverRowStateTone(status.state);
}

/**
 * **The state a shared waiver row renders** (ADR 20260827-people-not-lists,
 * decision 6) — the four states `shopWaiverStatus` can be in, plus the one
 * that is not a waiver standing at all.
 *
 * `failed` is a **delivery** outcome (`diver.waiverRequest === "failed"`),
 * orthogonal to the release itself: the diver's standing is still "not
 * signed", and what failed is the message we sent asking them to. So it takes
 * the same word as `none` — the standing is the standing — and the reason goes
 * in the row's detail, which is why `WaiverStateRow` will not render that state
 * without one.
 */
export type WaiverRowState = ShopWaiverStatus["state"] | "failed";

/** The one word a waiver row's state goes by, in the staff bundle's language. */
export function waiverRowStateText(t: StaffTranslator, state: WaiverRowState): string {
  return t(WAIVER_STATUS_KEYS[state === "failed" ? "none" : state]);
}

/**
 * The one tone it wears. `failed` is danger for the reason a held medical is:
 * it fails closed and somebody has to act — the record's waiver card has tinted
 * it that way since it shipped.
 */
export function waiverRowStateTone(state: WaiverRowState): "success" | "warning" | "danger" {
  switch (state) {
    case "current":
      return "success";
    case "medical_review":
    case "medical_not_cleared":
    case "failed":
      return "danger";
    default:
      return "warning";
  }
}
