import type { CertificationAgency } from "@/db/schema";
import { diverTranslator } from "@/i18n/messages";
import { DIVER_CERTIFICATION_AGENCY_KEYS } from "@/i18n/readiness-labels";
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
  /**
   * The course's agency, which issues the card. Absent, or "other", the
   * message says "your training agency" rather than naming one it does not know.
   */
  agency?: CertificationAgency;
  /** When the instructor tapped Certify. */
  recordedAt: Date;
  timezone: string;
  /** The shop's next public course on from this level, when it has one. */
  nextCourse?: { title: string; url: string };
};

/**
 * "You're an Open Water Diver, Priya" (fourth review, item 40). The subject is
 * the news, said once; the body answers the new diver's first question, where
 * the card comes from, and then points at the next course. It used to say
 * "You're certified: Open Water" in the subject and again in the body, a
 * receipt for the one moment of joy the diver side has.
 */
export function courseCertifiedEmail(input: CourseCertifiedMessageInput): NotificationEmail {
  const t = diverTranslator(input.locale);
  const firstName = firstNameOf(input.diverName, t("notifications.common.genericName"));
  const date = formatShortDate(input.recordedAt, input.locale, input.timezone);
  const recorded = (shopName: string, when: string) =>
    t("notifications.courseCertified.recorded", { shopName, date: when });
  const card =
    input.agency && input.agency !== "other"
      ? t("notifications.courseCertified.card", {
          agency: t(DIVER_CERTIFICATION_AGENCY_KEYS[input.agency]),
        })
      : t("notifications.courseCertified.cardAnyAgency");
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
    subject: t("notifications.courseCertified.subject", { code: input.level, firstName }),
    text: `${recorded(input.shopName, date)} ${card}${nextText}\n`,
    html: `<p>${recorded(escapeHtml(input.shopName), escapeHtml(date))} ${escapeHtml(card)}</p>${nextHtml}`,
  };
}

/** The same news as a text: one line. */
export function courseCertifiedText(
  input: Pick<CourseCertifiedMessageInput, "locale" | "shopName" | "level">,
): string {
  const t = diverTranslator(input.locale);
  return t("notifications.smsCourseCertified.body", {
    shopName: input.shopName,
    code: input.level,
  });
}
