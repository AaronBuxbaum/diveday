"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import type { DiverMessageKey } from "@/i18n/messages";
import { formatMoneyCents } from "@/lib/format";
import type { ShopCurrency } from "@/lib/money";
import {
  hasAnyRentalPricing,
  offeredRentableItems,
  quoteRentalFit,
  type RentableItemKind,
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
  const offers = new Set(offered.map((item) => item.kind));
  const nitroxOffered = shopOffersNitrox(rentalItems);
  // Opt-in, and empty until then — see the note above the component.
  const [wantsGear, setWantsGear] = useState(false);
  const [rentedKinds, setRentedKinds] = useState<Set<RentableItemKind>>(() => new Set());
  const [nitroxRequested, setNitroxRequested] = useState(false);
  // Plain-language glossary hints for the two acronyms this list is most
  // likely to stump a newcomer with — the same strings the post-booking
  // `RentalFitForm` shows, resolved through the same keys so the two surfaces
  // can never drift into two explanations of one word.
  const jargonHintKeys: DiverMessageKey[] = [];
  if (offers.has("bcd")) jargonHintKeys.push("rental.jargonHints.bcd");
  if (offers.has("regulator")) jargonHintKeys.push("rental.jargonHints.regulator");

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
            <>
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
              {jargonHintKeys.length > 0 ? (
                <ul className="mt-2 flex flex-col gap-0.5 text-xs text-muted/80">
                  {jargonHintKeys.map((key) => (
                    <li key={key}>{t(key)}</li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : null}
          {nitroxOffered ? (
            <>
              <p className="mt-3 text-xs text-muted/80">{t("rental.jargonHints.nitrox")}</p>
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
            </>
          ) : null}
          {quote.subtotalCents > 0 ? (
            <p className="mt-2 text-sm font-medium tabular-nums">
              {t("bookingGear.gearTotal", {
                price: formatMoneyCents(quote.subtotalCents, currency, locale),
              })}
            </p>
          ) : null}
        </>
      )}
    </fieldset>
  );
}
