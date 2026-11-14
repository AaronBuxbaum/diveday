import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import { escapeHtml } from "@/lib/html";
import { emailButton, type NotificationEmail } from "./email";
import { notificationGreeting } from "./greeting";

// i18n-exempt-file: this renderer resolves the recipient's language itself.
export type UnresolvedSafetyReviewEmailInput = {
  locale: DiverLocale;
  recipientName: string;
  shopName: string;
  tripTitle: string;
  reviewUrl: string;
};

/** Review notice only: it asserts no missing person, count, or meeting. */
export function unresolvedSafetyReviewEmail(
  input: UnresolvedSafetyReviewEmailInput,
): NotificationEmail {
  const t = diverTranslator(input.locale);
  const { text: greetingText, html: greetingHtml } = notificationGreeting(t, input.recipientName);
  const body = t("notifications.unresolvedSafetyReview.body", { tripTitle: input.tripTitle });
  const open = t("notifications.unresolvedSafetyReview.open");
  return {
    subject: t("notifications.unresolvedSafetyReview.subject", { shopName: input.shopName }),
    text: `${greetingText}\n\n${body}\n\n${open}:\n${input.reviewUrl}\n`,
    html: `<p>${greetingHtml}</p><p>${escapeHtml(body)}</p>${emailButton(input.reviewUrl, open)}`,
  };
}
