import type { DbExecutor } from "@/db/client";
import { type CounterWaiverKey, waiverLinkDoor } from "@/db/waivers";
import { counterDevice } from "../counter-device";

/**
 * **The doctor's page's one door on `/waivers/<token>`** (issue #4003): a
 * party member's emailed door, open on the phone that claimed it. A member is
 * sent no readiness link (`seatAddressIsLeadTyped`), so without this a
 * referred member had no doctor's page at all. A counter QR is the shop's
 * tablet for half an hour and gets none: the desk prints the form instead.
 */
export async function partyDoorKey(
  db: DbExecutor,
  token: string,
): Promise<CounterWaiverKey | null> {
  const door = await waiverLinkDoor(db, token, { device: await counterDevice() });
  return door?.door === "counter" && door.key.purpose === "party_waiver_link" ? door.key : null;
}
