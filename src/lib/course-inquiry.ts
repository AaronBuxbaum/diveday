import type { DiverMessageKey } from "@/i18n/messages";

/**
 * Shared codes and types for course inquiries. An inquiry is a recorded
 * request to the shop, not a booking or held seat; message copy and URLs are
 * composed at their respective boundaries.
 */

/**
 * Reported course experience; keys resolve to localized message copy when the
 * inquiry email is composed.
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

/**
 * What the composer's server action answers with — an error sentence already
 * resolved into the reader's language, or a recorded request.
 *
 * Shared by inquiry actions and the form without making `src/app` a dependency
 * of the component.
 */
export type InquiryFormState = { error?: string; success?: boolean };

/**
 * Every word `DateRequestForm` renders, as a shape rather than as words.
 *
 * Shared shape for server-resolved copy passed to the client form, keeping
 * `src/i18n` independent of shared UI.
 */
export interface DateRequestCopy {
  heading: string;
  intro: string;
  whatToDive: string;
  whatToDivePlaceholder: string;
  yourName: string;
  namePlaceholder: string;
  yourEmail: string;
  emailPlaceholder: string;
  yourPhone: string;
  phonePlaceholder: string;
  howManyDivers: string;
  /** One hint for the email and phone pair: either one is enough. */
  contactHint: string;
  dateOptionsHeading: string;
  preferredDate: string;
  alternateDate: string;
  whenSuits: string;
  whenSuitsPlaceholder: string;
  /** The one word on the disclosure that holds the three rarely-answered asks. */
  moreDetails: string;
  whereYouAreUpTo: string;
  chooseOne: string;
  anythingElse: string;
  messagePlaceholder: string;
  orWriteTo: string;
  callLabel: string;
  /** The phone-only opener, for a shop with a number and no email address. */
  orCall: string;
  send: string;
  sending: string;
  sentHeading: string;
  sentBody: string;
}

export type CourseInquiry = {
  courseTitle: string;
  shopName: string;
  /** Who is writing. Blank until they type it; the message reads fine without. */
  name: string;
  /**
   * Requested timing in the diver's own words. This is a request, never a
   * booking or held seat.
   */
  timing: string;
  /** Number of divers, including the writer. */
  divers: number | null;
  /** Where they are up to, or "" until they pick one. */
  experience: CourseInquiryExperience | "";
  /** Anything else they want to say. */
  message: string;
};
