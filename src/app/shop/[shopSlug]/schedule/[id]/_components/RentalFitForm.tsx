"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import type { DiverMessageKey } from "@/i18n/messages";
import { formatMoneyCents } from "@/lib/format";
import type { ShopCurrency } from "@/lib/money";
import {
  CORE_RENTAL_KINDS,
  hasAnyRentalPricing,
  offeredRentableItems,
  quoteRentalFit,
  type RentableItemKind,
  type RentalPricing,
  shopOffersNitrox,
} from "@/lib/rentals";
import type { RentalFit } from "./types";

const SIZES = ["XS", "S", "M", "L", "XL", "XXL"];

/**
 * `src/lib/rentals.ts` returns item codes, never rendered words (see the
 * domain-strings-common notes on a domain function rendered on both a staff
 * and a diver page) — `SettingsPage.tsx`/`RentalFit.tsx` resolve the same
 * codes against staff.json (`src/i18n/rental-labels.ts`). This is the
 * diver-facing counterpart, kept local rather than shared with that staff
 * resolver so a diver's client bundle never pulls in staff.json.
 */
const RENTABLE_ITEM_LABEL_KEYS: Record<RentableItemKind, DiverMessageKey> = {
  bcd: "rental.itemLabels.bcd",
  regulator: "rental.itemLabels.regulator",
  wetsuit: "rental.itemLabels.wetsuit",
  mask_fins: "rental.itemLabels.maskFins",
  weights: "rental.itemLabels.weights",
  dive_computer: "rental.itemLabels.diveComputer",
  gopro: "rental.itemLabels.gopro",
};

/**
 * The diver's rental-fit capture, reused by the booking confirmation and the
 * `/ready` page. The submit target is passed in as `action` so each surface
 * binds its own (page-scoped or token-scoped) server action. `rentalItems` is
 * the shop's catalog: a diver is only offered gear the shop actually rents, and
 * a size field only appears for an item on offer. `pricing` is the shop's price
 * list; when a shop prices nothing the form keeps the "ask the shop" behaviour.
 */
export function RentalFitForm({
  action,
  rentalFit,
  rentalItems,
  pricing,
  wantsNitrox,
  nitroxCardVerified,
  plannedDives,
  saved,
  currency,
}: {
  action: (formData: FormData) => void;
  rentalFit: RentalFit;
  rentalItems: string[];
  pricing: RentalPricing;
  wantsNitrox: boolean;
  nitroxCardVerified: boolean;
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
  const offered = offeredRentableItems(rentalItems);
  const offers = new Set(offered.map((item) => item.kind));
  const nitroxOffered = shopOffersNitrox(rentalItems);
  const showPricing = hasAnyRentalPricing(pricing);
  const [rentedKinds, setRentedKinds] = useState(
    () =>
      new Set(
        offered
          .filter((item) => rentalFit?.[item.field] ?? item.defaultRented)
          .map((item) => item.kind),
      ),
  );
  const [bcdSize, setBcdSize] = useState(rentalFit?.bcdSize ?? "");
  const [wetsuitSize, setWetsuitSize] = useState(rentalFit?.wetsuitSize ?? "");
  const [finSize, setFinSize] = useState(rentalFit?.finSize ?? "");

  const bcdOk = !rentedKinds.has("bcd") || !!bcdSize;
  const wetsuitOk = !rentedKinds.has("wetsuit") || !!wetsuitSize;
  const isConfirmed = rentedKinds.size > 0 && bcdOk && wetsuitOk;

  const [nitroxRequested, setNitroxRequested] = useState(wantsNitrox);
  // Follow the controls, rather than the saved profile, so the estimate is
  // useful before a diver commits their changes. A shop that doesn't fill
  // nitrox never contributes it to the estimate, whatever a stale request flag says.
  const quote = quoteRentalFit(pricing, {
    rentedKinds: [...rentedKinds],
    offeredKinds: [...offers],
    wantsNitrox: nitroxOffered && nitroxRequested,
    plannedDives,
  });
  // Describe the set as exactly the core items this shop offers, so the copy can
  // never promise a bundle the diver can't assemble (e.g. after the dive
  // computer joined the core kit).
  const coreSetLabels = offered
    .filter((item) => (CORE_RENTAL_KINDS as readonly string[]).includes(item.kind))
    .map((item) => t(RENTABLE_ITEM_LABEL_KEYS[item.kind]))
    // Lower-case mid-sentence, but keep all-caps acronyms like "BCD" intact.
    .map((label) => (label === label.toUpperCase() ? label : label.toLowerCase()));
  // Locale-appropriate list punctuation ("a, b, and c" / "a, b y c"), not an
  // English-only comma join — same approach as RequirementsSection.tsx's
  // site-requirement list.
  const coreSetSentence = new Intl.ListFormat(locale, {
    style: "long",
    type: "conjunction",
  }).format(coreSetLabels);
  // Plain-language glossary hints (task 6) for the two acronyms this
  // checklist is most likely to stump a newcomer with — shown once, only for
  // whichever the shop actually offers, right where the diver is deciding
  // whether to check the box.
  const jargonHintKeys: DiverMessageKey[] = [];
  if (offers.has("bcd")) jargonHintKeys.push("rental.jargonHints.bcd");
  if (offers.has("regulator")) jargonHintKeys.push("rental.jargonHints.regulator");
  return (
    <section className="mt-5 rounded-lg border border-border bg-surface/70 p-4 text-left">
      <h3 className="font-medium">{t("rental.heading")}</h3>
      <p className="mt-1 text-sm text-muted">{t("rental.introBody")}</p>

      {/* Gear-Status Light-up Indicator */}
      <div
        data-testid="gear-status-indicator"
        role="status"
        aria-live="polite"
        className={`mt-4 flex items-center gap-4 p-4 rounded-xl border transition-all duration-300 ${
          isConfirmed
            ? "border-success/30 bg-success/5 shadow-sm"
            : "border-border bg-surface-sunken/40"
        }`}
      >
        <div className="flex gap-2">
          <BcdIcon active={isConfirmed} label={t("rental.bcdIconLabel")} />
          <FinIcon active={isConfirmed} label={t("rental.finIconLabel")} />
        </div>
        <div>
          <p
            className={`text-sm font-semibold transition-colors duration-300 ${
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
          className="mt-3 rounded-lg bg-success/10 px-3 py-2 text-sm font-medium text-success"
        >
          {t("rental.savedNote")}
        </p>
      ) : null}
      <form action={action} className="mt-4 flex flex-col gap-4">
        {offered.length > 0 ? (
          <fieldset>
            <legend className="text-sm font-medium">{t("rental.whatToPlan")}</legend>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {offered.map(({ kind, name }) => {
                const priceCents = pricing.perItemCents[kind];
                return (
                  <label
                    key={name}
                    className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 text-sm"
                  >
                    <input
                      name={name}
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
                    {showPricing && priceCents !== undefined ? (
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
            <p className="mt-2 text-sm text-muted">
              {t("rental.tankPlan", { count: plannedDives })}{" "}
              {showPricing
                ? pricing.setCents !== null && coreSetSentence
                  ? t("rental.fullSetOffer", {
                      set: coreSetSentence,
                      price: formatMoneyCents(pricing.setCents, currency, locale),
                    })
                  : t("rental.perPiece")
                : t("rental.askWhatsIncluded")}
            </p>
            {showPricing && quote.subtotalCents > 0 ? (
              <p className="mt-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
                <span className="font-medium">
                  {quote.unpricedKinds.length > 0
                    ? t("rental.estimatedRentalWithExtras", {
                        price: formatMoneyCents(quote.subtotalCents, currency, locale),
                      })
                    : t("rental.estimatedRental", {
                        price: formatMoneyCents(quote.subtotalCents, currency, locale),
                      })}
                </span>{" "}
                {t("rental.confirmAtDock")}
              </p>
            ) : null}
          </fieldset>
        ) : null}

        {nitroxOffered ? (
          <fieldset>
            <legend className="text-sm font-medium">{t("rental.nitroxLegend")}</legend>
            <p className="mt-1 text-xs text-muted/80">{t("rental.jargonHints.nitrox")}</p>
            <label className="mt-2 flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 text-sm">
              <input
                name="nitrox"
                type="checkbox"
                checked={nitroxRequested}
                onChange={(event) => setNitroxRequested(event.target.checked)}
                className="size-4 accent-primary"
              />
              <span className="flex-1">
                {showPricing && pricing.nitroxCents !== null
                  ? t("rental.nitroxReserveWithPrice", {
                      price: formatMoneyCents(pricing.nitroxCents, currency, locale),
                    })
                  : t("rental.nitroxReserveNoPrice")}
              </span>
            </label>
            {nitroxCardVerified ? (
              <p className="mt-2 text-sm text-muted">{t("rental.nitroxVerifiedNote")}</p>
            ) : nitroxRequested ? (
              <p className="mt-2 rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">
                {wantsNitrox ? `${t("rental.nitroxOnFile")} ` : ""}
                {t("rental.nitroxNeedsVerification")}
              </p>
            ) : (
              <p className="mt-2 text-sm text-muted">{t("rental.nitroxVerificationRequired")}</p>
            )}
          </fieldset>
        ) : null}

        {offers.has("bcd") || offers.has("wetsuit") || offers.has("mask_fins") ? (
          <FieldGrid columns={2}>
            {offers.has("bcd") ? (
              <Field label={t("rental.bcdSize")}>
                <select
                  name="bcdSize"
                  value={bcdSize}
                  onChange={(e) => setBcdSize(e.target.value)}
                  className={controlClass}
                >
                  <option value="">{t("rental.notSure")}</option>
                  {SIZES.map((size) => (
                    <option key={size}>{size}</option>
                  ))}
                </select>
              </Field>
            ) : null}
            {offers.has("wetsuit") ? (
              <Field label={t("rental.wetsuitSize")}>
                <select
                  name="wetsuitSize"
                  value={wetsuitSize}
                  onChange={(e) => setWetsuitSize(e.target.value)}
                  className={controlClass}
                >
                  <option value="">{t("rental.notSure")}</option>
                  {SIZES.map((size) => (
                    <option key={size}>{size}</option>
                  ))}
                </select>
              </Field>
            ) : null}
            {offers.has("wetsuit") ? (
              <Field label={t("rental.bootSize")} hint={t("common.optional")}>
                <input
                  name="bootSize"
                  maxLength={20}
                  defaultValue={rentalFit?.bootSize ?? ""}
                  placeholder={t("rental.bootSizePlaceholder")}
                  className={controlClass}
                />
              </Field>
            ) : null}
            {offers.has("mask_fins") ? (
              <Field label={t("rental.finSize")} hint={t("common.optional")}>
                <input
                  name="finSize"
                  maxLength={20}
                  value={finSize}
                  onChange={(e) => setFinSize(e.target.value)}
                  placeholder={t("rental.finSizePlaceholder")}
                  className={controlClass}
                />
              </Field>
            ) : null}
          </FieldGrid>
        ) : null}
        <FieldGrid columns={1}>
          {offers.has("weights") ? (
            <Field label={t("rental.weightSetup")} hint={t("common.optional")}>
              <input
                name="weightPreference"
                maxLength={80}
                defaultValue={rentalFit?.weightPreference ?? ""}
                placeholder={t("rental.weightPlaceholder")}
                className={controlClass}
              />
            </Field>
          ) : null}
          <Field label={t("rental.anythingElse")} hint={t("common.optional")}>
            <textarea
              name="note"
              rows={2}
              maxLength={300}
              defaultValue={rentalFit?.note ?? ""}
              className={controlClass}
            />
          </Field>
        </FieldGrid>
        <div>
          <SubmitButton
            pendingLabel={t("rental.savingFit")}
            className={buttonClass({
              variant: "secondary",
              size: "sm",
              className: "px-4 text-foreground",
            })}
          >
            {t("rental.saveFit")}
          </SubmitButton>
        </div>
      </form>
    </section>
  );
}

function BcdIcon({ active, label }: { active: boolean; label: string }) {
  return (
    <svg
      aria-hidden="true"
      className={`w-9 h-9 transition-all duration-300 ${
        active ? "text-success drop-shadow-[0_0_8px_rgba(21,128,61,0.4)]" : "text-muted opacity-30"
      }`}
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
      className={`w-9 h-9 transition-all duration-300 ${
        active ? "text-success drop-shadow-[0_0_8px_rgba(21,128,61,0.4)]" : "text-muted opacity-30"
      }`}
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
