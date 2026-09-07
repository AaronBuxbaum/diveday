import type { StaffTranslator } from "@/i18n/staff-messages";
import type { SendHoldCopy } from "./SendHold";

/**
 * Words for `SendHold`, resolved server-side and passed down as plain data —
 * the house pattern for a staff Client Component (see `paper-waiver-copy.ts`).
 * `sendingIn` keeps its `{seconds}` placeholder for the client to count down.
 */
export function sendHoldCopy(t: StaffTranslator): SendHoldCopy {
  return {
    sendingIn: t.raw("shared.sendHold.sendingIn"),
    sendingNow: t("shared.sendHold.sendingNow"),
    undo: t("shared.sendHold.undo"),
  };
}
