import type { AppDb } from "./client";

/**
 * **Which shop a text was sent to** (issue #2320), by the number it was sent
 * to. Today every shop texts from DiveDay's one shared sender, so no number
 * names a shop and the answer is always null: a `LATE` reply then takes the
 * soonest open seat across shops (`markPhoneRunningLate`).
 *
 * This is the seam for a shop with its own sender. When a column records a
 * shop's number, this is the one place that reads it, and the SMS webhook
 * already passes the answer on; nothing else changes.
 */
export async function shopForSmsSender(
  _db: AppDb,
  _destinationNumber: string | null,
): Promise<string | null> {
  return null;
}
