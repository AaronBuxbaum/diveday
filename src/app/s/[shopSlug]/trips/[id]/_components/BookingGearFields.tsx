"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { InfoHint } from "@/components/ui/InfoHint";
import { formatMoneyCents } from "@/lib/format";
import type { ShopCurrency } from "@/lib/money";
import {
  hasAnyRentalPricing,
  nitroxAvailableOn,
  offeredRentableItems,
  quoteRentalFit,
  type RentableItemKind,
  type RentalPricing,
} from "@/lib/rentals";
import {
  RENTABLE_ITEM_HINT_KEYS,
  RENTABLE_ITEM_LABEL_KEYS,
  RentalQuoteAmount,
} from "./RentalFitForm";

/**
 * The checkout-time gear picker for one party member — checkboxes and a live
 * quote, always at a size the diver already committed to renting. Reuses
 * `quoteRentalFit` so this estimate and the checkout charge agree exactly
 * (docs ADR 20260801-checkout-upsells-rental-gear). Deliberately narrower than
 * `RentalFitForm`: no size selects, no notes — those stay a post-booking
 * refinement on the confirmation page and `/ready`, since a size doesn't
 * change what's charged today.
 *
 * **Rental gear is opt-in here, and nothing paid is ever pre-ticked.** One
 * question ("Need rental gear?") starts off, and the per-item checkboxes only
 * appear — all unchecked — once the diver says yes (design/principles.md #8:
 * collapse the rare path). This is the one place `RentableItem.defaultRented`
 * is deliberately *not* consulted: it means "what a diver with no fit on file
 * is assumed to want" and still seeds the post-booking `RentalFitForm`, the
 * staff fit editor, and a new shop's catalog — all fine, because none of those
 * put money on a card. At booking it would have charged a diver who owns a full
 * kit for six items they never asked for unless they unticked each one, per
 * party member.
 *
 * `BookSpotSection` renders one of these per party slot and only when the
 * shop has priced rental gear online (`hasAnyRentalPricing`) — a shop that
 * hasn't priced anything keeps today's flow unchanged.
 */
export function BookingGearFields({
  index,
  showDiverLabel,
  rentalItems,
  course,
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
  /**
   * The course this departure teaches, or null on an ordinary charter — read
   * only for whether it may run on enriched air (`nitroxAvailableOn`). A
   * course that runs on air has no nitrox box, however much nitrox the shop
   * fills.
   */
  course: { nitroxCompatible: boolean } | null;
  pricing: RentalPricing;
  plannedDives: number;
  currency: ShopCurrency;
  /** Told on every quote change (including on mount) so a caller can sum a running checkout total. */
  onSubtotalChange?: (index: number, cents: number) => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const offered = offeredRentableItems(rentalItems);
  const nitroxOffered = nitroxAvailableOn(rentalItems, course);
  // Opt-in, and empty until then — see the note above the component.
  const [wantsGear, setWantsGear] = useState(false);
  const [rentedKinds, setRentedKinds] = useState<Set<RentableItemKind>>(() => new Set());
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
      <label className="mt-1 flex min-h-11 items-center gap-3 text-sm font-medium">
        <input
          type="checkbox"
          checked={wantsGear}
          onChange={(event) => {
            setWantsGear(event.target.checked);
            // Turning the question back off clears the picks outright, so a
            // subtotal from a moment ago can never survive as a charge the
            // diver can no longer see.
            if (!event.target.checked) {
              setRentedKinds(new Set());
              setNitroxRequested(false);
            }
          }}
          className="size-4 accent-primary"
        />
        <span>{t("bookingGear.needGear")}</span>
      </label>
      <p className="mt-1 text-sm text-muted">
        {wantsGear ? t("bookingGear.introBody") : t("bookingGear.skipBody")}
      </p>
      {!wantsGear ? null : (
        <>
          {offered.length > 0 ? (
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {offered.map(({ kind, name }) => {
                const priceCents = pricing.perItemCents[kind];
                const hintKey = RENTABLE_ITEM_HINT_KEYS[kind];
                const itemLabel = t(RENTABLE_ITEM_LABEL_KEYS[kind]);
                return (
                  // The hint stays outside the `<label>` — see the same shape
                  // in `RentalFitForm` for why.
                  <div
                    key={name}
                    className="flex min-h-11 items-center gap-2 rounded-lg border border-border pr-3"
                  >
                    <label className="flex min-h-11 flex-1 items-center gap-3 pl-3 text-sm">
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
                      <span className="flex-1">{itemLabel}</span>
                    </label>
                    {hintKey ? (
                      <InfoHint
                        label={t("rental.jargonHintLabel", { item: itemLabel })}
                        detail={t(hintKey)}
                      />
                    ) : null}
                    {priceCents !== undefined ? (
                      <span className="text-sm text-muted">
                        {formatMoneyCents(priceCents, currency, locale)}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
          {nitroxOffered ? (
            <div className="mt-3 flex min-h-11 items-center gap-2 rounded-lg border border-border pr-3">
              <label className="flex min-h-11 flex-1 items-center gap-3 pl-3 text-sm">
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
              <InfoHint
                label={t("rental.jargonHintLabel", { item: t("rental.nitroxLegend") })}
                detail={t("rental.jargonHints.nitrox")}
              />
            </div>
          ) : null}
          {quote.subtotalCents > 0 ? (
            <p className="mt-2 text-sm tabular-nums">
              <RentalQuoteAmount
                totalLabel={t("bookingGear.gearTotal", {
                  price: formatMoneyCents(quote.subtotalCents, currency, locale),
                })}
                beforeDiscountLabel={t("rental.beforeDiscountLabel")}
                struckPrice={
                  quote.setSavingsCents > 0
                    ? formatMoneyCents(quote.listSubtotalCents, currency, locale)
                    : null
                }
              />
              {quote.setSavingsCents > 0 ? (
                <span className="mt-1 block font-medium text-success">
                  {t("rental.fullSetSavings", {
                    price: formatMoneyCents(quote.setSavingsCents, currency, locale),
                  })}
                </span>
              ) : null}
            </p>
          ) : null}
        </>
      )}
    </fieldset>
  );
}
