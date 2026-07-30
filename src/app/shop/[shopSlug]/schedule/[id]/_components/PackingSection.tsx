import { diverTranslator } from "@/i18n/messages";
import { dockDayTimeline, packingConfidence } from "@/lib/diver-planning";
import type { RentalFit, Shop, Trip } from "./types";

export function PackingSection({
  shop,
  trip,
  rentalFit,
  locale,
}: {
  shop: Shop;
  trip: Trip;
  rentalFit?: RentalFit;
  locale: string;
}) {
  const packing = packingConfidence(shop.packingList, rentalFit ?? null, trip.waterTemperatureC);
  const t = diverTranslator(locale);
  return (
    <section className="mt-6 rounded-xl border border-border bg-surface p-5">
      <h2 className="text-lg font-semibold">{t("trip.packTitle")}</h2>
      {packing.temperatureTip ? (
        <p className="mt-2 text-sm text-muted">{packing.temperatureTip}</p>
      ) : null}
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <div>
          <h3 className="font-semibold">{t("trip.packBring")}</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
            {packing.bring.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="font-semibold">{t("trip.packRenting")}</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
            {packing.rented.length ? (
              packing.rented.map((item) => <li key={item}>{item}</li>)
            ) : (
              <li>{t("trip.packNothingRequested")}</li>
            )}
          </ul>
        </div>
        <div>
          <h3 className="font-semibold">{t("trip.packProvided")}</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
            {packing.provided.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
      <h3 className="mt-5 font-semibold">{t("trip.dockDayRhythm")}</h3>
      <ol className="mt-2 space-y-1 text-sm text-muted">
        {dockDayTimeline(trip.startsAt, shop.dockCallMinutes, trip.endsAt).map((step) => (
          <li key={step.label}>
            {step.label} ·{" "}
            {step.at.toLocaleTimeString(locale, {
              hour: "numeric",
              minute: "2-digit",
              timeZone: shop.timezone,
            })}
          </li>
        ))}
      </ol>
    </section>
  );
}
