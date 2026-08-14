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
    heading: subject === "course" ? t("inquiry.getInTouch") : t("inquiry.requestDateHeading"),
    intro: subject === "course" ? t("inquiry.noDateBody") : t("inquiry.requestDateBody"),
    whatToDive: t("inquiry.whatToDive"),
    whatToDivePlaceholder: t("inquiry.whatToDivePlaceholder"),
    yourName: t("inquiry.yourName"),
    namePlaceholder: t("inquiry.namePlaceholder"),
    yourEmail: t("inquiry.yourEmail"),
    emailPlaceholder: t("inquiry.emailPlaceholder"),
    yourPhone: t("inquiry.yourPhone"),
    phonePlaceholder: t("inquiry.phonePlaceholder"),
    howManyDivers: t("inquiry.howManyDivers"),
    optional: t("common.optional"),
    required: t("inquiry.required"),
    orPhone: t("inquiry.orPhone"),
    orEmail: t("inquiry.orEmail"),
    preferredDate: t("inquiry.preferredDate"),
    alternateDate: t("inquiry.alternateDate"),
    datesHint: t("inquiry.datesHint"),
    dateFlexible: t("inquiry.dateFlexible"),
    whenSuits: t("inquiry.whenSuits"),
    whenSuitsHint: t("inquiry.whenSuitsHint"),
    whenSuitsPlaceholder: t("inquiry.whenSuitsPlaceholder"),
    whereYouAreUpTo: t("inquiry.whereYouAreUpTo"),
    chooseOne: t("inquiry.chooseOne"),
    anythingElse: t("inquiry.anythingElse"),
    messagePlaceholder: t("inquiry.messagePlaceholder"),
    orWriteTo: t("inquiry.orWriteTo"),
    callLabel: t("inquiry.callLabel"),
    send: t("inquiry.send"),
    sending: t("inquiry.sending"),
    sentHeading: t("inquiry.sentHeading"),
    sentBody: t("inquiry.sentBody"),
  };
}
