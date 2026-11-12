import { AddSeat } from "@/app/(token)/ready/[token]/_components/AddSeat";
import { Copyable } from "@/components/Copyable";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { SettledCheck } from "@/components/ui/SettledCheck";
import type { issuePartySeatClaims } from "@/features/seat-claims";
import type { DiverTranslator } from "@/i18n/messages";
import { claimLinkPath, groupClaimLinkPath } from "@/lib/booking-capabilities";
import { publicAppUrl } from "@/lib/notifications";
import { PartyClaimPanel, type PartyClaimSeat } from "./PartyClaimPanel";

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
  organizerSettled,
  organizerPriceCents,
  groupClaim,
  paymentsAtShop,
  organizerHoldUntil,
  timeZone,
  seats,
  allSet,
  addSeatAction,
  signWaiverAction,
  payAction,
  t,
}: {
  organizerSettled?: boolean;
  organizerPriceCents?: number | null;
  groupClaim?: { token: string } | null;
  paymentsAtShop?: boolean;
  organizerHoldUntil?: Date | null;
  timeZone?: string;
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
  const groupUrl = groupClaim
    ? publicAppUrl()
      ? new URL(groupClaimLinkPath(groupClaim.token), `${publicAppUrl()}/`).toString()
      : groupClaimLinkPath(groupClaim.token)
    : null;
  return (
    <div id="party-seats" tabIndex={-1} className="scroll-mt-8 space-y-3">
      {groupUrl ? (
        <div data-testid="group-share" className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Copyable
            layout="inline"
            flush
            value={groupUrl}
            copyLabel={t("seatClaim.shareGroup")}
            copiedLabel={t("words.did.copied")}
            failedLabel={t("seatClaim.copyFailedLabel")}
          />
          <details className="group/showlink text-sm text-muted">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 font-medium text-primary hover:underline [&::-webkit-details-marker]:hidden">
              <DisclosureCaret className="group-open/showlink:rotate-90" />
              {t("seatClaim.showLink")}
            </summary>
            <p className="mt-1 font-mono text-xs break-all text-foreground">{groupUrl}</p>
          </details>
        </div>
      ) : null}
      <PartyClaimPanel
        locale={locale}
        seats={seats}
        organizerSettled={organizerSettled}
        organizerPriceCents={organizerPriceCents}
        paymentsAtShop={paymentsAtShop}
        organizerHoldUntil={organizerHoldUntil}
        timeZone={timeZone}
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
    paymentStatus: seat.paymentStatus,
    seatPriceCents: seat.seatPriceCents,
    groupHoldUntil: seat.groupHoldUntil,
    groupHoldExpired: seat.groupHoldExpired,
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
