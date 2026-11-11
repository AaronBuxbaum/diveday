import { Suspense } from "react";
import type { AppDb } from "@/db/client";
import { getReadyPageData } from "@/features/ready";
import { issueGroupSeatClaim, issuePartySeatClaims } from "@/features/seat-claims";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { theBoatIsHome } from "@/lib/thread-steps";
import { ReadyDateActions } from "./ReadyDateActions";

/** Shared authorized reads stay request-local and issue the party invitations once. */
export function readReadyActions(db: AppDb, bookingId: string, capabilityShopId: string) {
  const dataPromise = getReadyPageData(db, bookingId);
  const partyClaimsPromise = dataPromise.then((data) =>
    data &&
    !data.detail.cancelled &&
    !data.departureCancelled &&
    !data.seatReleased &&
    !theBoatIsHome(data.detail.trip)
      ? issuePartySeatClaims(db, { shopId: capabilityShopId, leadBookingId: bookingId })
      : [],
  );
  const groupClaimPromise = Promise.all([dataPromise, partyClaimsPromise]).then(([data, seats]) =>
    data &&
    !data.identityHeld &&
    seats.some((seat) => !seat.claimed && !seat.differentDeparture && seat.claim)
      ? issueGroupSeatClaim(db, { shopId: capabilityShopId, leadBookingId: bookingId })
      : null,
  );
  return { dataPromise, partyClaimsPromise, groupClaimPromise };
}
export type ReadyActionReads = ReturnType<typeof readReadyActions>;

export function readyDateActions(
  dataPromise: ReadyActionReads["dataPromise"],
  partyClaimsPromise: ReadyActionReads["partyClaimsPromise"],
) {
  return (
    <Suspense fallback={null}>
      <StreamedDateActions dataPromise={dataPromise} partyClaimsPromise={partyClaimsPromise} />
    </Suspense>
  );
}

/** Optional header content never delays the booked first paint. */
async function StreamedDateActions({
  dataPromise,
  partyClaimsPromise,
}: {
  dataPromise: ReturnType<typeof getReadyPageData>;
  partyClaimsPromise: ReturnType<typeof issuePartySeatClaims>;
}) {
  const [data, seats] = await Promise.all([dataPromise, partyClaimsPromise]);
  if (
    !data ||
    data.detail.cancelled ||
    data.departureCancelled ||
    data.seatReleased ||
    theBoatIsHome(data.detail.trip)
  )
    return null;
  const t = diverTranslator(await requestLocale(data.shop.defaultLocale));
  return (
    <ReadyDateActions
      moveAsk={data.moveAsk}
      seats={seats.map(({ bookingId, claimed, differentDeparture, seatHeld, claim }) => ({
        bookingId,
        claimed,
        differentDeparture,
        seatHeld,
        hasInvitation: claim !== null,
      }))}
      t={t}
    />
  );
}
