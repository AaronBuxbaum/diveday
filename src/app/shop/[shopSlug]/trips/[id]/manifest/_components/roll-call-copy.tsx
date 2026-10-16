import Link from "next/link";
import type { RollCallButtonCopy } from "@/app/shop/[shopSlug]/trips/[id]/_components/RollCallButton";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { shopPath } from "@/lib/staff-notices";

/**
 * The roll-call buttons' refusals for this departure: one shared copy for the
 * crew's taps, and one per diver whose "still blocked" links to that diver's
 * own Guests anchor.
 */
export function rollCallCopies(
  t: StaffTranslator,
  shopSlug: string,
  tripId: string,
): {
  crewRollCallButtonCopy: RollCallButtonCopy;
  rollCallButtonCopy: (bookingId: string) => RollCallButtonCopy;
} {
  const errorRefusal = t("trips.rollCall.errorRefusal");
  // Crew have no readiness, so the `not_ready` refusal can never be returned by
  // `crewRollCallAction` — the blocked message is the plain error for the same
  // reason the action collapses every server refusal into one: on a boat, the
  // only thing that matters is that the tap did not stick.
  const crewRollCallButtonCopy = { errorRefusal, blockedMessage: errorRefusal };
  // One `RollCallButtonCopy` per diver: the "not ready" refusal embeds a rich
  // link to that diver's own Guests anchor, so it is built here (server-side,
  // with `t.rich`) rather than reassembled from string fragments in the
  // Client Component — see the note on `RollCallButtonCopy`.
  function rollCallButtonCopy(bookingId: string) {
    return {
      errorRefusal,
      boatFull: t("trips.rollCall.boatFull"),
      blockedMessage: t.rich("trips.rollCall.stillBlocked", {
        tripLink: (chunks) => (
          <Link href={`${shopPath(shopSlug, "trips", tripId)}#booking-${bookingId}`}>{chunks}</Link>
        ),
      }),
    };
  }
  return { crewRollCallButtonCopy, rollCallButtonCopy };
}
