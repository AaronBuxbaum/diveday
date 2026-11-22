/**
 * **Writers that tie a row to whatever id they are handed.**
 *
 * The sweep calls each function as shop B with shop A's ids and fails when
 * shop B is left a row whose foreign key points at one of A's (a leak by
 * insert). The writers below do exactly that when asked, because they take the
 * id on trust: every caller reads it from a row it has already matched to the
 * acting shop, and nothing a visitor types reaches them as an id.
 *
 * This is the list a security reviewer reads. Each entry names the links the
 * sweep sees and why no caller can hand it another shop's id. The sweep fails
 * when a writer here stops linking (remove the entry) and when any other
 * writer starts.
 */
export type CallerCheckedLink = {
  /** `table.column -> parent`, as the sweep reports it. */
  links: readonly string[];
  /** Why no caller can pass another shop's id. */
  reason: string;
};

export const CALLER_CHECKED_LINKS: ReadonlyMap<string, CallerCheckedLink> = new Map([
  [
    "courtesy-email.ts:issuePersonCourtesyEmailUnsubscribeToken",
    {
      links: ["capabilities.person_id -> people"],
      reason:
        "Called once per courtesy send (recaps, seat offers, checkout recovery, work-order follow-ups) with the person the send loop just read from that shop's own rows",
    },
  ],
  [
    "crew-notices.ts:recordCrewNotices",
    {
      links: ["crew_notices.person_id -> people", "crew_notices.trip_id -> trips"],
      reason:
        "Called inside the crew writers' transactions (setTripCrew, crew requests, the staffing page) with the trip and crew member that write has just locked and matched to the shop",
    },
  ],
  [
    "interests.ts:askForDate",
    {
      links: ["interests.course_id -> courses"],
      reason:
        "The public inquiry action resolves the course by slug within the shop named in the page's own URL, and the desk's took-a-call action never passes a course",
    },
  ],
]);
