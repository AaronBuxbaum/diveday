import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import { escapeHtml } from "@/lib/html";
import { firstNameOf } from "@/lib/person-name";
import { emailButton, type NotificationEmail } from "./email";

// i18n-exempt-file: the terminal renderer for the stale-roll-call alert, on the
// same footing as `./desk-emails.ts` — no React component picks words for a
// sent message, so this resolves its own text through `diverTranslator` in the
// recipient's locale. Every dynamic value is escaped for the html body.

export type RollCallStaleEmailInput = {
  locale: DiverLocale;
  recipientName: string;
  shopName: string;
  tripTitle: string;
  diveNumber: number;
  unaccounted: number;
  missing: boolean;
  rollCallUrl: string;
};

/**
 * "The roll call after dive 2 on Two-Tank Reef is still open", and the roll
 * call. A count and a link; who is unaccounted for stays behind the manifest's
 * sign-in (`src/lib/notifications/kinds.ts`).
 */
export function rollCallStaleEmail(input: RollCallStaleEmailInput): NotificationEmail {
  const t = diverTranslator(input.locale);
  const firstName = firstNameOf(input.recipientName, t("notifications.common.genericName"));
  const greetingText = t("notifications.common.greeting", { firstName });
  const greetingHtml = t("notifications.common.greeting", { firstName: escapeHtml(firstName) });
  const values = {
    count: input.unaccounted,
    dive: input.diveNumber,
    tripTitle: input.tripTitle,
  };
  const body = t(
    input.missing ? "notifications.rollCallStale.bodyMissing" : "notifications.rollCallStale.body",
    values,
  );
  const open = t("notifications.rollCallStale.open");
  return {
    subject: t("notifications.rollCallStale.subject", {
      shopName: input.shopName,
      tripTitle: input.tripTitle,
    }),
    text: `${greetingText}\n\n${body}\n\n${open}:\n${input.rollCallUrl}\n`,
    html: `<p>${greetingHtml}</p><p>${escapeHtml(body)}</p>${emailButton(input.rollCallUrl, open)}`,
  };
}
