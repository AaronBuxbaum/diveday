"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { ChoiceFieldset, ChoicePill } from "@/components/ui/form";
import { InfoHint } from "@/components/ui/InfoHint";
import type { DiverMessageKey } from "@/i18n/messages";
import { formatMoneyCents } from "@/lib/format";
import type { ShopCurrency } from "@/lib/money";
import {
  defaultSuitChoice,
  hasAnyRentalPricing,
  nitroxAvailableOn,
  offeredRentableItems,
  offeredSuitChoices,
  quoteRentalFit,
  type RentableItemKind,
  type RentalPricing,
  SUIT_KINDS,
  type SuitChoice,
  suitFlags,
} from "@/lib/rentals";
import { RentalSizeFields } from "./RentalSizeFields";
import type { RentalFit } from "./types";

/**
 * `src/lib/rentals.ts` returns item codes, never rendered words (see the
 * domain-strings-common notes on a domain function rendered on both a staff
 * and a diver page) — `SettingsPage.tsx`/`RentalFit.tsx` resolve the same
 * codes against the staff bundle (`src/i18n/rental-labels.ts`). This is the
 * diver-facing counterpart, kept local rather than shared with that staff
 * resolver so a diver's client bundle never pulls in the staff bundle.
 */
export const RENTABLE_ITEM_LABEL_KEYS: Record<RentableItemKind, DiverMessageKey> = {
  bcd: "rental.itemLabels.bcd",
  regulator: "rental.itemLabels.regulator",
  wetsuit: "rental.itemLabels.wetsuit",
  mask: "rental.itemLabels.mask",
  fins: "rental.itemLabels.fins",
  weights: "rental.itemLabels.weights",
  dive_computer: "rental.itemLabels.diveComputer",
  gopro: "rental.itemLabels.gopro",
  drysuit: "rental.itemLabels.drysuit",
  hood: "rental.itemLabels.hood",
  gloves: "rental.itemLabels.gloves",
  torch: "rental.itemLabels.torch",
  smb: "rental.itemLabels.smb",
};

/**
 * Plain-language definitions for the items this checklist is most likely to
 * stump a newcomer with. They used to sit under the list as permanent
 * paragraphs; now they hang off the item they explain as an `InfoHint`, so the
 * checklist reads as a checklist and the explanation is one hover (or tap, or
 * tab-stop) away for whoever wants it.
 *
 * The drysuit is here for a different reason from the two acronyms: it is the
 * one tick that silently answers a second question. The packing list gives a
 * drysuit renter no boots line at all, because a rental drysuit usually has
 * its boots vulcanised on (`src/lib/dive-prep.ts`'s `rentedItems`), and a
 * diver who packs their own boots against a suit that already has them, or
 * turns up expecting to be handed a pair, finds out at the dock. Saying it on
 * the tick is the only place a diver ever reads it.
 */
const SUIT_CHOICE_KEYS: Record<SuitChoice, DiverMessageKey> = {
  own_wetsuit: "rental.suitChoices.own_wetsuit",
  rents_wetsuit: "rental.suitChoices.rents_wetsuit",
  own_drysuit: "rental.suitChoices.own_drysuit",
  rents_drysuit: "rental.suitChoices.rents_drysuit",
};

/** The catalog item a rented suit choice is priced and hinted as; none for the diver's own. */
const SUIT_CHOICE_KIND: Record<SuitChoice, RentableItemKind | null> = {
  own_wetsuit: null,
  rents_wetsuit: "wetsuit",
  own_drysuit: null,
  rents_drysuit: "drysuit",
};

export const RENTABLE_ITEM_HINT_KEYS: Partial<Record<RentableItemKind, DiverMessageKey>> = {
  bcd: "rental.jargonHints.bcd",
  regulator: "rental.jargonHints.regulator",
  drysuit: "rental.jargonHints.drysuit",
};

/**
 * The widest price among the items on offer, by length: the width every
 * item's price keeps (`ItemPrice`). One currency formats each price the same
 * way, so in tabular figures the longest string is the widest one.
 */
export function widestItemPrice(
  offered: readonly { kind: RentableItemKind }[],
  pricing: RentalPricing,
  currency: ShopCurrency,
  locale: string,
): string {
  let widest = "";
  for (const { kind } of offered) {
    const cents = pricing.perItemCents[kind];
    if (cents === undefined) continue;
    const price = formatMoneyCents(cents, currency, locale);
    if (price.length > widest.length) widest = price;
  }
  return widest;
}

/**
 * An item's price at the end of its pill, as wide as the widest price in the
 * list.
 *
 * The info marker sits before the price, so the price's width decides where
 * the marker stands. Tabular figures make prices of one length one width:
 * "$15.00" against "$35.00" in proportional ones walked it 2px down the
 * column (K-476). A shorter price also holds an invisible copy of the widest
 * one in the same grid cell and ends on the cell's edge, so "$8.00" against
 * "$35.00" does not walk it a whole figure either (K-476 review).
 */
export function ItemPrice({ price, widest }: { price: string; widest: string }) {
  return (
    <span className="grid text-end text-muted tabular-nums">
      {price.length < widest.length ? (
        <span aria-hidden="true" className="invisible col-start-1 row-start-1">
          {widest}
        </span>
      ) : null}
      <span className="col-start-1 row-start-1">{price}</span>
    </span>
  );
}

/** A course whose fee includes the gear asks for sizes only (fifth-loop ideas, item 16). */
function CourseGearLine() {
  const t = useTranslations();
  return <p className="mt-4 text-base text-foreground">{t("rental.courseGearIncluded")}</p>;
}

/**
 * The diver's rental-fit capture — the action of `/ready`'s "Gear and setup"
 * checklist row. The submit target is passed in as `action` so the surface
 * binds its own token-scoped server action. `rentalItems` is the shop's
 * catalog: a diver is only offered gear the shop actually rents, and a size
 * field only appears for an item on offer. `pricing` is the shop's price list;
 * when a shop prices nothing the form keeps the "ask the shop" behaviour.
 *
 * **It renders no heading and no card of its own.** The checklist row it is the
 * action of already names it and carries the shell — a `<SectionCard>` here
 * would put a second title ("Rental fit") under the row's own "Gear and setup"
 * and a surface inside a surface.
 */
export function RentalFitForm({
  action,
  rentalFit,
  rentalItems,
  course,
  pricing,
  wantsNitrox,
  nitroxCardVerified,
  nitroxCardOnFile = false,
  nitroxCardEntryOffered = false,
  plannedDives,
  saved,
  currency,
}: {
  action: (formData: FormData) => void;
  rentalFit: RentalFit;
  rentalItems: string[];
  /**
   * The course this departure teaches, or null on an ordinary charter — read
   * for whether it may run on enriched air (`nitroxAvailableOn`), the same gate
   * the booking page's gear fields use, and whether its fee includes the gear,
   * which asks for sizes with no prices (fifth-loop ideas, item 16).
   */
  course: { nitroxCompatible: boolean; gearIncluded?: boolean } | null;
  pricing: RentalPricing;
  wantsNitrox: boolean;
  nitroxCardVerified: boolean;
  /**
   * A live nitrox card exists for this diver, sighted or not. Decides only what
   * this form says about the request — never whether a tank gets enriched air,
   * which stays `authorizesNitroxFill`.
   */
  nitroxCardOnFile?: boolean;
  /**
   * The page is offering a nitrox card disclosure in the certification
   * checklist above this row. That, and only that, is what hides the request
   * box below (issue 627) — so a departure gating on nothing, which renders no
   * certification row and therefore no card disclosure, keeps its box rather
   * than leaving a diver who wants enriched air nowhere to say so.
   *
   * **A decision, not a rule to re-derive.** The rule behind it is
   * `nitroxCardWanted` (src/lib/rentals.ts), evaluated once by the page; this
   * component deliberately keeps no copy of it, so what is hidden here and what
   * is offered there cannot drift into disagreeing about whether a card is
   * wanted.
   */
  nitroxCardEntryOffered?: boolean;
  plannedDives: number;
  saved: boolean;
  /**
   * The shop's currency for the rental quote — a list price, so it follows
   * `shops.currency` (docs ADR 20260731-shop-currency). Required, not
   * defaulted: a default is how `/ready/[token]` quietly went on quoting gear
   * in dollars after every other surface had moved.
   */
  currency: ShopCurrency;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const offered = offeredRentableItems(rentalItems, course?.gearIncluded === true);
  const offers = new Set(offered.map((item) => item.kind));
  // The suit is one choice of four rather than two of the ticks (H-20260916-rental-fit-describe-shop): a
  // diver dives one suit, and has to be able to say a drysuit is their own.
  // The stored choice stays on offer after the shop drops that suit, so a save
  // does not quietly rewrite the diver's answer (issue #1755).
  const storedSuit = defaultSuitChoice(rentalFit, rentalItems);
  const suitOptions = offeredSuitChoices(rentalItems, storedSuit);
  const [suit, setSuit] = useState<SuitChoice>(storedSuit);
  const ticked = offered.filter((item) => !SUIT_KINDS.has(item.kind));
  const nitroxOffered = nitroxAvailableOn(rentalItems, course);
  const showPricing = !course?.gearIncluded && hasAnyRentalPricing(pricing);
  const widestPrice = widestItemPrice(offered, pricing, currency, locale);
  const [tickedKinds, setTickedKinds] = useState(
    () =>
      new Set(
        ticked
          .filter((item) => rentalFit?.[item.field] ?? item.defaultRented)
          .map((item) => item.kind),
      ),
  );
  // Everything the diver is renting: the ticks, plus the suit when it is ours.
  const suitRented = suitFlags(suit);
  const rentedKinds = new Set<RentableItemKind>(tickedKinds);
  if (suitRented.rentsWetsuit) rentedKinds.add("wetsuit");
  if (suitRented.rentsDrysuit) rentedKinds.add("drysuit");
  // Trimmed to match `optionsWithStored`, which compares a trimmed value
  // against the grid. Untrimmed here, a stored `" MT "` would be offered as
  // clean `MT` and then bind to a value matching no option — the blank box over
  // a size on file that this whole helper exists to stop. Unreachable today
  // (every writer trims), which is exactly why the two halves must agree rather
  // than one of them being half-defensive.
  const [bcdSize, setBcdSize] = useState((rentalFit?.bcdSize ?? "").trim());
  const [wetsuitSize, setWetsuitSize] = useState((rentalFit?.wetsuitSize ?? "").trim());
  const [drysuitSize, setDrysuitSize] = useState((rentalFit?.drysuitSize ?? "").trim());
  const [finSize, setFinSize] = useState(rentalFit?.finSize ?? "");
  const [bootSize, setBootSize] = useState(rentalFit?.bootSize ?? "");

  const bcdOk = !rentedKinds.has("bcd") || !!bcdSize;
  const wetsuitOk = !rentedKinds.has("wetsuit") || !!wetsuitSize;
  const drysuitOk = !rentedKinds.has("drysuit") || !!drysuitSize;
  const isConfirmed = rentedKinds.size > 0 && bcdOk && wetsuitOk && drysuitOk;

  const [nitroxRequested, setNitroxRequested] = useState(wantsNitrox);
  /**
   * Asking for enriched air starts with the card, not with this box — and until
   * that card exists there is no box at all (issue 627). This used to render
   * disabled under a line pointing at the certification checklist above; a
   * control a diver cannot use is a question they then have to work out the
   * answer to, so the section simply is not here until the card that makes it
   * real is.
   *
   * `!wantsNitrox` is the half that matters. An absent checkbox submits
   * nothing, and `saveFitFromReady` writes the absence as `wantsNitrox: false`
   * — so hiding this from a diver who already *has* a live request (they asked
   * on the booking form, which gates nothing) would erase it the next time they
   * saved for any other reason. The gate stops a new request going in without a
   * card; it never traps or quietly drops one already on the trip.
   */
  const nitroxHidden = nitroxCardEntryOffered && !wantsNitrox;
  // Follow the controls, rather than the saved profile, so the estimate is
  // useful before a diver commits their changes. A shop that doesn't fill
  // nitrox never contributes it to the estimate, whatever a stale request flag says.
  const quote = quoteRentalFit(pricing, {
    rentedKinds: [...rentedKinds],
    offeredKinds: [...offers],
    wantsNitrox: nitroxOffered && nitroxRequested,
    plannedDives,
  });
  return (
    // No card and no elevation, and it is not a preference: a rental fit
    // reserves nothing (docs/product/glossary.md — DiveDay tracks no equipment
    // inventory, so a fit is never evidence and never replaces the dock-side
    // check), while the checklist rows above it carry things that actually gate
    // a diver. Raised, this panel read as their peer, which put a green "sizes
    // recorded" light at the same volume as a medical referral one row up.
    <div className="text-left">
      {/* The gear status. Lit once the sizes are in; until then it is the
          live region alone, read to a screen reader and drawn as nothing
          (visual review 2026-10-24, B25): the gray banner with two gray icons
          stood over the form saying what the form itself asks. */}
      <div
        data-testid="gear-status-indicator"
        role="status"
        aria-live="polite"
        className={
          isConfirmed
            ? "flex items-center gap-4 rounded-inset border border-success/30 bg-success/5 p-4 transition-all"
            : "sr-only"
        }
      >
        {isConfirmed ? (
          <div className="flex gap-2">
            <BcdIcon active label={t("rental.bcdIconLabel")} />
            <FinIcon active label={t("rental.finIconLabel")} />
          </div>
        ) : null}
        <div>
          <p
            className={`text-sm font-semibold transition-colors ${
              isConfirmed ? "text-success" : "text-muted"
            }`}
          >
            {rentedKinds.size === 0
              ? t("rental.ownGear")
              : isConfirmed
                ? t("rental.matched")
                : t("rental.selectSizes")}
          </p>
          <p className="text-xs text-muted mt-0.5">
            {rentedKinds.size === 0
              ? t("rental.noCharge")
              : isConfirmed
                ? t("rental.sizesLocked")
                : t("rental.addSizes")}
          </p>
        </div>
      </div>

      {saved ? (
        <p
          role="status"
          className="mt-3 rounded-lg bg-success-tint px-3 py-2 text-sm font-medium text-success-strong"
        >
          {t("rental.savedNote")}
        </p>
      ) : null}
      {course?.gearIncluded ? <CourseGearLine /> : null}
      <form action={action} className="mt-4 flex flex-col gap-4">
        <ChoiceFieldset legend={t("rental.suitLegend")}>
          <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
            {suitOptions.map((choice) => {
              const kind = SUIT_CHOICE_KIND[choice];
              const priceCents = kind ? pricing.perItemCents[kind] : undefined;
              const hintKey = kind ? RENTABLE_ITEM_HINT_KEYS[kind] : undefined;
              const label = t(SUIT_CHOICE_KEYS[choice]);
              return (
                <ChoicePill
                  key={choice}
                  type="radio"
                  name="suit"
                  value={choice}
                  checked={suit === choice}
                  onChange={() => setSuit(choice)}
                  aside={
                    // The suit is never in a course's included gear: it keeps its price.
                    hintKey || (hasAnyRentalPricing(pricing) && priceCents !== undefined) ? (
                      <>
                        {hintKey ? (
                          <InfoHint
                            // Named for the piece, not the answer: "What is
                            // Drysuit?" is the question the hint answers.
                            label={t("rental.jargonHintLabel", {
                              item: t(RENTABLE_ITEM_LABEL_KEYS[kind ?? "drysuit"]),
                            })}
                            detail={t(hintKey)}
                          />
                        ) : null}
                        {hasAnyRentalPricing(pricing) && priceCents !== undefined ? (
                          <ItemPrice
                            price={formatMoneyCents(priceCents, currency, locale)}
                            widest={widestPrice}
                          />
                        ) : null}
                      </>
                    ) : undefined
                  }
                >
                  {label}
                </ChoicePill>
              );
            })}
          </div>
        </ChoiceFieldset>
        {ticked.length > 0 ? (
          <ChoiceFieldset legend={t("rental.whatToPlan")}>
            {/* `gap-x-4`: `FieldGrid`'s gutter, so this grid's columns stand
                on the size fields' edges below it (K-475: an 8px gutter here
                put them 4px off either side). The rows keep their 8px. */}
            <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
              {ticked.map(({ kind, name }) => {
                const priceCents = pricing.perItemCents[kind];
                const hintKey = RENTABLE_ITEM_HINT_KEYS[kind];
                const itemLabel = t(RENTABLE_ITEM_LABEL_KEYS[kind]);
                return (
                  // The hint sits *outside* the `<label>` — the pill's
                  // `aside`: a label's text is the checkbox's accessible
                  // name, and clicking a control nested inside one toggles the
                  // box underneath it.
                  <ChoicePill
                    key={name}
                    type="checkbox"
                    name={name}
                    checked={tickedKinds.has(kind)}
                    onChange={(event) => {
                      setTickedKinds((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(kind);
                        else next.delete(kind);
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
                        {showPricing && priceCents !== undefined ? (
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
            {showPricing || course?.gearIncluded ? null : (
              <p className="mt-2 text-sm text-muted">{t("rental.askWhatsIncluded")}</p>
            )}
            {showPricing && quote.subtotalCents > 0 ? (
              // One line (visual review 2026-10-24, B25): the set price the
              // diver pays, said as the set price, with no struck-through
              // list price and no green savings line. The set-price math is
              // unchanged (H-20260724-initial-gear-policy-sizing).
              <p className="mt-3 text-sm">
                {quote.unpricedKinds.length > 0
                  ? t("rental.estimatedRentalWithExtras", {
                      price: formatMoneyCents(quote.subtotalCents, currency, locale),
                    })
                  : quote.setSavingsCents > 0
                    ? t("rental.estimatedRentalFullSet", {
                        price: formatMoneyCents(quote.subtotalCents, currency, locale),
                      })
                    : t("rental.estimatedRental", {
                        price: formatMoneyCents(quote.subtotalCents, currency, locale),
                      })}{" "}
                {t("rental.confirmAtDock")}
              </p>
            ) : null}
          </ChoiceFieldset>
        ) : null}

        {/* No "what is nitrox?" hint here any more: this section is only
            reachable by a diver who has already filed a nitrox card, and the
            explanation now sits where a diver first meets the word — the "Add
            your nitrox card" disclosure in the certification row (issue 627).
            The booking page, where nitrox genuinely can be a first encounter,
            keeps its own (BookingGearFields.tsx). */}
        {nitroxOffered && !nitroxHidden ? (
          <ChoiceFieldset legend={t("rental.nitroxLegend")}>
            <ChoicePill
              type="checkbox"
              name="nitrox"
              checked={nitroxRequested}
              onChange={(event) => setNitroxRequested(event.target.checked)}
            >
              {pricing.nitroxCents !== null
                ? t("rental.nitroxReserveWithPrice", {
                    price: formatMoneyCents(pricing.nitroxCents, currency, locale),
                  })
                : t("rental.nitroxReserveNoPrice")}
            </ChoicePill>
            {/* Speaks only when there is something true to say: what the crew
                will do about a card they actually have. A request carried in
                from the booking form with no card behind it says nothing at
                all, rather than claiming a card exists. */}
            {nitroxRequested && (nitroxCardVerified || nitroxCardOnFile) ? (
              <p className="mt-2 text-sm text-muted">
                {t(nitroxCardVerified ? "rental.nitroxVerifiedNote" : "rental.nitroxCardOnFile")}
              </p>
            ) : null}
          </ChoiceFieldset>
        ) : null}

        <RentalSizeFields
          offers={offers}
          rentalFit={rentalFit}
          suit={suit}
          sizes={{
            bcd: bcdSize,
            wetsuit: wetsuitSize,
            drysuit: drysuitSize,
            fin: finSize,
            boot: bootSize,
          }}
          onSize={(field, value) => {
            if (field === "bcd") setBcdSize(value);
            else if (field === "wetsuit") setWetsuitSize(value);
            else if (field === "drysuit") setDrysuitSize(value);
            else if (field === "boot") setBootSize(value);
            else setFinSize(value);
          }}
        />
        {/* "Anything else the crew should know?" was the last field of this
            form until issue 627; it is its own question on `/ready` now, with
            its own save. A free-text note is not a rental fit — it outlives the
            sizes, and burying it under them meant a diver had to open the gear
            form to say "titanium hip, I run heavy". */}
        <div>
          <SubmitButton
            pendingLabel={t("rental.savingFit")}
            // The gear step's one action, as every step's is (visual review
            // 2026-10-24, B26).
            className={buttonClass({ variant: "primary" })}
          >
            {t("rental.saveFit")}
          </SubmitButton>
        </div>
      </form>
    </div>
  );
}

/**
 * The quote figure, with the piece-by-piece price struck through whenever the
 * shop's set price beat it (H-20260724-initial-gear-policy-sizing/HD-9). A diver who ticks the whole kit was
 * already being charged the cheaper of the two — the discount just never
 * appeared anywhere, so the total read as if nothing had been taken off.
 *
 * `<s>` alone announces nothing, so the struck figure carries a visually
 * hidden label saying what it is; the price that actually applies stays the
 * one in the sentence.
 */
export function RentalQuoteAmount({
  /** Already interpolated with the discounted price — the figure that applies. */
  totalLabel,
  /** Interpolated `rental.beforeDiscountLabel`, read only by assistive tech. */
  beforeDiscountLabel,
  /** The piece-by-piece figure, pre-formatted; omitted when no discount applied. */
  struckPrice,
}: {
  totalLabel: string;
  beforeDiscountLabel: string;
  struckPrice: string | null;
}) {
  return (
    <>
      {struckPrice ? (
        <s className="mr-1.5 font-normal text-muted">
          <span className="sr-only">{beforeDiscountLabel} </span>
          {struckPrice}
        </s>
      ) : null}
      <span className="font-medium">{totalLabel}</span>
    </>
  );
}

function BcdIcon({ active, label }: { active: boolean; label: string }) {
  return (
    <svg
      aria-hidden="true"
      className={`w-9 h-9 transition-all ${active ? "text-success" : "text-muted opacity-30"}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <title>{label}</title>
      <path d="M5 3h4l1 6-1 5H5V3z" />
      <path d="M19 3h-4l-1 6 1 5h4V3z" />
      <path d="M9 5h6" />
      <path d="M9 11h6" />
      <rect x="11" y="4" width="2" height="15" rx="1" />
      <path d="M7 3v3c0 .5-.5 1-1.5 1H5" />
    </svg>
  );
}

function FinIcon({ active, label }: { active: boolean; label: string }) {
  return (
    <svg
      aria-hidden="true"
      className={`w-9 h-9 transition-all ${active ? "text-success" : "text-muted opacity-30"}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <title>{label}</title>
      <path d="M5 4s1 4 0 9L3 20h4l1-7c-1-5 1-9 1-9H5z" />
      <path d="M15 4s1 4 0 9l-2 7h4l1-7c-1-5 1-9 1-9h-3z" />
    </svg>
  );
}
