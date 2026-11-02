import { TripTerms } from "@/app/s/[shopSlug]/trips/[id]/_components/TripTerms";
import { SubmitButton } from "@/components/SubmitButton";
import type { getShopBySlug } from "@/db/shops";
import type { getTripWithBooked } from "@/db/trips";
import type { DiverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import { payFromReady } from "../booking-actions";

/**
 * The Pay step's body: the balance a deposit leaves, the pay button when the
 * booking is payable, and the trip's terms beside the money. The page renders
 * it only when there is a line or a button to show.
 */
export function PayStepBody({
  token,
  payable,
  depositBalanceLine,
  actionButton,
  fullShop,
  fullTrip,
  locale,
  t,
}: {
  token: string;
  /** The booking can be paid here and the step is asking for it. */
  payable: boolean;
  depositBalanceLine: string | null;
  /** The step's button class: primary on the current step, secondary otherwise. */
  actionButton: string;
  fullShop: Awaited<ReturnType<typeof getShopBySlug>>;
  fullTrip: Awaited<ReturnType<typeof getTripWithBooked>>;
  locale: DiverLocale;
  t: DiverTranslator;
}) {
  return (
    <>
      {depositBalanceLine ? <p className="text-base text-muted">{depositBalanceLine}</p> : null}
      {payable ? (
        <form action={payFromReady.bind(null, token)} className="mt-3 first:mt-0">
          <SubmitButton pendingLabel={t("ready.openingPayment")} className={actionButton}>
            {t("ready.payForTrip")}
          </SubmitButton>
        </form>
      ) : null}
      {/* The one term still ahead of a diver who has already decided,
          where ADR 20260820-one-page-after-booking always meant it to
          land — beside the money, not on the public pitch page. Once
          Pay settles the step closes and the footer's cancel door
          carries the same window. */}
      {payable && fullShop && fullTrip ? (
        <TripTerms shop={fullShop} trip={fullTrip} locale={locale} />
      ) : null}
    </>
  );
}
