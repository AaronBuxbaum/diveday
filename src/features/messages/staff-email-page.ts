import { readHowItWentEmailChoice } from "@/features/day/how-it-went";
import { readAfterHoursPingChoice } from "@/features/messages/desk-pings";
import { readWeeklyDigestChoice } from "@/features/reports/weekly-digest";
import type { AppDb } from "../../db/client";

/**
 * The staff email page's question in one call: this person's email choices.
 * `howItWent` is null for anyone but an owner, who alone may open the page it links.
 */
export async function getStaffEmailPage(db: AppDb, input: { shopId: string; personId: string }) {
  const [weeklyDigest, afterHours, howItWent] = await Promise.all([
    readWeeklyDigestChoice(db, input),
    readAfterHoursPingChoice(db, input),
    readHowItWentEmailChoice(db, input),
  ]);
  return { weeklyDigest, afterHours, howItWent };
}
