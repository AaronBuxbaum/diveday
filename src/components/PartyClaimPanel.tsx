import { Copyable } from "@/components/Copyable";
import { SectionCard } from "@/components/ui/card";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { diverTranslator } from "@/i18n/messages";

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
  className = "",
}: {
  /** The negotiated request locale, not the shop's stored default. */
  locale: string;
  seats: PartyClaimSeat[];
  className?: string;
}) {
  if (seats.length === 0) return null;
  const t = diverTranslator(locale);
  // The default `md` inset, the one "Where to go" and "Anything changed" take
  // above it on /ready, so the thread's card titles share one left edge.
  return (
    <SectionCard
      className={`text-left ${className}`}
      title={t("seatClaim.panelHeading")}
      description={t("seatClaim.panelBody")}
    >
      <ul className="flex flex-col gap-3">
        {/* A row inside the panel, deliberately not a card of its own: giving
            it the card's chrome would put a `rounded-panel bg-surface` panel
            inside a `rounded-panel bg-surface` panel at the same radius, which
            reads as a rendering bug rather than as structure. */}
        {seats.map((seat) => (
          <li key={seat.bookingId} className="rounded-inset border border-border bg-surface/70 p-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-semibold">{seat.seatName}</span>
              {seat.claimed ? (
                <span className="text-sm font-semibold text-success">
                  {t("seatClaim.claimedBadge")}
                </span>
              ) : (
                <span className="text-sm font-medium text-muted">
                  {t("seatClaim.awaitingBadge")}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-muted">
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
            {seat.claimed && !seat.waiverSigned ? (
              <p className="mt-2 text-sm text-muted">{t("seatClaim.claimedNeedsWaiver")}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
