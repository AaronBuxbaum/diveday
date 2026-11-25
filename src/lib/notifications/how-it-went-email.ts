import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import { formatTime, formatWeekday } from "@/lib/format";
import { escapeHtml } from "@/lib/html";
import { emailButton, type NotificationEmail } from "./email";
import { notificationGreeting } from "./greeting";

// i18n-exempt-file: the terminal renderer for the owner's How it went email,
// on the same footing as `./desk-emails.ts`: no React component picks words
// for a sent message, so this resolves its own text through `diverTranslator`
// in the recipient's locale. Every dynamic value is escaped for the html body.

export type HowItWentEmailInput = {
  locale: DiverLocale;
  recipientName: string;
  shopName: string;
  tripTitle: string;
  startsAt: Date;
  timezone: string;
  pageUrl: string;
  settingsUrl: string;
};

/**
 * "How Saturday's 8:00 AM went", one sentence on what the page holds, and the
 * page. No names and no counts: those stay behind the sign-in
 * (`src/lib/notifications/kinds.ts`).
 */
export function howItWentEmail(input: HowItWentEmailInput): NotificationEmail {
  const t = diverTranslator(input.locale);
  const greeting = notificationGreeting(t, input.recipientName);
  const words = {
    shopName: input.shopName,
    tripTitle: input.tripTitle,
    weekday: formatWeekday(input.startsAt, input.locale, input.timezone),
    time: formatTime(input.startsAt, input.locale, input.timezone),
  };
  const body = t("notifications.howItWent.body", words);
  const open = t("notifications.howItWent.open");
  const turnOff = t("notifications.howItWent.turnOff");
  return {
    subject: t("notifications.howItWent.subject", words),
    text: `${greeting.text}\n\n${body}\n\n${open}:\n${input.pageUrl}\n\n${turnOff}:\n${input.settingsUrl}\n`,
    html: `<p>${greeting.html}</p><p>${escapeHtml(body)}</p>${emailButton(input.pageUrl, open)}<p><a href="${escapeHtml(input.settingsUrl)}">${escapeHtml(turnOff)}</a></p>`,
  };
}
