import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import { type CalendarDate, formatCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { deskTimeOn } from "@/lib/desk-hours";
import { displayStoredPhone } from "@/lib/forgiving-fields";
import { formatTime } from "@/lib/format";
import { escapeHtml } from "@/lib/html";
import type { NotificationEmail } from "./email";

// i18n-exempt-file: the terminal renderer for a date request's acknowledgment
// (third UX review, item 13), on the same footing as `./desk-notes.ts`: it
// resolves its own text through `diverTranslator` in the recipient's locale
// and escapes every dynamic value for the html body.

export type CourseInquiryReceivedInput = {
  locale: DiverLocale;
  shopName: string;
  /** The course the request named, in the shop's own words; absent for a dive request. */
  courseTitle?: string;
  preferredDate?: CalendarDate;
  alternateDate?: CalendarDate;
  /** The shop's own number, when it lists one. */
  shopPhone?: string;
  /** The desk's hours, only once the shop has confirmed them. */
  deskHours?: { opensMinute: number; closesMinute: number };
  timezone: string;
};

/**
 * "We have your request", in the shop's voice: what they asked about, the
 * dates they named, and how to reach the shop sooner.
 *
 * **Nothing the diver typed is echoed back.** The address is unverified and
 * the form is public, so a name, an interest or a message here would let a
 * stranger send any text to any inbox under a shop's name. Only the shop's
 * own words (the course title, its phone, its hours) and the two dates, which
 * are parsed calendar days, reach the message.
 */
export function courseInquiryReceivedEmail(input: CourseInquiryReceivedInput): NotificationEmail {
  const t = diverTranslator(input.locale);
  const lines: string[] = [];
  lines.push(
    input.courseTitle
      ? t("notifications.inquiryReceived.course", { course: input.courseTitle })
      : t("notifications.inquiryReceived.dive"),
  );
  if (input.preferredDate) {
    const first = formatCalendarDate(input.preferredDate, input.locale);
    lines.push(
      input.alternateDate
        ? t("notifications.inquiryReceived.datesTwo", {
            date: first,
            alternate: formatCalendarDate(input.alternateDate, input.locale),
          })
        : t("notifications.inquiryReceived.dateOne", { date: first }),
    );
  }
  lines.push(t("notifications.inquiryReceived.reply"));
  if (input.shopPhone) {
    lines.push(
      t("notifications.inquiryReceived.call", { phone: displayStoredPhone(input.shopPhone) }),
    );
  }
  if (input.deskHours) {
    const now = nowDate();
    const at = (minute: number) =>
      formatTime(deskTimeOn(minute, now, input.timezone), input.locale, input.timezone);
    lines.push(
      t("shopChrome.deskHours", {
        opens: at(input.deskHours.opensMinute),
        closes: at(input.deskHours.closesMinute),
      }),
    );
  }
  const subject = t("notifications.inquiryReceived.subject", { shopName: input.shopName });
  return {
    subject,
    text: `${lines.join("\n\n")}\n`,
    html: lines.map((line) => `<p>${escapeHtml(line)}</p>`).join(""),
  };
}
