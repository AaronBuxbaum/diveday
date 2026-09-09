/**
 * **"Took a call"** (issue register N-22): the counter's one door for a phone
 * call, and the rules that decide what a call becomes.
 *
 * A staffer with a handset to their ear is holding one conversation, not
 * choosing between three tables. What the caller wants, though, lands in three
 * different places — a **date request** when they want a day the board has
 * nothing on, a **wait-list entry** when the boat they want is full, and a
 * **booking** when there is a seat. Before this door existed the staffer had
 * to know which of the three they were about to create, leave the page, and
 * navigate to it while the caller waited.
 *
 * This module is the framework-free half: the three outcomes, and what each
 * one needs before it can be written. It exists so the form and the server
 * action cannot come to disagree about which box is required — a divergence
 * that would show up as a caller repeating their email address to a staffer
 * whose form had already accepted it.
 *
 * The writes themselves are the ones that already exist, unchanged:
 * `recordCourseInquiry`, `joinTripWaitlist`, and `seatDiver` through the shared
 * seat-a-diver action. Nothing here is a fourth path to a booking.
 */

/**
 * What the call turned out to be about.
 *
 * Kebab because these reach a `?notice=`-shaped URL and the outcome codes and
 * notice codes are read side by side (`NOTICE_CODE_PATTERN`,
 * src/lib/staff-notices.ts).
 */
export type CallOutcome = "date-request" | "waitlist" | "booking";

export const CALL_OUTCOMES: readonly CallOutcome[] = ["date-request", "waitlist", "booking"];

export function isCallOutcome(value: unknown): value is CallOutcome {
  return typeof value === "string" && (CALL_OUTCOMES as readonly string[]).includes(value);
}

/**
 * What an outcome cannot be written without.
 *
 * Each row is a fact about the *mutation* underneath it rather than a
 * preference about the form:
 *
 * - `departure` — `joinTripWaitlist` and `seatDiver` both name a `trips` row.
 * - `email` — `joinTripWaitlist` resolves its person by address
 *   (`findOrCreatePerson`), so an entry with no email has nobody to invite
 *   when a seat frees, which is the only thing a wait-list entry is for. A
 *   booking deliberately does *not* demand one: the counter already takes a
 *   diver on a name alone (`SEAT_SURFACES`, `email: "optional"`) and a phone
 *   booking is the same conversation.
 * - `interest` — `course_inquiries` carries a check constraint refusing a row
 *   that names neither a course nor an interest (ADR
 *   20260814-a-date-request-is-a-course-inquiry).
 */
export type CallRequirement = "departure" | "email" | "interest";

export const CALL_REQUIREMENTS: Record<CallOutcome, readonly CallRequirement[]> = {
  "date-request": ["interest"],
  waitlist: ["departure", "email"],
  booking: ["departure"],
};

export function callOutcomeNeeds(outcome: CallOutcome, requirement: CallRequirement): boolean {
  return CALL_REQUIREMENTS[outcome].includes(requirement);
}

/** What the staffer typed down, before anything has judged it. */
export type CallCapture = {
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  tripId?: string | null;
  interest?: string | null;
};

/**
 * Why this call cannot be written yet, or `null` when it can.
 *
 * `"reply"` is the one rule that is not about the mutation: a lead nobody can
 * ring back is a note about a conversation rather than a lead, and every other
 * door that records one already refuses it (`hasReplyPath`,
 * src/app/actions/inquiry.ts). A call is the surface where it bites hardest —
 * the staffer has the caller *on the line*, which is the only moment the
 * missing number is free to ask for.
 *
 * Order matters, and it is the order a staffer reads the form top to bottom:
 * who, how to reach them, then what they wanted. A form that reported the last
 * refusal first would send them back up the page.
 */
export type CallRefusal = "name" | "reply" | CallRequirement;

function present(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function callRefusal(outcome: CallOutcome, capture: CallCapture): CallRefusal | null {
  if (!present(capture.fullName)) return "name";
  if (!present(capture.email) && !present(capture.phone)) return "reply";
  if (callOutcomeNeeds(outcome, "email") && !present(capture.email)) return "email";
  if (callOutcomeNeeds(outcome, "departure") && !present(capture.tripId)) return "departure";
  if (callOutcomeNeeds(outcome, "interest") && !present(capture.interest)) return "interest";
  return null;
}
