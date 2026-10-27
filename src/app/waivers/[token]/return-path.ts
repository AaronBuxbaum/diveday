import { cookies } from "next/headers";
import { verifyBookingCapability } from "@/db/booking-capabilities";
import type { getDb } from "@/db/client";
import { partyLeadReturnToken } from "@/db/seat-claims";
import { readinessLinkPath } from "@/lib/booking-capabilities";
import { isCounterWaiverToken } from "@/lib/counter-waiver-token";
import { PARTY_RETURN_COOKIE, WAIVER_RETURN_COOKIE } from "@/lib/party-return";

/** Use only readiness authority the signer already held, checked against this waiver's seat. */
export async function waiverReturnPath(
  db: Awaited<ReturnType<typeof getDb>>,
  input: { shopId: string; bookingId: string; partyToken?: string; ownToken?: string },
): Promise<string | null> {
  if (input.partyToken) {
    const lead = await partyLeadReturnToken(db, {
      shopId: input.shopId,
      seatBookingId: input.bookingId,
      leadToken: input.partyToken,
    });
    if (lead) return `${readinessLinkPath(lead)}#party-seats`;
  }
  if (!input.ownToken) return null;
  const capability = await verifyBookingCapability(db, {
    token: input.ownToken,
    purpose: "readiness",
  });
  return capability?.shopId === input.shopId && capability.bookingId === input.bookingId
    ? readinessLinkPath(input.ownToken)
    : null;
}

/** A receipt can show a return door only for the holder of another valid link. */
export async function waiverReturnForReceipt(
  db: Awaited<ReturnType<typeof getDb>>,
  input: { shopId: string; bookingId: string | null; token: string },
): Promise<string | null> {
  if (!input.bookingId || isCounterWaiverToken(input.token)) return null;
  const jar = await cookies();
  return waiverReturnPath(db, {
    shopId: input.shopId,
    bookingId: input.bookingId,
    partyToken: jar.get(PARTY_RETURN_COOKIE)?.value,
    ownToken: jar.get(WAIVER_RETURN_COOKIE)?.value,
  });
}
