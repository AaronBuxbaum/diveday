import { Copyable } from "@/components/Copyable";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { diverTranslator } from "@/i18n/messages";
import { partySeatAnchor } from "@/lib/party-seat-anchor";

/** One party seat as the organizer's surfaces render it. */
export type PartyClaimSeat = {
  bookingId: string;
  /** The name on the seat — the organizer's own typing until claimed, the claimant after. */
  seatName: string;
  claimed: boolean;
  /** Whether this seat's current waiver is complete, without exposing readiness state. */
  waiverSigned: boolean;
  /** A shareable claim URL for a still-unclaimed seat; null once claimed (or unmintable). */
  claimUrl: string | null;
  /**
   * The organizer may sign this seat's release as its parent (H-20261014-parent-signs-minor-release): an
   * unclaimed "Under 18" seat still owing one. Absent reads as no.
   */
  signForMinor?: boolean;
  /**
   * What a minor seat with no "Sign" button says instead: send the seat its
   * link, or a physician's sign-off is needed. Absent says nothing.
   */
  minorNote?: "send_link" | "physician" | null;
  /** The lead may pay for this seat now (`PartySeatClaim.payable`); absent where the surface offers no payment. */
  payable?: boolean;
};

/**
 * The organizer's claim panel (docs ADR 20260804-seat-claim-links): one row
 * per seat they booked beyond their own — a shareable link while the seat is
 * unclaimed, a claimed badge with the claimant's name once it isn't. Rendered
 * on the booking confirmation and the organizer's /ready page, so the "who
 * still hasn't claimed?" question has an answer both right after booking and
 * the night before.
 *
 * Server component; `Copyable` carries its words in as props, so no
 * `DiverIntlProvider` namespace is required for this subtree.
 */
export function PartyClaimPanel({
  locale,
  seats,
  signWaiverAction,
  payAction = null,
}: {
  /** The negotiated request locale, not the shop's stored default. */
  locale: string;
  seats: PartyClaimSeat[];
  /**
   * Opens a minor seat's release for the organizer to sign as its parent
   * (H-20261014-parent-signs-minor-release), bound to the organizer's own link. Without it no seat offers to.
   */
  signWaiverAction?: (formData: FormData) => Promise<void>;
  /**
   * Bound to the page's token where the lead may pay for a seat they added
   * (issue #2474); null draws no pay form. It takes `seatBookingId`.
   */
  payAction?: ((formData: FormData) => Promise<void>) | null;
}) {
  if (seats.length === 0) return null;
  const t = diverTranslator(locale);
  // The default `md` inset, the one "Where to go" and "Anything changed" take
  // above it on /ready, so the thread's card titles share one left edge.
  return (
    <SectionCard
      className="text-left"
      title={t("seatClaim.panelHeading")}
      description={t("seatClaim.panelBody")}
    >
      <ul className="flex flex-col gap-3">
        {/* A row inside the panel, deliberately not a card of its own: giving
            it the card's chrome would put a `rounded-panel bg-surface` panel
            inside a `rounded-panel bg-surface` panel at the same radius, which
            reads as a rendering bug rather than as structure. */}
        {seats.map((seat) => (
          <li
            key={seat.bookingId}
            id={partySeatAnchor(seat.bookingId)}
            tabIndex={-1}
            className="scroll-mt-8 rounded-inset border border-border bg-surface/70 p-4"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-semibold">{seat.seatName}</span>
              {seat.claimed ? (
                <span className="text-base font-semibold text-success">
                  {t("seatClaim.claimedBadge")}
                </span>
              ) : (
                <span className="text-base font-medium text-muted">
                  {t("seatClaim.awaitingBadge")}
                </span>
              )}
            </div>
            <p className="mt-1 text-base text-muted">
              {seat.waiverSigned ? t("seatClaim.waiverComplete") : t("seatClaim.waiverNeeded")}
            </p>
            {!seat.claimed && seat.claimUrl ? (
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                {/* It starts the line, so its word sits on the seat's name and
                    waiver line above it rather than 12px inside them. */}
                <Copyable
                  layout="inline"
                  flush
                  value={seat.claimUrl}
                  copyLabel={t("seatClaim.copyReminder")}
                  copiedLabel={t("seatClaim.copiedLabel")}
                  failedLabel={t("seatClaim.copyFailedLabel")}
                />
                {/* Collapsed by default, deliberately: the raw URL is a bearer
                    token, different on every render, and an expanded copy of
                    it would both invite screenshots of a live credential and
                    make this panel's visual baseline diff on every run. The
                    text stays in the DOM for the clipboard-denied fallback
                    (and for tests), just behind a click. */}
                <details className="group/showlink text-sm text-muted">
                  {/* The app's disclosure, not the browser's: `list-none` and
                      the WebKit marker rule drop the black triangle, the shared
                      caret says "this opens", and `min-h-11` gives the summary
                      the 44px of the Copyable beside it (it was 20px). */}
                  <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 font-medium text-primary hover:underline [&::-webkit-details-marker]:hidden">
                    <DisclosureCaret className="group-open/showlink:rotate-90" />
                    {t("seatClaim.showLink")}
                  </summary>
                  <p className="mt-1 font-mono text-xs break-all text-foreground">
                    {seat.claimUrl}
                  </p>
                </details>
              </div>
            ) : null}
            {/* **A parent signs a child's release** (H-20261014-parent-signs-minor-release): "Sign Mia's
                waiver" opens her release on this device, with the guardian's
                card. Only the seat's id is posted; the server re-checks it. */}
            {seat.signForMinor && signWaiverAction ? (
              <form action={signWaiverAction} className="mt-3 flex flex-col items-start gap-2">
                <p className="text-sm text-muted">
                  {t("seatClaim.minorSignBody", { name: seat.seatName })}
                </p>
                <input type="hidden" name="bookingId" value={seat.bookingId} />
                <SubmitButton
                  pendingLabel={t("seatClaim.minorSignPending")}
                  className={buttonClass({ variant: "secondary", size: "sm" })}
                >
                  {t("seatClaim.minorSign", { name: seat.seatName })}
                </SubmitButton>
              </form>
            ) : null}
            {seat.minorNote === "send_link" ? (
              <p className="mt-2 text-sm text-muted">
                {t("seatClaim.minorSendLink", { name: seat.seatName })}
              </p>
            ) : seat.minorNote === "physician" ? (
              <p className="mt-2 text-sm text-muted">
                {t("seatClaim.minorPhysician", { name: seat.seatName })}
              </p>
            ) : null}
            {payAction && seat.payable && !seat.claimed ? (
              <form action={payAction} className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
                <input type="hidden" name="seatBookingId" value={seat.bookingId} />
                <SubmitButton
                  pendingLabel={t("seatClaim.payingSeat")}
                  className={buttonClass({ variant: "secondary" })}
                >
                  {t("seatClaim.payForSeat")}
                </SubmitButton>
                <span className="text-sm text-muted">{t("seatClaim.payForSeatNote")}</span>
              </form>
            ) : null}
            {seat.claimed && !seat.waiverSigned ? (
              <p className="mt-2 text-sm text-muted">{t("seatClaim.claimedNeedsWaiver")}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
