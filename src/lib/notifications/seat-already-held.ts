import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import { formatShortDate } from "@/lib/format";
import { escapeHtml } from "@/lib/html";
import { firstNameOf } from "@/lib/person-name";
import type { NotificationEmail } from "./email";

// i18n-exempt-file: the terminal renderer for the held-seat note (#2381), on
// the same footing as `./course-certified.ts`: no React component picks words
// for a sent message, so this resolves its own text through `diverTranslator`
// in the recipient's locale, and every dynamic value is escaped for the html.

export type SeatAlreadyHeldInput = {
  locale: DiverLocale;
  diverName: string;
  shopName: string;
  tripTitle: string;
  startsAt: Date;
  timezone: string;
};

/**
 * "Someone used a seat-claim link with your address. You already have a seat on
 * Two-Tank Reef, so nothing changed." Names the seat the reader already holds
 * and nothing about anyone else's: not the claim's organizer, not the seat it
 * was for.
 */
export function seatAlreadyHeldEmail(input: SeatAlreadyHeldInput): NotificationEmail {
  const t = diverTranslator(input.locale);
  const firstName = firstNameOf(input.diverName, t("notifications.common.genericName"));
  const date = formatShortDate(input.startsAt, input.locale, input.timezone);
  const body = t("notifications.seatAlreadyHeld.body", {
    shopName: input.shopName,
    tripTitle: input.tripTitle,
    date,
  });
  const bodyHtml = t("notifications.seatAlreadyHeld.body", {
    shopName: escapeHtml(input.shopName),
    tripTitle: `<strong>${escapeHtml(input.tripTitle)}</strong>`,
    date: escapeHtml(date),
  });
  return {
    subject: t("notifications.seatAlreadyHeld.subject", { tripTitle: input.tripTitle }),
    text: `${t("notifications.common.greeting", { firstName })}\n\n${body}\n`,
    html: `<p>${t("notifications.common.greeting", { firstName: escapeHtml(firstName) })}</p><p>${bodyHtml}</p>`,
  };
}
