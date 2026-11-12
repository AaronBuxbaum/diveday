import { authSecret } from "./auth-secret";
import { deriveLabelKey, signPayload, tagMatches } from "./signed-token";

type Window = { startsAt: Date; endsAt: Date };

/** Authenticate exactly the schedule the staffer saw, including every leg. */
export function signDayWindows(
  shopId: string,
  tripId: string,
  day: string,
  timeZone: string,
  windows: readonly Window[],
): string {
  if (!authSecret) throw new Error("AUTH_SECRET is required to protect day schedules");
  const legs = windows
    .map((window) => [window.startsAt.toISOString(), window.endsAt.toISOString()])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return signPayload(
    deriveLabelKey(authSecret, "diveday-day-schedule-v1"),
    JSON.stringify([shopId, tripId, day, timeZone, legs]),
  );
}

export function verifyDayWindows(
  proof: string,
  shopId: string,
  tripId: string,
  day: string,
  timeZone: string,
  windows: readonly Window[],
): boolean {
  return tagMatches(proof, () => signDayWindows(shopId, tripId, day, timeZone, windows));
}
