import { diverTranslator } from "@/i18n/messages";
import { reminderActionText } from "@/i18n/reminder-labels";
import type { DiverLocale } from "@/i18n/settings";
import type { CourseLearningMaterial } from "@/lib/courses";
import { formatShortDate, formatTimeRangeTz } from "@/lib/format";
import type { MeetingPoint } from "@/lib/meeting-point";
import type { ReminderActionCode } from "@/lib/readiness-summary";
import { type BriefConditions, type BriefUnits, forecastText } from "./night-before-brief";

// i18n-exempt-file: the terminal renderer for the trip-reminder text, on the
// same footing as `./desk-notes.ts`.

/** The night-before brief's conditions line, in the diver's language; null when the crew wrote none. */
export function reminderForecast(
  locale: DiverLocale,
  conditions: BriefConditions,
  units: BriefUnits,
): string | null {
  return forecastText(diverTranslator(locale), locale, conditions, units);
}

/**
 * A short text; the email carries the full detail and the link. The night-before
 * (day) lead adds the plain-language conditions line and who to text, the SMS
 * half of the confidence arc — kept compact so it stays a single readable text.
 * Resolved against the recipient's own locale, the same as the email that
 * accompanies it (docs ADR 20260731-per-person-notification-locale) — no
 * downstream renderer picks words for a sent text, so this terminal renderer
 * composes its own (docs ADR 20260731-notification-locale);
 * `src/features/reminders/store.ts` decides who is reminded and hands over the facts.
 */
export function reminderSmsBody(
  locale: DiverLocale,
  input: {
    shopName: string;
    tripTitle: string;
    startsAt: Date;
    endsAt: Date;
    timezone: string;
    lead: "week" | "day";
    dockCallMinutes: number;
    outstanding: ReminderActionCode[];
    medicalReview: boolean;
    forecast?: string | null;
    whoToText?: string | null;
    /** Whether this body may end with the reply line (ADR 20260909-reply-keywords). */
    replyKeywords?: boolean;
    /**
     * Unfinished course materials (ADR 20261008-course-learning-materials).
     * Their own clause under the materials heading, never the boarding to-do:
     * the eLearning is not something the boat checks.
     */
    materials?: CourseLearningMaterial[];
    /** A course session: it starts rather than sails, and names no dock. */
    courseSession?: boolean;
    /**
     * The departure's dive mode (`trips.dive_mode`). Only a boat leaves
     * without anyone, so only a boat's day-before text teaches LATE.
     */
    diveMode?: "boat" | "shore" | "pool";
    /**
     * Where to go, short form: the label and the address, no landmark or
     * parking (ux review 2026-10-11, item 4). The email carries the rest.
     */
    meetingPoint?: MeetingPoint;
    /**
     * The diver's own trip prep (ux review 2026-10-11, item 6): a phone-only
     * diver had no way to reach the page that says what is left.
     */
    readinessUrl?: string;
  },
): string {
  const t = diverTranslator(locale);
  const when =
    input.lead === "week" ? t("notifications.sms.whenWeek") : t("notifications.sms.whenDay");
  const date = formatShortDate(input.startsAt, locale, input.timezone);
  const time = formatTimeRangeTz(input.startsAt, input.endsAt, locale, input.timezone);
  const conditions =
    input.lead === "day" && input.forecast
      ? ` ${t("notifications.brief.conditionsLabel")} ${input.forecast}`
      : "";
  // Name the diver's own outstanding items rather than a generic nudge.
  const todo = input.outstanding.map((code) => reminderActionText(t, code));
  if (input.medicalReview) todo.push(t("notifications.sms.medicalReviewNote"));
  const todoText = todo.length
    ? ` ${t("notifications.common.outstandingHeading")} ${todo.join("; ")}.`
    : "";
  // A phone-only student has no email to click through, so the text carries
  // the first material's own https link. The readiness link has its own clause
  // below, once, for every diver.
  const materials = input.materials ?? [];
  const names = materials.map((material) => material.name).join("; ");
  const firstLink = materials.find((material) => material.url)?.url;
  const materialsText =
    materials.length === 0
      ? ""
      : ` ${
          firstLink
            ? t("notifications.sms.materialsWithLink", { names, url: firstLink })
            : t("notifications.sms.materials", { names })
        }`;
  const meet = input.meetingPoint
    ? ` ${t("trip.calendarMeetingPoint", {
        place: [input.meetingPoint.label, input.meetingPoint.address].filter(Boolean).join(", "),
      })}`
    : "";
  // **Measured for #2449 (2026-10-15), no short link built.** The week-ahead
  // text for the demo's reef and night boats is ~304 characters before this
  // clause, and UCS-2 (the "—" in a trip title and the "–" in the time range
  // are outside GSM-7): 5 segments at 67 each. The full link adds ~86
  // characters (6 segments); a short redirect would still be 6. The link is
  // not what makes the text long, so a second bearer-URL shape (`/r/<id>`) buys
  // nothing here. The lever, if the segment cost matters, is the text's own
  // characters, not the link.
  // The same capability the email's button carries, minted once per reminder:
  // it goes only to this seat's own phone, as the email goes to its own inbox.
  const ready = input.readinessUrl
    ? ` ${t("notifications.sms.readyLink", { url: input.readinessUrl })}`
    : "";
  const contact =
    input.lead === "day" && input.whoToText
      ? ` ${t("notifications.sms.contact", { phone: input.whoToText })}`
      : "";
  const body = input.courseSession
    ? t("notifications.sms.courseBody", {
        shopName: input.shopName,
        tripTitle: input.tripTitle,
        when,
        date,
        time,
      })
    : t("notifications.sms.body", {
        shopName: input.shopName,
        tripTitle: input.tripTitle,
        when,
        date,
        time,
        minutes: input.dockCallMinutes,
      });
  // **The night-before brief's text teaches LATE** (J3): both of the channels a text can
  // leave on hear it — WhatsApp through the reply keywords, platform SMS
  // through `/api/webhooks/sms` — and the morning of a boat is the one time a
  // diver needs it. Only on a boat (`dive_mode`), whatever else it is: a
  // shore or pool day has no departure to hold, and a course session at sea
  // does.
  const late =
    input.lead === "day" && input.diveMode === "boat"
      ? ` ${t("notifications.replyKeyword.lateOffer")}`
      : "";
  // Last, and only on a channel that can hear the answer.
  const keywords = input.replyKeywords ? ` ${t("notifications.replyKeyword.offer")}` : "";
  return `${body}${conditions}${meet}${todoText}${materialsText}${ready}${contact}${late}${keywords}`;
}
