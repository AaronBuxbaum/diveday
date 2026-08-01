"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { formatMoneyCents } from "@/lib/format";
import type { ShopCurrency } from "@/lib/money";
import {
  hasAnyRentalPricing,
  offeredRentableItems,
  quoteRentalFit,
  type RentalPricing,
  shopOffersNitrox,
} from "@/lib/rentals";
import { RENTABLE_ITEM_LABEL_KEYS } from "./RentalFitForm";

/**
 * The checkout-time gear picker for one party member — checkboxes and a live
 * quote, always at a size the diver already committed to renting. Reuses
 * `quoteRentalFit` so this estimate and the checkout charge agree exactly
 * (docs ADR 20260801-checkout-upsells-rental-gear). Deliberately narrower than
 * `RentalFitForm`: no size selects, no notes — those stay a post-booking
 * refinement on the confirmation page and `/ready`, since a size doesn't
 * change what's charged today.
 *
 * `BookSpotSection` renders one of these per party slot and only when the
 * shop has priced rental gear online (`hasAnyRentalPricing`) — a shop that
 * hasn't priced anything keeps today's flow unchanged.
 */
export function BookingGearFields({
  index,
  showDiverLabel,
  rentalItems,
  pricing,
  plannedDives,
  currency,
  onSubtotalChange,
}: {
  /** This party member's slot, 0-based — drives the `gear-${index}-*` / `nitrox-${index}` field names `bookSpot` parses. */
  index: number;
  /** Show "Diver N's gear" instead of the plain heading, once the party grows past one. */
  showDiverLabel: boolean;
  rentalItems: string[];
  pricing: RentalPricing;
  plannedDives: number;
  currency: ShopCurrency;
  /** Told on every quote change (including on mount) so a caller can sum a running checkout total. */
  onSubtotalChange?: (index: number, cents: number) => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const offered = offeredRentableItems(rentalItems);
  const nitroxOffered = shopOffersNitrox(rentalItems);
  const [rentedKinds, setRentedKinds] = useState(
    () => new Set(offered.filter((item) => item.defaultRented).map((item) => item.kind)),
  );
  const [nitroxRequested, setNitroxRequested] = useState(false);

  const quote = quoteRentalFit(pricing, {
    rentedKinds: [...rentedKinds],
    offeredKinds: offered.map((item) => item.kind),
    wantsNitrox: nitroxOffered && nitroxRequested,
    plannedDives,
  });

  useEffect(() => {
    onSubtotalChange?.(index, quote.subtotalCents);
  }, [index, quote.subtotalCents, onSubtotalChange]);

  if (!hasAnyRentalPricing(pricing) || (offered.length === 0 && !nitroxOffered)) return null;

  return (
    <fieldset className="rise-in rounded-xl border border-border p-4">
      <legend className="px-1 text-sm font-semibold text-muted">
        {showDiverLabel
          ? t("bookingGear.diverNHeading", { number: index + 1 })
          : t("bookingGear.heading")}
      </legend>
      <p className="mt-1 text-sm text-muted">{t("bookingGear.introBody")}</p>
      {offered.length > 0 ? (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {offered.map(({ kind, name }) => {
            const priceCents = pricing.perItemCents[kind];
            return (
              <label
                key={name}
                className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 text-sm"
              >
                <input
                  name={`gear-${index}-${name}`}
                  type="checkbox"
                  checked={rentedKinds.has(kind)}
                  onChange={(event) => {
                    setRentedKinds((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(kind);
                      else next.delete(kind);
                      return next;
                    });
                  }}
                  className="size-4 accent-primary"
                />
                <span className="flex-1">{t(RENTABLE_ITEM_LABEL_KEYS[kind])}</span>
                {priceCents !== undefined ? (
                  <span className="text-muted">
                    {formatMoneyCents(priceCents, currency, locale)}
                  </span>
                ) : null}
              </label>
            );
          })}
        </div>
      ) : null}
      {nitroxOffered ? (
        <label className="mt-2 flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 text-sm">
          <input
            name={`nitrox-${index}`}
            type="checkbox"
            checked={nitroxRequested}
            onChange={(event) => setNitroxRequested(event.target.checked)}
            className="size-4 accent-primary"
          />
          <span className="flex-1">
            {pricing.nitroxCents !== null
              ? t("rental.nitroxReserveWithPrice", {
                  price: formatMoneyCents(pricing.nitroxCents, currency, locale),
                })
              : t("rental.nitroxReserveNoPrice")}
          </span>
        </label>
      ) : null}
      {quote.subtotalCents > 0 ? (
        <p className="mt-2 text-sm font-medium tabular-nums">
          {t("bookingGear.gearTotal", {
            price: formatMoneyCents(quote.subtotalCents, currency, locale),
          })}
        </p>
      ) : null}
    </fieldset>
  );
}
