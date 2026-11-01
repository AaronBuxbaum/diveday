import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import { formatDateTimeTz } from "@/lib/format";
import { escapeHtml } from "@/lib/html";
import { emailButton, type NotificationEmail } from "./email";
import { notificationGreeting } from "./greeting";

// i18n-exempt-file: the terminal renderer for the missing-diver alert, on the
// same footing as `./roll-call-emails.ts` — no React component picks words for
// a sent message, so this resolves its own text through `diverTranslator` in
// the recipient's locale. Every dynamic value is escaped for the html body.

export type IncidentMissingDiverEmailInput = {
  locale: DiverLocale;
  recipientName: string;
  shopName: string;
  tripTitle: string;
  /** When it happened, per the report. */
  reportedAt: Date;
  timezone: string;
  reportUrl: string;
  /** The shop's emergency reference, for the call that comes first. */
  emergencyUrl: string;
};

/**
 * To each owner when a report of kind "missing diver" is filed (H-142): that
 * one was reported on this departure and when, and a button to the report
 * behind the staff sign-in. Nothing about who, how serious or what happened.
 */
export function incidentMissingDiverEmail(
  input: IncidentMissingDiverEmailInput,
): NotificationEmail {
  const t = diverTranslator(input.locale);
  const { text: greetingText, html: greetingHtml } = notificationGreeting(t, input.recipientName);
  const body = t("notifications.incidentMissingDiver.body", {
    tripTitle: input.tripTitle,
    when: formatDateTimeTz(input.reportedAt, input.locale, input.timezone),
  });
  const open = t("notifications.incidentMissingDiver.open");
  const emergency = t("notifications.incidentMissingDiver.emergency");
  return {
    subject: t("notifications.incidentMissingDiver.subject", {
      shopName: input.shopName,
      tripTitle: input.tripTitle,
    }),
    text: `${greetingText}\n\n${body}\n\n${open}:\n${input.reportUrl}\n\n${emergency}:\n${input.emergencyUrl}\n`,
    html: `<p>${greetingHtml}</p><p>${escapeHtml(body)}</p>${emailButton(input.reportUrl, open)}<p><a href="${escapeHtml(input.emergencyUrl)}">${escapeHtml(emergency)}</a></p>`,
  };
}

export type IncidentMissingDiverFoundEmailInput = {
  locale: DiverLocale;
  recipientName: string;
  shopName: string;
  tripTitle: string;
  /** When the crew marked the diver found. */
  foundAt: Date;
  /** Others on this departure still reported missing. */
  stillMissing: number;
  timezone: string;
  reportUrl: string;
};

/**
 * The all-clear (issue #2694): to each owner the alert told, once, when the
 * diver is marked found. The fact, when, and the report; nobody named.
 */
export function incidentMissingDiverFoundEmail(
  input: IncidentMissingDiverFoundEmailInput,
): NotificationEmail {
  const t = diverTranslator(input.locale);
  const { text: greetingText, html: greetingHtml } = notificationGreeting(t, input.recipientName);
  const body = t("notifications.incidentMissingDiverFound.body", {
    tripTitle: input.tripTitle,
    when: formatDateTimeTz(input.foundAt, input.locale, input.timezone),
  });
  const still =
    input.stillMissing > 0
      ? ` ${t("notifications.incidentMissingDiverFound.stillMissing", { count: input.stillMissing })}`
      : "";
  const open = t("notifications.incidentMissingDiver.open");
  return {
    subject: t("notifications.incidentMissingDiverFound.subject", {
      shopName: input.shopName,
      tripTitle: input.tripTitle,
    }),
    text: `${greetingText}\n\n${body}${still}\n\n${open}:\n${input.reportUrl}\n`,
    html: `<p>${greetingHtml}</p><p>${escapeHtml(body + still)}</p>${emailButton(input.reportUrl, open)}`,
  };
}
