import type { DiverMessageKey } from "@/i18n/messages";

/**
 * The "get in touch" composer behind a course page.
 *
 * A diver who cannot find a date that works was once told to "get in touch"
 * and left to write the email themselves — which means the shop receives "hi
 * do you run open water in august?" and spends two round trips asking who, how
 * many, and when. This module holds the shape of the four answers a shop
 * always ends up asking for, so the composer can collect them once.
 *
 * It used to compose a `mailto:` from them as well, so the message left from
 * the diver's own address. That has gone with the buttons that carried it
 * (`CourseInquiry.tsx`): the form records the inquiry against the course and
 * notifies the shop, which is strictly more than a draft in an app the diver
 * may never have configured. Codes and shapes only now — no prose, and no URL
 * building.
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

/** Digits only, so a printed number like "+1 (305) 555-0134" still dials. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}
