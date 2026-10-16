import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import { monthLabel, parseMonthKey } from "@/lib/calendar";
import { escapeHtml } from "@/lib/html";
import type { NotificationEmail } from "./email";

// i18n-exempt-file: the terminal renderer for the month-end email (fifth loop,
// item 35), on the same footing as `./weekly-digest-email.ts`: no React
// component picks words for a sent message, so this resolves its own text
// through `diverTranslator` in the shop's locale, and every dynamic value is
// escaped for the html body.

export type BookkeeperMonthEndInput = {
  locale: DiverLocale;
  shopName: string;
  /** `YYYY-MM`. */
  month: string;
  attachments: readonly { fileName: string }[];
};

/**
 * "October 2026 at Blue Mantis Divers: the month's report, orders and crew
 * sheet are attached." The files are the message; the body names them and
 * says how the address got here and how to stop it, since the reader is not
 * the shop's customer and holds no account.
 */
export function bookkeeperMonthEndEmail(input: BookkeeperMonthEndInput): NotificationEmail {
  const t = diverTranslator(input.locale);
  const ref = parseMonthKey(input.month);
  const label = ref ? monthLabel(ref, input.locale) : input.month;
  // Both sentences open on the month, and Spanish writes "octubre" lowercase.
  const month = label.charAt(0).toLocaleUpperCase(input.locale) + label.slice(1);
  const values = { month, shopName: input.shopName };
  const hello = t("notifications.bookkeeper.hello");
  const intro = t("notifications.bookkeeper.intro", values);
  const why = t("notifications.bookkeeper.why", values);
  const files = input.attachments.map((file) => file.fileName);
  return {
    subject: t("notifications.bookkeeper.subject", values),
    text: `${hello}\n\n${intro}\n\n${files.map((name) => `- ${name}`).join("\n")}\n\n${why}\n`,
    html: `<p>${escapeHtml(hello)}</p><p>${escapeHtml(intro)}</p><ul>${files
      .map((name) => `<li>${escapeHtml(name)}</li>`)
      .join(
        "",
      )}</ul><p style="margin-top: 32px; font-size: 13px; line-height: 1.5; opacity: 0.75;">${escapeHtml(why)}</p>`,
  };
}
