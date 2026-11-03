import { cookies } from "next/headers";
import type { getDb } from "@/db/client";
import { partyLeadReturnToken } from "@/db/seat-claims";
import { readinessLinkPath } from "@/lib/booking-capabilities";
import { isCounterWaiverToken } from "@/lib/counter-waiver-token";
import { PARTY_RETURN_COOKIE } from "@/lib/party-return";

/**
 * The party lead's way back to their panel, verified against this waiver's
 * seat. A diver signing their own seat signs it in their thread
 * (`/ready/<token>/waiver`, issue #2743), so the waiver link has no other
 * return to offer.
 */
export async function waiverReturnPath(
  db: Awaited<ReturnType<typeof getDb>>,
  input: { shopId: string; bookingId: string; partyToken: string },
): Promise<string | null> {
  const lead = await partyLeadReturnToken(db, {
    shopId: input.shopId,
    seatBookingId: input.bookingId,
    leadToken: input.partyToken,
  });
  return lead ? `${readinessLinkPath(lead)}#party-seats` : null;
}

/** A receipt can show a return door only for the holder of another valid link. */
export async function waiverReturnForReceipt(
  db: Awaited<ReturnType<typeof getDb>>,
  input: { shopId: string; bookingId: string | null; token: string },
): Promise<string | null> {
  if (!input.bookingId || isCounterWaiverToken(input.token)) return null;
  const partyToken = (await cookies()).get(PARTY_RETURN_COOKIE)?.value;
  if (!partyToken) return null;
  return waiverReturnPath(db, { shopId: input.shopId, bookingId: input.bookingId, partyToken });
}
