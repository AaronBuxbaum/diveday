import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import { formatMoneyCents, formatShortDate } from "@/lib/format";
import { escapeHtml } from "@/lib/html";
import type { NotificationEmail } from "./email";
import { notificationGreeting } from "./greeting";

// i18n-exempt-file: the terminal renderer for the group receipt (#2566), on
// the same footing as `./course-certified.ts`: no React component picks words
// for a sent message, so this resolves its own text through `diverTranslator`
// in the recipient's locale, and every dynamic value is escaped for the html.

export type PartyPaymentReceiptInput = {
  locale: DiverLocale;
  diverName: string;
  shopName: string;
  tripTitle: string;
  startsAt: Date;
  timezone: string;
  seats: number;
  /** Stripe's settled total, display only. */
  amountCents: number;
  currency: string;
};

/** "Paid by card for 4 seats: $720.00. Thank you." One line; no link, no button. */
export function partyPaymentReceiptEmail(input: PartyPaymentReceiptInput): NotificationEmail {
  const t = diverTranslator(input.locale);
  const greeting = notificationGreeting(t, input.diverName);
  const date = formatShortDate(input.startsAt, input.locale, input.timezone);
  const amount = formatMoneyCents(input.amountCents, input.currency, input.locale);
  const body = t("notifications.partyPaymentReceipt.body", {
    seats: input.seats,
    amount,
    tripTitle: input.tripTitle,
    date,
  });
  const bodyHtml = t("notifications.partyPaymentReceipt.body", {
    seats: input.seats,
    amount: `<strong>${escapeHtml(amount)}</strong>`,
    tripTitle: escapeHtml(input.tripTitle),
    date: escapeHtml(date),
  });
  return {
    subject: t("notifications.partyPaymentReceipt.subject", { tripTitle: input.tripTitle }),
    text: `${greeting.text}\n\n${body}\n`,
    html: `<p>${greeting.html}</p><p>${bodyHtml}</p>`,
  };
}
