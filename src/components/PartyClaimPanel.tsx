import { Copyable } from "@/components/Copyable";
import { SectionCard } from "@/components/ui/card";
import { diverTranslator } from "@/i18n/messages";

/** One party seat as the organizer's surfaces render it. */
export type PartyClaimSeat = {
  bookingId: string;
  /** The name on the seat — the organizer's own typing until claimed, the claimant after. */
  seatName: string;
  claimed: boolean;
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
  return (
    <SectionCard
      padding="lg"
      className={`text-left ${className}`}
      title={t("seatClaim.panelHeading")}
      description={t("seatClaim.panelBody")}
    >
      <ul className="flex flex-col gap-3">
        {/* A row inside the panel, deliberately not a card of its own: giving
            it the card's chrome would put a `rounded-2xl bg-surface` panel
            inside a `rounded-2xl bg-surface` panel at the same radius, which
            reads as a rendering bug rather than as structure. */}
        {seats.map((seat) => (
          <li key={seat.bookingId} className="rounded-xl border border-border bg-surface/70 p-4">
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
            {!seat.claimed && seat.claimUrl ? (
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                <Copyable
                  layout="inline"
                  value={seat.claimUrl}
                  copyLabel={t("seatClaim.copyLabel")}
                  copiedLabel={t("seatClaim.copiedLabel")}
                  failedLabel={t("seatClaim.copyFailedLabel")}
                />
                {/* Collapsed by default, deliberately: the raw URL is a bearer
                    token, different on every render, and an expanded copy of
                    it would both invite screenshots of a live credential and
                    make this panel's visual baseline diff on every run. The
                    text stays in the DOM for the clipboard-denied fallback
                    (and for tests), just behind a click. */}
                <details className="text-sm text-muted">
                  <summary className="cursor-pointer font-medium text-primary hover:underline">
                    {t("seatClaim.showLink")}
                  </summary>
                  <p className="mt-1 font-mono text-xs break-all text-foreground">
                    {seat.claimUrl}
                  </p>
                </details>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
