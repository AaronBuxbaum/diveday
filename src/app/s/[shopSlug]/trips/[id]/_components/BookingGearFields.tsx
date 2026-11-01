"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ChoicePill, ChoiceRow } from "@/components/ui/form";
import { InfoHint } from "@/components/ui/InfoHint";
import { formatMoneyCents } from "@/lib/format";
import type { ShopCurrency } from "@/lib/money";
import { isDiver, type ParticipantType, rentsKind } from "@/lib/participant-types";
import {
  checkoutRentableItems,
  hasAnyRentalPricing,
  type LastGear,
  nitroxAvailableOn,
  quoteRentalFit,
  type RentableItemKind,
  type RentalPricing,
} from "@/lib/rentals";
import {
  ItemPrice,
  RENTABLE_ITEM_HINT_KEYS,
  RENTABLE_ITEM_LABEL_KEYS,
  RentalQuoteAmount,
  widestItemPrice,
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
 * **Rental gear is opt-in here, and nothing paid is pre-ticked on a guess.** One
 * question ("Need rental gear?") starts off, and the per-item checkboxes only
 * appear — all unchecked — once the diver says yes (design/principles.md #8:
 * collapse the rare path). The one exception is the diver's own last choice
 * (`asLastTime`, fifth-loop ideas item 40): a known diver arriving through
 * their handoff starts from what their last trip carried, ticked and said so
 * ("As on your last trip"), every box still theirs to untick. This is the one place `RentableItem.defaultRented`
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
 *
 * **A course whose fee includes the gear rents nothing here** (issue #2795,
 * `checkoutRentableItems`): no rental question, no rental price and no gear
 * total. Its sizes are asked on `/ready`. The nitrox fill, where the course
 * runs on it, is the step's one question and keeps its price.
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
  participantType = "diver",
  asLastTime = null,
}: {
  /** This party member's slot, 0-based — drives the `gear-${index}-*` / `nitrox-${index}` field names `bookSpot` parses. */
  index: number;
  /** Show "Diver N's gear" instead of the plain heading, once the party grows past one. */
  showDiverLabel: boolean;
  rentalItems: string[];
  /**
   * The course this departure teaches, or null on an ordinary charter — read
   * for whether it may run on enriched air (`nitroxAvailableOn`), so a course
   * that runs on air has no nitrox box however much nitrox the shop fills, and
   * whether its fee includes the gear, which takes the rental off this step.
   */
  course: { nitroxCompatible: boolean; gearIncluded: boolean } | null;
  pricing: RentalPricing;
  plannedDives: number;
  currency: ShopCurrency;
  /** Told on every quote change (including on mount) so a caller can sum a running checkout total. */
  onSubtotalChange?: (index: number, cents: number) => void;
  /**
   * Whose seat this is (ADR 20261007-participant-types): a snorkeler is offered
   * the surface kit only and never a nitrox fill. `bookSpot` drops anything
   * else a hand-built post sends, so this is the honest form, not the gate.
   */
  participantType?: ParticipantType;
  /**
   * The known diver's last trip's gear, for their own slot only: the step
   * starts open with those boxes ticked, limited to what this departure
   * offers. Null starts it closed and empty, as on every cold visit.
   */
  asLastTime?: LastGear | null;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const gearIncluded = course?.gearIncluded === true;
  const offered = checkoutRentableItems(rentalItems, course).filter((item) =>
    rentsKind(participantType, item.kind),
  );
  const nitroxOffered = isDiver(participantType) && nitroxAvailableOn(rentalItems, course);
  // Opt-in, and empty until then, unless this is the diver's own last choice
  // (see the note above the component). Only kinds this departure offers.
  const lastKinds = (asLastTime?.rentedKinds ?? []).filter((kind) =>
    offered.some((item) => item.kind === kind),
  );
  const lastNitrox = Boolean(asLastTime?.nitrox) && nitroxOffered;
  const startsAsLastTime = lastKinds.length > 0 || lastNitrox;
  const [wantsGear, setWantsGear] = useState(startsAsLastTime);
  const [rentedKinds, setRentedKinds] = useState<Set<RentableItemKind>>(() => new Set(lastKinds));
  const [nitroxRequested, setNitroxRequested] = useState(lastNitrox);

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
  const widestPrice = widestItemPrice(offered, pricing, currency, locale);

  if (gearIncluded) {
    // Nothing to rent, so no "Need rental gear?" and no gear total: the step
    // is the nitrox box alone, priced in its own label.
    return (
      <div className="rise-in border-t border-border pt-4">
        <fieldset>
          <legend className="text-sm font-semibold text-muted">
            {showDiverLabel
              ? t("bookingGear.diverNHeading", { number: index + 1 })
              : t("rental.nitroxLegend")}
          </legend>
          <NitroxPill
            index={index}
            checked={nitroxRequested}
            onChange={setNitroxRequested}
            pricing={pricing}
            currency={currency}
            className="mt-1"
          />
        </fieldset>
      </div>
    );
  }

  return (
    // A step of one sheet, not a box inside the booking card's box (ADR
    // 20260827-the-divers-thread, decision 2). The hairline sits on a wrapper
    // rather than on the `<fieldset>` because a `<legend>` is laid out in its
    // fieldset's block-start border and would punch a gap through the rule.
    <div className="rise-in border-t border-border pt-4">
      <fieldset>
        <legend className="text-sm font-semibold text-muted">
          {showDiverLabel
            ? t("bookingGear.diverNHeading", { number: index + 1 })
            : t("bookingGear.heading")}
        </legend>
        <ChoiceRow
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
          className="mt-1 text-sm font-medium"
        >
          {t("bookingGear.needGear")}
        </ChoiceRow>
        <p className="mt-1 text-sm text-muted">
          {wantsGear ? t("bookingGear.introBody") : t("bookingGear.skipBody")}
        </p>
        {wantsGear && startsAsLastTime ? (
          <p className="mt-1 text-sm text-muted">{t("bookingGear.asLastTime")}</p>
        ) : null}
        {!wantsGear ? null : (
          <>
            {offered.length > 0 ? (
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {offered.map(({ kind, name }) => {
                  const priceCents = pricing.perItemCents[kind];
                  const hintKey = RENTABLE_ITEM_HINT_KEYS[kind];
                  const itemLabel = t(RENTABLE_ITEM_LABEL_KEYS[kind]);
                  return (
                    // The hint stays outside the `<label>`, in the pill's
                    // `aside` — see the same shape in `RentalFitForm` for why.
                    <ChoicePill
                      key={name}
                      type="checkbox"
                      name={`gear-${index}-${name}`}
                      checked={rentedKinds.has(kind)}
                      onChange={(event) => {
                        setRentedKinds((current) => {
                          const next = new Set(current);
                          if (event.target.checked) {
                            next.add(kind);
                            // One diver, one suit (H-20260916-rental-fit-describe-shop): ticking one suit
                            // unticks the other, so the quote never charges
                            // for two. `saveRentalFit` holds the same rule
                            // for a post that arrives with both.
                            if (kind === "wetsuit") next.delete("drysuit");
                            if (kind === "drysuit") next.delete("wetsuit");
                          } else next.delete(kind);
                          return next;
                        });
                      }}
                      aside={
                        <>
                          {hintKey ? (
                            <InfoHint
                              label={t("rental.jargonHintLabel", { item: itemLabel })}
                              detail={t(hintKey)}
                            />
                          ) : null}
                          {priceCents !== undefined ? (
                            <ItemPrice
                              price={formatMoneyCents(priceCents, currency, locale)}
                              widest={widestPrice}
                            />
                          ) : null}
                        </>
                      }
                    >
                      {itemLabel}
                    </ChoicePill>
                  );
                })}
              </div>
            ) : null}
            {nitroxOffered ? (
              <NitroxPill
                index={index}
                checked={nitroxRequested}
                onChange={setNitroxRequested}
                pricing={pricing}
                currency={currency}
                className="mt-3"
              />
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
                  <span // `-strong`: this line sits inside the sunken price box, where the
                    // raw hue measures 4.36:1 (issue #793).
                    className="mt-1 block font-medium text-success-strong"
                  >
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
    </div>
  );
}

/** The nitrox request, with what a dive of it costs when the shop prices it online. */
function NitroxPill({
  index,
  checked,
  onChange,
  pricing,
  currency,
  className,
}: {
  index: number;
  checked: boolean;
  onChange: (checked: boolean) => void;
  pricing: RentalPricing;
  currency: ShopCurrency;
  className: string;
}) {
  const t = useTranslations();
  const locale = useLocale();
  return (
    <ChoicePill
      type="checkbox"
      name={`nitrox-${index}`}
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
      className={className}
      aside={
        <InfoHint
          label={t("rental.jargonHintLabel", { item: t("rental.nitroxLegend") })}
          detail={t("rental.jargonHints.nitrox")}
        />
      }
    >
      {pricing.nitroxCents !== null
        ? t("rental.nitroxReserveWithPrice", {
            price: formatMoneyCents(pricing.nitroxCents, currency, locale),
          })
        : t("rental.nitroxReserveNoPrice")}
    </ChoicePill>
  );
}
