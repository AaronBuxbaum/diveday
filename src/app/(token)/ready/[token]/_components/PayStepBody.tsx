import { TripTerms } from "@/app/s/[shopSlug]/trips/[id]/_components/TripTerms";
import { SubmitButton } from "@/components/SubmitButton";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import type { getShopBySlug } from "@/db/shops";
import type { getTripWithBooked } from "@/db/trips";
import type { DiverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import { payFromReady } from "../booking-actions";
import type { packageDiveBreakdown } from "./pay-step-lines";

/**
 * The Pay step's body: the balance a deposit leaves, the pay button when the
 * booking is payable, the trip's terms beside the money, and the package
 * dives broken down behind a closed disclosure (issue #4309). The page renders
 * it only when there is one of those to show.
 */
export function PayStepBody({
  token,
  payable,
  depositBalanceLine,
  packageBreakdown = null,
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
  /** `packageDiveBreakdown`'s rows; null when the compact balance says it all. */
  packageBreakdown?: ReturnType<typeof packageDiveBreakdown>;
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
      {packageBreakdown ? (
        <PackageBreakdown
          breakdown={packageBreakdown}
          behindDisclosure={payable || depositBalanceLine !== null}
        />
      ) : null}
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

/**
 * The held package dives, one row per cover and end date (issue #4309). On a
 * settled Pay step it is the whole body, and opening the step is already the
 * diver asking for it; beside a pay button or a balance it stays shut behind
 * its own disclosure, so the money keeps the step.
 */
function PackageBreakdown({
  breakdown,
  behindDisclosure,
}: {
  breakdown: NonNullable<ReturnType<typeof packageDiveBreakdown>>;
  behindDisclosure: boolean;
}) {
  const rows = (
    <>
      <ul className="space-y-1 text-base">
        {breakdown.rows.map((row) => (
          <li key={row}>{row}</li>
        ))}
      </ul>
      <p className="mt-2 text-sm text-muted">{breakdown.note}</p>
    </>
  );
  if (!behindDisclosure) {
    return (
      <section aria-label={breakdown.summary} className="mt-3 first:mt-0">
        {rows}
      </section>
    );
  }
  return (
    <details className="group/packages mt-3 first:mt-0">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-inset text-base font-semibold focus-visible:focus-ring [&::-webkit-details-marker]:hidden">
        <DisclosureCaret className="group-open/packages:rotate-90" />
        {breakdown.summary}
      </summary>
      <div className="mt-1">{rows}</div>
    </details>
  );
}
