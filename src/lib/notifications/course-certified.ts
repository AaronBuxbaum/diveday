import { diverTranslator } from "@/i18n/messages";
import { DIVER_CERTIFICATION_LEVEL_KEYS } from "@/i18n/readiness-labels";
import type { DiverLocale } from "@/i18n/settings";
import type { CertificationLevel } from "@/lib/certification-levels";
import { formatShortDate } from "@/lib/format";
import { escapeHtml } from "@/lib/html";
import { firstNameOf } from "@/lib/person-name";
import type { NotificationEmail } from "./email";

// i18n-exempt-file: the terminal renderer for the certification message (third
// UX review, item 14), on the same footing as `./desk-notes.ts`: no React
// component picks words for a sent message, so this resolves its own text
// through `diverTranslator` in the recipient's locale, and every dynamic value
// is escaped for the html body.

export type CourseCertifiedMessageInput = {
  locale: DiverLocale;
  diverName: string;
  shopName: string;
  level: CertificationLevel;
  /** When the instructor tapped Certify. */
  recordedAt: Date;
  timezone: string;
  /** The shop's next public course on from this level, when it has one. */
  nextCourse?: { title: string; url: string };
};

/** "You're certified: Open Water. Blue Mantis Divers recorded it on Oct 25." */
export function courseCertifiedEmail(input: CourseCertifiedMessageInput): NotificationEmail {
  const t = diverTranslator(input.locale);
  const firstName = firstNameOf(input.diverName, t("notifications.common.genericName"));
  const level = t(DIVER_CERTIFICATION_LEVEL_KEYS[input.level]);
  const date = formatShortDate(input.recordedAt, input.locale, input.timezone);
  const body = t("notifications.courseCertified.body", {
    level,
    shopName: input.shopName,
    date,
  });
  const bodyHtml = t("notifications.courseCertified.body", {
    level: `<strong>${escapeHtml(level)}</strong>`,
    shopName: escapeHtml(input.shopName),
    date: escapeHtml(date),
  });
  const next = input.nextCourse;
  const nextText = next
    ? `\n\n${t("notifications.courseCertified.next", { course: next.title })}\n${next.url}`
    : "";
  const nextHtml = next
    ? `<p><a href="${escapeHtml(next.url)}">${escapeHtml(
        t("notifications.courseCertified.next", { course: next.title }),
      )}</a></p>`
    : "";
  return {
    subject: t("notifications.courseCertified.subject", { level }),
    text: `${t("notifications.common.greeting", { firstName })}\n\n${body}${nextText}\n`,
    html: `<p>${t("notifications.common.greeting", { firstName: escapeHtml(firstName) })}</p><p>${bodyHtml}</p>${nextHtml}`,
  };
}

/** The same news as a text: one line. */
export function courseCertifiedText(
  input: Pick<CourseCertifiedMessageInput, "locale" | "shopName" | "level">,
): string {
  const t = diverTranslator(input.locale);
  return t("notifications.smsCourseCertified.body", {
    shopName: input.shopName,
    level: t(DIVER_CERTIFICATION_LEVEL_KEYS[input.level]),
  });
}
