import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import { escapeHtml } from "@/lib/html";
import { firstNameOf } from "@/lib/person-name";
import { emailButton, type NotificationEmail } from "./email";

// i18n-exempt-file: the terminal renderer for the after-hours desk ping and the
// Stripe-restricted notice to owners, on the
// same footing as `./email.ts` and `./crew-emails.ts` — no React component
// picks words for a sent message, so this resolves its own text through
// `diverTranslator` in the recipient's locale. Every dynamic value is escaped
// for the html body.

export type DeskAfterHoursEmailInput = {
  locale: DiverLocale;
  recipientName: string;
  shopName: string;
  waiting: number;
  inboxUrl: string;
  settingsUrl: string;
};

/**
 * "2 divers wrote in after hours", and the Inbox. Deliberately nothing about
 * who wrote or what they said: the count is the whole message, and the words
 * stay behind the Inbox's sign-in (`src/lib/notifications/kinds.ts`).
 */
export function deskAfterHoursEmail(input: DeskAfterHoursEmailInput): NotificationEmail {
  const t = diverTranslator(input.locale);
  const firstName = firstNameOf(input.recipientName, t("notifications.common.genericName"));
  const greetingText = t("notifications.common.greeting", { firstName });
  const greetingHtml = t("notifications.common.greeting", { firstName: escapeHtml(firstName) });
  const body = t("notifications.deskAfterHours.body", { count: input.waiting });
  const open = t("notifications.deskAfterHours.open");
  const turnOff = t("notifications.deskAfterHours.turnOff");
  return {
    subject: t("notifications.deskAfterHours.subject", {
      shopName: input.shopName,
      count: input.waiting,
    }),
    text: `${greetingText}\n\n${body}\n\n${open}:\n${input.inboxUrl}\n\n${turnOff}:\n${input.settingsUrl}\n`,
    html: `<p>${greetingHtml}</p><p>${escapeHtml(body)}</p>${emailButton(input.inboxUrl, open)}<p><a href="${escapeHtml(input.settingsUrl)}">${escapeHtml(turnOff)}</a></p>`,
  };
}

export type StripePaymentsRestrictedEmailInput = {
  locale: DiverLocale;
  recipientName: string;
  shopName: string;
  settingsUrl: string;
};

/**
 * "Stripe has turned off card payments" (batch 6 item 8). What changed for
 * divers (they book and pay at the shop), and where to look. Stripe's own
 * reason stays in Stripe's dashboard, which is where it is fixed.
 */
export function stripePaymentsRestrictedEmail(
  input: StripePaymentsRestrictedEmailInput,
): NotificationEmail {
  const t = diverTranslator(input.locale);
  const firstName = firstNameOf(input.recipientName, t("notifications.common.genericName"));
  const greetingText = t("notifications.common.greeting", { firstName });
  const greetingHtml = t("notifications.common.greeting", { firstName: escapeHtml(firstName) });
  const body = t("notifications.stripeRestricted.body");
  const open = t("notifications.stripeRestricted.open");
  return {
    subject: t("notifications.stripeRestricted.subject", { shopName: input.shopName }),
    text: `${greetingText}\n\n${body}\n\n${open}:\n${input.settingsUrl}\n`,
    html: `<p>${greetingHtml}</p><p>${escapeHtml(body)}</p>${emailButton(input.settingsUrl, open)}`,
  };
}
