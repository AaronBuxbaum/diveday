import { RentalFitForm } from "@/app/s/[shopSlug]/trips/[id]/_components/RentalFitForm";
import type { ReadyPageData } from "@/db/ready";
import { toShopCurrency } from "@/lib/money";
import type { seatRentalItems } from "@/lib/participant-types";
import { saveFitFromReady } from "../gear-actions";

/**
 * The readiness thread's sizes form: the trip page's `RentalFitForm`, bound to
 * this link's token and offered what this seat may rent.
 */
export function ReadyFitForm({
  token,
  data,
  seatItems,
  nitroxCardEntryOffered,
  saved,
}: {
  token: string;
  data: ReadyPageData;
  /** What this seat may rent (`seatRentalItems`). */
  seatItems: ReturnType<typeof seatRentalItems>;
  /** The certification step can take a nitrox card, so the request box may unlock on one. */
  nitroxCardEntryOffered: boolean;
  /** The fit was just saved (`?saved=fit`). */
  saved: boolean;
}) {
  return (
    <RentalFitForm
      action={saveFitFromReady.bind(null, token)}
      rentalFit={data.rentalFit}
      rentalItems={seatItems}
      course={data.trip.course}
      pricing={data.shop.rentalPricing}
      currency={toShopCurrency(data.shop.currency)}
      wantsNitrox={data.wantsNitrox}
      nitroxCardVerified={data.nitroxCardVerified}
      nitroxCardOnFile={data.nitroxCardOnFile}
      nitroxCardEntryOffered={nitroxCardEntryOffered}
      plannedDives={data.trip.plannedDives}
      saved={saved}
    />
  );
}
