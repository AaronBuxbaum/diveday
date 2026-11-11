import type { ReadyPageData } from "@/features/ready";
import type { DiverTranslator } from "@/i18n/messages";
import { atShopMoneyLine, atShopRentalLines } from "./pay-step-lines";

export function AtShopMoney({
  t,
  locale,
  data,
  fullTrip,
  partySeatClaims,
}: {
  t: DiverTranslator;
  locale: string;
  data: ReadyPageData;
  fullTrip: Parameters<typeof atShopMoneyLine>[4];
  partySeatClaims: Parameters<typeof atShopMoneyLine>[5];
}) {
  const seatLine = atShopMoneyLine(t, locale, data.shop.currency, data, fullTrip, partySeatClaims);
  if (!seatLine) return null;
  const rentalLines = atShopRentalLines(
    t,
    locale,
    data.shop.currency,
    data,
    fullTrip,
    partySeatClaims,
  );
  return (
    <div className="mt-4 space-y-2 text-base text-muted">
      <p>{seatLine}</p>
      {rentalLines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  );
}
