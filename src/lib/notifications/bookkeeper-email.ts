import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import { monthLabel, parseMonthKey } from "@/lib/calendar";
import { formatDateTimeTz } from "@/lib/format";
import { escapeHtml } from "@/lib/html";
import { firstNameOf } from "@/lib/person-name";
import { emailButton, type NotificationEmail } from "./email";

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
  stopUrl: string;
  attachments: readonly { fileName: string }[];
};

/**
 * "October 2026 at Blue Mantis Divers: the month's report, orders and crew
 * sheet are attached." The files are the message; the body names them and
 * says how the address got here and gives the reader's own stop link, since
 * they are not the shop's customer and hold no account.
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
  const stop = t("notifications.bookkeeper.stop");
  const files = input.attachments.map((file) => file.fileName);
  return {
    subject: t("notifications.bookkeeper.subject", values),
    text: `${hello}\n\n${intro}\n\n${files.map((name) => `- ${name}`).join("\n")}\n\n${why}\n${stop}:\n${input.stopUrl}\n`,
    html: `<p>${escapeHtml(hello)}</p><p>${escapeHtml(intro)}</p><ul>${files
      .map((name) => `<li>${escapeHtml(name)}</li>`)
      .join(
        "",
      )}</ul><p style="margin-top: 32px; font-size: 13px; line-height: 1.5; opacity: 0.75;">${escapeHtml(why)} <a href="${escapeHtml(input.stopUrl)}">${escapeHtml(stop)}</a></p>`,
  };
}

export type BookkeeperConfirmationInput = {
  locale: DiverLocale;
  shopName: string;
  confirmUrl: string;
  expiresAt: Date;
  timezone: string;
};

/**
 * The link a bookkeeper's address gets before any file goes to it (security
 * review B1). No files: what agreeing means, the button, and that ignoring it
 * sends nothing.
 */
export function bookkeeperConfirmationEmail(input: BookkeeperConfirmationInput): NotificationEmail {
  const t = diverTranslator(input.locale);
  const values = { shopName: input.shopName };
  const body = t("notifications.bookkeeperConfirmation.body", values);
  const confirm = t("notifications.bookkeeperConfirmation.confirm");
  const expiry = t("notifications.bookkeeperConfirmation.expiry", {
    expiresAt: formatDateTimeTz(input.expiresAt, input.locale, input.timezone),
  });
  return {
    subject: t("notifications.bookkeeperConfirmation.subject", values),
    text: `${body}\n\n${confirm}:\n${input.confirmUrl}\n\n${expiry}\n`,
    html: `<p>${escapeHtml(body)}</p>${emailButton(input.confirmUrl, confirm)}<p>${escapeHtml(expiry)}</p>`,
  };
}

export type BookkeeperNoticeInput = {
  locale: DiverLocale;
  recipientName: string | null;
  shopName: string;
  reportsUrl: string;
  event: "set" | "changed" | "vouched" | "cleared" | "confirmed" | "sent" | "bounced";
  by?: "recipient" | "erasure" | undefined;
  email?: string | undefined;
  actorName?: string | undefined;
  month?: string | undefined;
};

/**
 * To each owner (security review B1 and F1): one line on what happened to the
 * bookkeeper's address, or where this month's files went, and the way to
 * Reports to change it. A stop by the bookkeeper and an erasure each say so,
 * and so do month-end files that bounced (issue #2798).
 */
export function bookkeeperNoticeEmail(input: BookkeeperNoticeInput): NotificationEmail {
  const t = diverTranslator(input.locale);
  const generic = t("notifications.common.genericName");
  const firstName = input.recipientName ? firstNameOf(input.recipientName, generic) : generic;
  const greetingText = t("notifications.common.greeting", { firstName });
  const greetingHtml = t("notifications.common.greeting", { firstName: escapeHtml(firstName) });
  const ref = input.month ? parseMonthKey(input.month) : null;
  const values = {
    shopName: input.shopName,
    email: input.email ?? "",
    actor: input.actorName ?? t("notifications.common.genericName"),
    month: ref ? monthLabel(ref, input.locale) : (input.month ?? ""),
  };
  const line =
    input.event === "cleared" && input.by === "recipient"
      ? "clearedByRecipient"
      : input.event === "cleared" && input.by === "erasure"
        ? "clearedByErasure"
        : input.event;
  const body = t(`notifications.bookkeeperNotice.${line}`, values);
  const open = t("notifications.bookkeeperNotice.open");
  return {
    subject: t(`notifications.bookkeeperNotice.subject.${input.event}`, values),
    text: `${greetingText}\n\n${body}\n\n${open}:\n${input.reportsUrl}\n`,
    html: `<p>${greetingHtml}</p><p>${escapeHtml(body)}</p>${emailButton(input.reportsUrl, open)}`,
  };
}
