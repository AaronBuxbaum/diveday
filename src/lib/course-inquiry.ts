import type { DiverMessageKey } from "@/i18n/messages";

/**
 * The "get in touch" composer behind a course page.
 *
 * A diver who cannot find a date that works has, until now, been told to "get
 * in touch" and left to write the email themselves — which means the shop
 * receives "hi do you run open water in august?" and spends two round trips
 * asking who, how many, and when. This module turns the four answers a shop
 * always ends up asking for into a message the diver sends from their own mail
 * client.
 *
 * Deliberately a mailto composer and not a send: the message leaves from the
 * diver's own address, so the shop can simply reply, the thread lives in the
 * diver's sent mail, and a public page gains no unauthenticated send button for
 * a spammer to point at the shop.
 */

/**
 * The one question whose answer changes what the shop replies: it decides
 * whether this is an enrollment, a referral to an earlier course, or a card
 * the desk needs to see first. Free text would be prose to interpret; these
 * are the four answers that actually route the email. A code, not a sentence —
 * the reader's own wording lives in `COURSE_INQUIRY_EXPERIENCE_KEYS` below,
 * resolved at the point this composes into the message.
 */
export type CourseInquiryExperience = "never" | "tried" | "certified" | "lapsed";

export const COURSE_INQUIRY_EXPERIENCE: readonly CourseInquiryExperience[] = [
  "never",
  "tried",
  "certified",
  "lapsed",
] as const;

/** Where each experience code's sentence lives in the diver bundle. */
export const COURSE_INQUIRY_EXPERIENCE_KEYS: Record<CourseInquiryExperience, DiverMessageKey> = {
  never: "inquiry.experience.never",
  tried: "inquiry.experience.tried",
  certified: "inquiry.experience.certified",
  lapsed: "inquiry.experience.lapsed",
};

export type CourseInquiry = {
  courseTitle: string;
  shopName: string;
  /** Who is writing. Blank until they type it; the message reads fine without. */
  name: string;
  /**
   * Free prose, as exact or as loose as the diver wants — "12 August", "the
   * week of the 12th", "any weekend this autumn". One field rather than a
   * date picker beside it: a date the diver types here is a *request*, never
   * a booking (no seat exists on it and nothing is held), so a picker only
   * ever promised a precision the answer does not have.
   */
  timing: string;
  /** How many people, including the writer. Defaults to one, the commonest
   *  answer by far; a diver bringing friends types over it. */
  divers: number | null;
  /** Where they are up to, or "" until they pick one. */
  experience: CourseInquiryExperience | "";
  /** Anything else they want to say. */
  message: string;
};

/**
 * The one call signature both the server-side `DiverTranslator` and the
 * client-side `useTranslations()` result satisfy — this module composes the
 * message in either context (the subject/body redraw on every keystroke, so
 * they run in the Client Component, under `DiverIntlProvider`) without
 * importing either translator type and coupling to one call site.
 */
export type CourseInquiryTranslate = (
  key: DiverMessageKey,
  params?: Record<string, string | number>,
) => string;

/**
 * The subject line: one ICU template with a single named placeholder — never
 * string concatenation, so a translation can reorder "Course inquiry" and the
 * title however the target language reads best.
 */
export function courseInquirySubject(
  t: CourseInquiryTranslate,
  inquiry: Pick<CourseInquiry, "courseTitle">,
): string {
  return t("inquiry.subject", { courseTitle: inquiry.courseTitle.trim() });
}

/**
 * The message body. Plain text with one fact per line, because the shop reads
 * this on a phone between boats: the answers first, in a fixed order, and the
 * diver's own words last where a long paragraph cannot bury them.
 *
 * The whole body is one ICU template (`inquiry.body`) — the note and the
 * sign-off name are each an ICU `select` branch keyed by a `hasNote`/`hasName`
 * flag, so a missing optional field removes its own blank line instead of
 * leaving one for the shop to puzzle over. Every value handed to the template
 * is already a finished word (the experience option and the "Not said"
 * placeholder are resolved through their own keys first) — the template never
 * receives a raw code.
 */
export function courseInquiryBody(t: CourseInquiryTranslate, inquiry: CourseInquiry): string {
  const name = inquiry.name.trim();
  const timing = inquiry.timing.trim();
  const note = inquiry.message.trim();
  const notSaid = t("inquiry.notSaid");
  const experience = inquiry.experience
    ? t(COURSE_INQUIRY_EXPERIENCE_KEYS[inquiry.experience])
    : notSaid;
  return t("inquiry.body", {
    shopName: inquiry.shopName.trim(),
    courseTitle: inquiry.courseTitle.trim(),
    timing: timing || notSaid,
    divers: inquiry.divers ?? notSaid,
    experience,
    hasNote: note ? "yes" : "no",
    note,
    hasName: name ? "yes" : "no",
    name,
  });
}

/**
 * A mailto: URL the browser hands to the diver's mail client.
 *
 * Newlines and every other reserved character go through encodeURIComponent —
 * a raw newline in a mailto truncates the body at the first line in some
 * clients, which would send the shop a greeting and nothing else.
 */
export function courseInquiryMailto(
  t: CourseInquiryTranslate,
  to: string,
  inquiry: CourseInquiry,
): string {
  const query = new URLSearchParams({
    subject: courseInquirySubject(t, inquiry),
    body: courseInquiryBody(t, inquiry),
  });
  // URLSearchParams encodes spaces as "+", which mail clients render literally
  // in a subject line; mailto wants percent-encoding throughout.
  return `mailto:${encodeURIComponent(to.trim())}?${query.toString().replace(/\+/g, "%20")}`;
}

/** Digits only, so a printed number like "+1 (305) 555-0134" still dials. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}
