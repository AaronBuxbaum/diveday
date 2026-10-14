import type { DiverTranslator } from "@/i18n/messages";
import { cachedListFormat } from "@/lib/intl-cache";

/** The party seats as the lead's cancel would leave them (batch 6 item 10). */
export type PartyCancelSeats = { goes: string[]; stays: string[] };

/** Splits the lead's party panel into the seats that go with the lead and the ones that stay. */
export function partyCancelSeats(
  seats: ReadonlyArray<{ seatName: string; cancelsWithLead: boolean }>,
): PartyCancelSeats {
  return {
    goes: seats.filter((seat) => seat.cancelsWithLead).map((seat) => seat.seatName),
    stays: seats.filter((seat) => !seat.cancelsWithLead).map((seat) => seat.seatName),
  };
}

/**
 * **What a party lead's cancel does to the seats they booked**, inside the
 * confirm and before the tap (batch 6 item 10): who goes with the lead, who
 * stays booked, then the lead's own money sentence and that the
 * seats that go share its rule. Drawn from the same rule
 * `cancelUnclaimedPartySeats` applies.
 */
export function PartyCancelPlan({
  seats,
  preview,
  locale,
  t,
}: {
  seats: PartyCancelSeats;
  /** The lead's own refund preview, when there is money to speak of. */
  preview: string | null;
  locale: string;
  t: DiverTranslator;
}) {
  const list = cachedListFormat(locale, { type: "conjunction" });
  return (
    <div className="space-y-2 text-sm" data-testid="party-cancel-plan">
      <ul className="space-y-1">
        {seats.goes.length > 0 ? (
          <li>{t("ready.cancelPartyGoes", { names: list.format(seats.goes) })}</li>
        ) : null}
        {seats.stays.length > 0 ? (
          <li>
            {t("ready.cancelPartyStays", {
              count: seats.stays.length,
              names: list.format(seats.stays),
            })}
          </li>
        ) : null}
      </ul>
      {preview ? (
        <p>
          {preview}
          {seats.goes.length > 0
            ? ` ${t("ready.cancelPartyRefund", { count: seats.goes.length })}`
            : null}
        </p>
      ) : null}
    </div>
  );
}
