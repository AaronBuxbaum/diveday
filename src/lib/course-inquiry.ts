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

export type CourseInquiry = {
  courseTitle: string;
  shopName: string;
  /** Who is writing. Blank until they type it; the message reads fine without. */
  name: string;
  /** Free prose — "the week of 12 August", "any weekend in the autumn". */
  timing: string;
  /** How many people, including the writer. */
  divers: number;
  /** Where they are up to, from COURSE_INQUIRY_EXPERIENCE. */
  experience: string;
  /** Anything else they want to say. */
  message: string;
};

/**
 * The one question whose answer changes what the shop replies: it decides
 * whether this is an enrollment, a referral to an earlier course, or a card
 * the desk needs to see first. Free text would be prose to interpret; these
 * are the four answers that actually route the email.
 */
export const COURSE_INQUIRY_EXPERIENCE = [
  "I have never dived before",
  "I have tried scuba once, but I am not certified",
  "I am certified, and I have my card",
  "I am certified, but it has been a while",
] as const;

const NOT_SAID = "Not said";

/** Trimmed, or a placeholder — never an empty line the shop has to decode. */
function said(value: string): string {
  return value.trim() || NOT_SAID;
}

export function courseInquirySubject(inquiry: Pick<CourseInquiry, "courseTitle">): string {
  return `Course inquiry: ${inquiry.courseTitle.trim()}`;
}

/**
 * The message body. Plain text with one fact per line, because the shop reads
 * this on a phone between boats: the answers first, in a fixed order, and the
 * diver's own words last where a long paragraph cannot bury them.
 */
export function courseInquiryBody(inquiry: CourseInquiry): string {
  const name = inquiry.name.trim();
  const lines = [
    `Hello ${inquiry.shopName.trim()},`,
    "",
    `I would like to take the ${inquiry.courseTitle.trim()} course.`,
    "",
    `When: ${said(inquiry.timing)}`,
    `How many divers: ${inquiry.divers}`,
    `Experience so far: ${said(inquiry.experience)}`,
  ];
  const note = inquiry.message.trim();
  if (note) lines.push("", note);
  // An unsigned message is a message the diver has not finished, not a field
  // the shop failed to receive — so the sign-off simply stops, rather than
  // signing itself "Not said".
  lines.push("", "Thank you,");
  if (name) lines.push(name);
  return lines.join("\n");
}

/**
 * A mailto: URL the browser hands to the diver's mail client.
 *
 * Newlines and every other reserved character go through encodeURIComponent —
 * a raw newline in a mailto truncates the body at the first line in some
 * clients, which would send the shop a greeting and nothing else.
 */
export function courseInquiryMailto(to: string, inquiry: CourseInquiry): string {
  const query = new URLSearchParams({
    subject: courseInquirySubject(inquiry),
    body: courseInquiryBody(inquiry),
  });
  // URLSearchParams encodes spaces as "+", which mail clients render literally
  // in a subject line; mailto wants percent-encoding throughout.
  return `mailto:${encodeURIComponent(to.trim())}?${query.toString().replace(/\+/g, "%20")}`;
}

/** Digits only, so a printed number like "+1 (305) 555-0134" still dials. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}
