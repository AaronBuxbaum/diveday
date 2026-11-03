import type { AppDb } from "./client";
import { readAfterHoursPingChoice } from "./desk-pings";
import { readWeeklyDigestChoice } from "./weekly-digest";

/** The staff email page's question in one call: this person's two email choices. */
export async function getStaffEmailPage(db: AppDb, input: { shopId: string; personId: string }) {
  const [weeklyDigest, afterHours] = await Promise.all([
    readWeeklyDigestChoice(db, input),
    readAfterHoursPingChoice(db, input),
  ]);
  return { weeklyDigest, afterHours };
}
