import { tapTargetLinkClass } from "@/components/ui/button";
import type { ReadyPageData } from "@/db/ready";
import type { PartySeatClaim } from "@/db/seat-claims";
import type { DiverTranslator } from "@/i18n/messages";
import { partySeatAnchor } from "@/lib/party-seat-anchor";

type SummarySeat = Pick<
  PartySeatClaim,
  "bookingId" | "claimed" | "differentDeparture" | "seatHeld"
> & { hasInvitation: boolean };

/** Date-adjacent actions name the existing request and authorized group, never readiness. */
export function ReadyDateActions({
  moveAsk,
  seats,
  t,
}: {
  moveAsk: ReadyPageData["moveAsk"];
  seats: SummarySeat[];
  t: DiverTranslator;
}) {
  const heldSeats = seats.filter((seat) => seat.seatHeld);
  const hasDifferentDeparture = heldSeats.some((seat) => seat.differentDeparture);
  const target = heldSeats.find((seat) => !seat.claimed && seat.hasInvitation);
  if (!moveAsk && heldSeats.length === 0) return null;
  return (
    <div className="mt-3 space-y-2 text-base print:hidden">
      {moveAsk ? (
        <p>
          <a
            href="#move-ask"
            className={`${tapTargetLinkClass} font-medium text-primary hover:underline`}
          >
            {t(moveAsk === "open" ? "ready.moveAsk.changePlans" : "ready.moveAsk.requestPending")}
          </a>
        </p>
      ) : null}
      {heldSeats.length > 0 ? (
        <div>
          <a
            href={target ? `#${partySeatAnchor(target.bookingId)}` : "#party-seats"}
            className={`${tapTargetLinkClass} font-medium text-primary hover:underline`}
          >
            {t("ready.groupSummary", {
              total: heldSeats.length + 1,
              unclaimed: heldSeats.filter((seat) => !seat.claimed).length,
            })}
          </a>
          {hasDifferentDeparture ? (
            <p className="mt-1 text-sm text-muted">{t("ready.groupDifferentDeparture")}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
