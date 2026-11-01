import { AddSeat } from "@/app/ready/[token]/_components/AddSeat";
import { PartyClaimPanel, type PartyClaimSeat } from "@/components/PartyClaimPanel";
import { SettledCheck } from "@/components/ui/SettledCheck";
import type { issuePartySeatClaims } from "@/db/seat-claims";
import type { DiverTranslator } from "@/i18n/messages";
import { claimLinkPath } from "@/lib/booking-capabilities";
import { publicAppUrl } from "@/lib/notifications";

/**
 * The party's section of the thread: the claim panel, its all-set line, and
 * the "Add a seat" door. The three are one section — the line is the panel's
 * close, 12px under it, not a section of its own, and the added seat joins the
 * panel above with its own claim link (UX review 2026-10-11, item 13).
 *
 * Nothing renders when there is no party and the booking may not lead a seat.
 */
export function PartySection({
  locale,
  seats,
  allSet,
  addSeatAction,
  signWaiverAction,
  payAction,
  t,
}: {
  /** The negotiated request locale, not the shop's stored default. */
  locale: string;
  seats: PartyClaimSeat[];
  /** "Everyone's set — see you at the dock." The rule is `partyIsAllSet`'s. */
  allSet: boolean;
  /** Bound to the page's token when the booking may lead a seat; null otherwise. */
  addSeatAction: ((formData: FormData) => Promise<void>) | null;
  /** "Sign Mia's waiver" (H-20261014-parent-signs-minor-release), bound to the page's token. */
  signWaiverAction?: (formData: FormData) => Promise<void>;
  /** Bound to the page's token when the lead may pay for a seat they added; null otherwise. */
  payAction: ((formData: FormData) => Promise<void>) | null;
  t: DiverTranslator;
}) {
  if (seats.length === 0 && !addSeatAction) return null;
  return (
    <div id="party-seats" tabIndex={-1} className="scroll-mt-8 space-y-3">
      <PartyClaimPanel
        locale={locale}
        seats={seats}
        signWaiverAction={signWaiverAction}
        payAction={payAction}
      />
      {allSet ? (
        <p>
          <SettledCheck settled label={t("thread.partyAllSet")} className="text-sm text-muted" />
        </p>
      ) : null}
      {addSeatAction ? <AddSeat action={addSeatAction} t={t} /> : null}
    </div>
  );
}

/**
 * The organizer's issued claims as the panel renders them: each unclaimed
 * seat's shareable link, absolute where the app knows its origin. Read by the
 * thread and by the released-seat card (dde-3 #7).
 */
export function partyClaimSeats(
  claims: Awaited<ReturnType<typeof issuePartySeatClaims>>,
): PartyClaimSeat[] {
  const claimOrigin = publicAppUrl();
  return claims.map((seat) => ({
    bookingId: seat.bookingId,
    seatName: seat.seatName,
    claimed: seat.claimed,
    waiverSigned: seat.waiverSigned,
    signForMinor: seat.signForMinor,
    minorNote: seat.minorNote,
    payable: seat.payable,
    claimUrl: seat.claim
      ? claimOrigin
        ? new URL(claimLinkPath(seat.claim.token), `${claimOrigin}/`).toString()
        : claimLinkPath(seat.claim.token)
      : null,
  }));
}
