import { ShopPageHeader } from "@/components/ShopPageHeader";
import { diverTranslator } from "@/i18n/messages";
import { cancellationDeadline, checkoutCharge } from "@/lib/deposits";
import { formatDateTimeTz, formatMoneyCents, formatShortDate, formatTimeRange } from "@/lib/format";
import type { Shop, Trip } from "./types";

export function TripHeader({ shop, trip, locale }: { shop: Shop; trip: Trip; locale: string }) {
  const charge = checkoutCharge(trip, trip.course);
  const deadline = cancellationDeadline(trip);
  const t = diverTranslator(locale);
  return (
    <div className="mt-4">
      <ShopPageHeader
        eyebrow={shop.name}
        title={trip.title}
        meta={
          <>
            <p className="text-lg text-muted">
              {formatShortDate(trip.startsAt, locale, shop.timezone)} ·{" "}
              {formatTimeRange(trip.startsAt, trip.endsAt, locale, shop.timezone)}
            </p>
            {trip.course ? (
              <p className="mt-2 text-sm font-medium text-primary">
                {t("trip.courseSession")} · {trip.course.title}
              </p>
            ) : null}
            {trip.description ? <p className="mt-3 text-muted">{trip.description}</p> : null}
            {trip.priceCents !== null ? (
              <p className="mt-3 text-lg font-semibold tabular-nums">
                {formatMoneyCents(trip.priceCents)}{" "}
                <span className="text-sm font-normal text-muted">{t("common.perDiver")}</span>
              </p>
            ) : null}
            {charge?.isDeposit ? (
              <p className="mt-1 text-sm text-muted tabular-nums">
                {t("trip.depositLine", {
                  deposit: formatMoneyCents(charge.amountCents),
                  balance: formatMoneyCents(charge.balanceDueCents),
                })}
              </p>
            ) : null}
            {deadline ? (
              <p className="mt-1 text-sm text-muted">
                {t("trip.freeCancellationUntil", {
                  when: formatDateTimeTz(deadline, locale, shop.timezone),
                })}
              </p>
            ) : null}
          </>
        }
      />
    </div>
  );
}
