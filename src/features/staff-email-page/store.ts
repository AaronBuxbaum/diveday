import { readAfterHoursPingChoice } from "@/features/desk-pings";
import { readWeeklyDigestChoice } from "@/features/weekly-digest";
import type { AppDb } from "../../db/client";

/** The staff email page's question in one call: this person's two email choices. */
export async function getStaffEmailPage(db: AppDb, input: { shopId: string; personId: string }) {
  const [weeklyDigest, afterHours] = await Promise.all([
    readWeeklyDigestChoice(db, input),
    readAfterHoursPingChoice(db, input),
  ]);
  return { weeklyDigest, afterHours };
}
