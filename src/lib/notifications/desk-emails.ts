import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import { formatDateTimeTz } from "@/lib/format";
import { escapeHtml } from "@/lib/html";
import { emailButton, type NotificationEmail } from "./email";
import { notificationGreeting } from "./greeting";

// i18n-exempt-file: the terminal renderer for the after-hours desk ping, the
// Stripe-restricted notice to owners and the Ask-to-move alert, on the
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
  const greeting = notificationGreeting(t, input.recipientName);
  const body = t("notifications.deskAfterHours.body", { count: input.waiting });
  const open = t("notifications.deskAfterHours.open");
  const turnOff = t("notifications.deskAfterHours.turnOff");
  return {
    subject: t("notifications.deskAfterHours.subject", {
      shopName: input.shopName,
      count: input.waiting,
    }),
    text: `${greeting.text}\n\n${body}\n\n${open}:\n${input.inboxUrl}\n\n${turnOff}:\n${input.settingsUrl}\n`,
    html: `<p>${greeting.html}</p><p>${escapeHtml(body)}</p>${emailButton(input.inboxUrl, open)}<p><a href="${escapeHtml(input.settingsUrl)}">${escapeHtml(turnOff)}</a></p>`,
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
  const greeting = notificationGreeting(t, input.recipientName);
  const body = t("notifications.stripeRestricted.body");
  const open = t("notifications.stripeRestricted.open");
  return {
    subject: t("notifications.stripeRestricted.subject", { shopName: input.shopName }),
    text: `${greeting.text}\n\n${body}\n\n${open}:\n${input.settingsUrl}\n`,
    html: `<p>${greeting.html}</p><p>${escapeHtml(body)}</p>${emailButton(input.settingsUrl, open)}`,
  };
}

export type MoveAskSoonEmailInput = {
  locale: DiverLocale;
  recipientName: string;
  shopName: string;
  tripTitle: string;
  startsAt: Date;
  timezone: string;
  inboxUrl: string;
};

/**
 * "A diver asked to move off Night Dive, leaving Tue, Jul 21, 7:30 PM EDT"
 * (issue #2667): the departure and the Inbox, never who asked or what they
 * wrote (`move_ask_soon` in `./kinds.ts`).
 */
export function moveAskSoonEmail(input: MoveAskSoonEmailInput): NotificationEmail {
  const t = diverTranslator(input.locale);
  const greeting = notificationGreeting(t, input.recipientName);
  const body = t("notifications.moveAskSoon.body", {
    tripTitle: input.tripTitle,
    when: formatDateTimeTz(input.startsAt, input.locale, input.timezone),
  });
  const open = t("notifications.moveAskSoon.open");
  return {
    subject: t("notifications.moveAskSoon.subject", {
      shopName: input.shopName,
      tripTitle: input.tripTitle,
    }),
    text: `${greeting.text}\n\n${body}\n\n${open}:\n${input.inboxUrl}\n`,
    html: `<p>${greeting.html}</p><p>${escapeHtml(body)}</p>${emailButton(input.inboxUrl, open)}`,
  };
}
