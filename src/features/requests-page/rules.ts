import type { DateInterestRow } from "../../db/interest-dates";
import type { DateRequestEntry, DateRequestMatch } from "../../lib/date-requests";

type PlanningRequest = Pick<
  DateInterestRow,
  "partySize" | "courseId" | "courseTitle" | "interest" | "charter"
>;

/** Recorded interests only. No inferred compatibility, availability, or booking decision. */
export function summarizeRequestDay(
  entries: readonly Pick<DateRequestEntry<PlanningRequest>, "request" | "match">[],
) {
  const choices: Record<DateRequestMatch, number> = { preferred: 0, alternate: 0, nearby: 0 };
  let knownDivers = 0;
  let unknownParties = 0;
  let charterParties = 0;
  const interests = new Map<string, { key: string; title: string; count: number }>();
  for (const { request, match } of entries) {
    choices[match] += 1;
    if (request.partySize === null) unknownParties += 1;
    else knownDivers += request.partySize;
    if (request.charter) charterParties += 1;
    const title = request.courseTitle ?? request.interest;
    if (!title) continue;
    const key = request.courseId ? `course:${request.courseId}` : `interest:${title}`;
    const previous = interests.get(key);
    interests.set(key, { key, title, count: (previous?.count ?? 0) + 1 });
  }
  return {
    choices,
    knownDivers,
    unknownParties,
    charterParties,
    interests: [...interests.values()],
  };
}
