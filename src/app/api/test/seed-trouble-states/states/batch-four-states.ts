import type { AppDb } from "@/db/client";
import { answerTheNewestReview } from "./answer-the-newest-review";
import { logPastSeasonsOfThisMonth } from "./log-past-seasons-of-this-month";
import { putARehearsalOnTomorrow } from "./put-a-rehearsal-on-tomorrow";

/**
 * The three opt-in states batch 4's captures ask for: `?rehearsal=1`,
 * `?monthSightings=1` and `?reviewReply=1`. Each is a surface the demo must
 * not carry by default — a rehearsal on the board, eight invented past
 * seasons, a reply the shop never wrote.
 */
export async function batchFourStates(
  params: URLSearchParams,
  db: AppDb,
  shop: { id: string; timezone: string },
  actorId: string,
  now: Date,
) {
  const asked = (flag: string) => params.get(flag) === "1";
  const rehearsal = asked("rehearsal")
    ? await putARehearsalOnTomorrow(db, shop.id, actorId, now)
    : null;
  const monthSightings = asked("monthSightings")
    ? await logPastSeasonsOfThisMonth(db, shop.id, actorId, now, shop.timezone)
    : null;
  const reviewReply = asked("reviewReply")
    ? await answerTheNewestReview(db, shop.id, actorId)
    : null;
  return {
    ...(rehearsal ? { rehearsal } : {}),
    ...(monthSightings ? { monthSightings } : {}),
    ...(reviewReply ? { reviewReply } : {}),
  };
}
