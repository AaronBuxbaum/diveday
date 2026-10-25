import type { DateRequestCopy } from "@/lib/course-inquiry";
import type { DiverTranslator } from "./messages";

/**
 * Every word `DateRequestForm` renders, resolved once for both surfaces that
 * mount it.
 *
 * The component is a Client Component and takes its copy as props, so the words
 * are picked on the server — and picked in exactly one place, because the two
 * callers (a course page and the shop's schedule page) differ in their heading
 * and opening line and in nothing else. Two hand-written copy blocks of thirty
 * keys each is how one of them ends up a field behind the other.
 */
export function dateRequestCopy(t: DiverTranslator, subject: "course" | "dive"): DateRequestCopy {
  return {
    // A course's form has one heading and one lead line, the question the
    // dates panel used to end on (visual review 2026-10-24, B37).
    heading: subject === "course" ? t("inquiry.askAboutCourse") : t("inquiry.requestDateHeading"),
    intro:
      subject === "course" ? t("course.requestDifferentDateLead") : t("inquiry.requestDateBody"),
    whatToDive: t("inquiry.whatToDive"),
    whatToDivePlaceholder: t("inquiry.whatToDivePlaceholder"),
    yourName: t("inquiry.yourName"),
    namePlaceholder: t("inquiry.namePlaceholder"),
    yourEmail: t("inquiry.yourEmail"),
    emailPlaceholder: t("inquiry.emailPlaceholder"),
    yourPhone: t("inquiry.yourPhone"),
    phonePlaceholder: t("inquiry.phonePlaceholder"),
    howManyDivers: t("inquiry.howManyDivers"),
    contactHint: t("inquiry.contactHint"),
    dateOptionsHeading: t("inquiry.dateOptionsHeading"),
    preferredDate: t("inquiry.preferredDate"),
    alternateDate: t("inquiry.alternateDate"),
    whenSuits: t("inquiry.whenSuits"),
    whenSuitsPlaceholder: t("inquiry.whenSuitsPlaceholder"),
    moreDetails: t("inquiry.moreDetails"),
    whereYouAreUpTo: t("inquiry.whereYouAreUpTo"),
    chooseOne: t("inquiry.chooseOne"),
    anythingElse: t("inquiry.anythingElse"),
    messagePlaceholder: t("inquiry.messagePlaceholder"),
    orWriteTo: t("inquiry.orWriteTo"),
    callLabel: t("inquiry.callLabel"),
    orCall: t("inquiry.orCall"),
    send: t("inquiry.send"),
    sending: t("inquiry.sending"),
    sentHeading: t("inquiry.sentHeading"),
    sentBody: t("inquiry.sentBody"),
  };
}
