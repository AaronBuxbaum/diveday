import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import { escapeHtml } from "@/lib/html";
import { firstNameOf } from "@/lib/person-name";
import type { NotificationEmail } from "./email";

// i18n-exempt-file: the terminal renderer for the gift mail (issue #4629), on
// the same footing as `./course-certified.ts`: no React component picks words
// for a sent message, so this resolves its own text through `diverTranslator`
// in the recipient's locale, and every dynamic value is escaped for the html
// body.

export type PackageGiftMessageInput = {
  locale: DiverLocale;
  recipientName: string;
  buyerName: string;
  shopName: string;
  packageName: string;
  diveCount: number;
  /** The shop's schedule, when there is a public origin to build it on. */
  bookUrl?: string;
};

/**
 * "Ana gave you 10 dives at Blue Mantis". The dives are already on the
 * recipient's email, so the mail says so and points at the schedule; there is
 * nothing to claim.
 */
export function packageGiftEmail(input: PackageGiftMessageInput): NotificationEmail {
  const t = diverTranslator(input.locale);
  const firstName = firstNameOf(input.recipientName, t("notifications.common.genericName"));
  const giver = firstNameOf(input.buyerName, input.buyerName);
  const facts = {
    firstName,
    giver,
    shopName: input.shopName,
    packageName: input.packageName,
    count: input.diveCount,
  };
  const body = t("notifications.packageGift.body", facts);
  const ready = t("notifications.packageGift.ready", facts);
  const book = input.bookUrl ? t("notifications.packageGift.book", facts) : null;
  return {
    subject: t("notifications.packageGift.subject", facts),
    text: `${body}\n\n${ready}${book && input.bookUrl ? `\n\n${book}\n${input.bookUrl}` : ""}\n`,
    html: `<p>${escapeHtml(body)}</p><p>${escapeHtml(ready)}</p>${
      book && input.bookUrl
        ? `<p><a href="${escapeHtml(input.bookUrl)}">${escapeHtml(book)}</a></p>`
        : ""
    }`,
  };
}
