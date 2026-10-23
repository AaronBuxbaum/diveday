import { redirect } from "next/navigation";
import { canPersonReadPrivateRecapPulse } from "@/db/authz";
import type { AppDb } from "@/db/client";
import { listOpenRecapPulses } from "@/db/recap-pulses";
import { shopPath } from "@/lib/staff-notices";

/**
 * **Who on the crew may read the private pulses** (issue #1410, the reasoning
 * on `canReadPrivateRecapPulse` in src/lib/authz.ts). Checked live against the
 * database rather than the JWT, so a demoted manager loses the panel
 * immediately. Awaited on its own, ahead of the page's parallel block, rather
 * than folded into it: folding it in would read a diver's private words for a
 * staffer this gate exists to keep them from, and one round trip is the price
 * of not doing that.
 *
 * **Reviews switched off** (the Features page): the tab is gone, and so is the
 * page, which lands on the inbox, unless a diver's private pulse still waits
 * on a reader who may act on it. Pulses are not reviews and keep arriving
 * (src/db/recap-pulses.ts).
 */
export async function pulseReaderOrInbox(
  db: AppDb,
  shop: { id: string; slug: string; reviewsEnabled: boolean },
  personId: string,
): Promise<boolean> {
  const canReadPulses = await canPersonReadPrivateRecapPulse(db, shop.id, personId);
  if (
    !shop.reviewsEnabled &&
    (!canReadPulses || (await listOpenRecapPulses(db, shop.id)).length === 0)
  ) {
    redirect(shopPath(shop.slug, "inbox"));
  }
  return canReadPulses;
}
