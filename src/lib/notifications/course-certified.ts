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
   * The course the shop ran, which is what the card says. DiveDay's rung is
   * only a fallback: SSI's Advanced Adventurer sits on the advanced rung, and
   * SSI has a different rating called Advanced Open Water Diver.
   */
  courseTitle?: string;
  /** Under 15 on the recorded date: the card is a Junior card. */
  junior?: boolean;
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
 * "You've finished Open Water Diver, Priya" (fourth review, item 40). The subject is
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
  const shopName = input.shopName;
  const card = [
    input.junior ? t("notifications.courseCertified.junior") : null,
    input.agency && input.agency !== "other"
      ? t("notifications.courseCertified.card", {
          agency: t(DIVER_CERTIFICATION_AGENCY_KEYS[input.agency]),
          shopName,
        })
      : t("notifications.courseCertified.cardAnyAgency", { shopName }),
  ]
    .filter(Boolean)
    .join(" ");
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
    subject: input.courseTitle
      ? t("notifications.courseCertified.subjectCourse", { course: input.courseTitle, firstName })
      : t(
          input.junior
            ? "notifications.courseCertified.subjectJunior"
            : "notifications.courseCertified.subject",
          { code: input.level, firstName },
        ),
    text: `${recorded(input.shopName, date)} ${card}${nextText}\n`,
    html: `<p>${recorded(escapeHtml(input.shopName), escapeHtml(date))} ${escapeHtml(card)}</p>${nextHtml}`,
  };
}

/** The same news as a text. */
export function courseCertifiedText(
  input: Pick<
    CourseCertifiedMessageInput,
    "locale" | "shopName" | "level" | "courseTitle" | "junior"
  >,
): string {
  const t = diverTranslator(input.locale);
  const { shopName } = input;
  const news = input.courseTitle
    ? t("notifications.smsCourseCertified.bodyCourse", { shopName, course: input.courseTitle })
    : t(
        input.junior
          ? "notifications.smsCourseCertified.bodyJunior"
          : "notifications.smsCourseCertified.body",
        { shopName, code: input.level },
      );
  return [
    news,
    input.junior ? t("notifications.courseCertified.junior") : null,
    t("notifications.smsCourseCertified.card", { shopName }),
  ]
    .filter(Boolean)
    .join(" ");
}
