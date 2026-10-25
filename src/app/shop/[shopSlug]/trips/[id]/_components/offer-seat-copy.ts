import { sendHoldCopy } from "@/components/send-hold-copy";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { OfferSeatCopy } from "./OfferSeat";

/**
 * Every word `OfferSeat` (a Client Component) renders, resolved on the server —
 * see the note in src/i18n/staff-messages.ts. Templates rather than finished
 * strings where the value is only known in the browser: the booking link the
 * composer fallback writes (`window.location.origin`).
 */
export function offerSeatCopy(t: StaffTranslator): OfferSeatCopy {
  return {
    hold: sendHoldCopy(t),
    offerSeat: t("trips.whoWantsIn.offerSeat"),
    sent: t("trips.whoWantsIn.sent"),
    couldntSend: t("trips.whoWantsIn.couldntSend"),
    writeTo: t.raw("trips.whoWantsIn.writeTo"),
    copyFor: t.raw("trips.whoWantsIn.copyFor"),
    copied: t("trips.whoWantsIn.copied"),
    copyFailed: t("trips.whoWantsIn.copyFailed"),
    emailSubject: t.raw("trips.whoWantsIn.emailSubject"),
    emailBody: t.raw("trips.whoWantsIn.emailBody"),
  };
}

/** "2h ago": how long since a seat was offered, from the clock the caller reads. */
export function offeredAgoText(t: StaffTranslator, at: Date, now: Date): string {
  const mins = Math.max(0, Math.round((now.getTime() - at.getTime()) / 60000));
  if (mins < 1) return t("trips.whoWantsIn.justNow");
  if (mins < 60) return t("trips.whoWantsIn.minutesAgo", { mins });
  const hours = Math.round(mins / 60);
  if (hours < 24) return t("trips.whoWantsIn.hoursAgo", { hours });
  return t("trips.whoWantsIn.daysAgo", { days: Math.round(hours / 24) });
}
