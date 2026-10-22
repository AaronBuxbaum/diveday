import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import { escapeHtml } from "@/lib/html";
import { SUPPORT_EMAIL } from "@/lib/platform-mail";
import type { NotificationEmail } from "./email";

// i18n-exempt-file: terminal email renderer; fixed copy resolves through the recipient's bundle.

/** Fixed platform copy only: an unverified address must never receive submitted text. */
export function setupRequestReceiptEmail(input: { locale: DiverLocale }): NotificationEmail {
  const t = diverTranslator(input.locale);
  const next = t("notifications.setupRequestReceipt.next");
  const support = t("notifications.setupRequestReceipt.support", { email: SUPPORT_EMAIL });
  return {
    subject: t("notifications.setupRequestReceipt.subject"),
    text: `${next}\n\n${support}\n`,
    html: `<p>${escapeHtml(next)}</p><p>${escapeHtml(support)}</p>`,
  };
}
