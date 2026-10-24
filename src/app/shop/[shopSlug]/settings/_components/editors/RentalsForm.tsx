import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { ForgivingInput } from "@/components/ui/ForgivingInput";
import { forgivingCopy } from "@/components/ui/forgiving-copy";
import {
  ChoiceRow,
  controlClass,
  Field,
  FieldActions,
  FieldGrid,
  textareaClassFor,
} from "@/components/ui/form";
import { TBody, Td, THead, Th, Tr } from "@/components/ui/table";
import { catalogItemLabel } from "@/i18n/rental-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { currencySymbol, minorToMajor, toShopCurrency } from "@/lib/money";
import { NITROX_FILL_METHODS } from "@/lib/nitrox-fill";
import { RENTAL_TERMS_MAX_LENGTH } from "@/lib/rental-terms";
import { SHOP_CATALOG_ITEMS, toRentableKinds } from "@/lib/rentals";
import { CUSTOMER_REGULATOR_SERVICE_MONTHS } from "@/lib/work-orders";
import { saveRentalsAction } from "../../rental-actions";
import type { SettingsShop } from "../groups/kit";

/**
 * **Everything about renting gear, in one table and one save** (#2815): which
 * pieces the shop rents, what each costs, the terms a rental ticket prints and
 * how often a customer's regulator is serviced. They were two pages and four
 * rail rows, each saving a slice; a shop sets them in one sitting.
 *
 * A row is a piece: tick it to rent it, and its price box is live. An unticked
 * row greys its box (and the server keeps the price it had), so there is no
 * second page of boxes for pieces that are not rented. Nitrox is a row like
 * the rest, priced per dive.
 */
export function RentalsForm({
  shop,
  t,
  locale,
  droppedFits = 0,
  className = "",
}: {
  shop: SettingsShop;
  t: StaffTranslator;
  locale: string;
  /**
   * Divers whose fit still asks for a piece this catalog no longer offers
   * (`countFitsAskingForDroppedItems`, issue #1792). Said under the table so
   * the standing answers are visible; nothing here clears them. Silent at zero.
   */
  droppedFits?: number;
  className?: string;
}) {
  const offeredKinds = new Set(toRentableKinds(shop.rentalItems));
  const currency = toShopCurrency(shop.currency);
  const copy = forgivingCopy(t);
  const priceBox = (name: string, label: string, cents: number | null) => (
    <ForgivingInput
      kind="money"
      name={name}
      locale={locale}
      currency={currency}
      copy={copy}
      defaultValue={cents === null ? "" : String(minorToMajor(cents, currency))}
      placeholder={currencySymbol(currency, locale)}
      aria-label={label}
    />
  );
  return (
    <form action={saveRentalsAction} className={className}>
      <p className="text-sm text-muted">{t("settings.main.rentals.priceRule")}</p>
      <table className="mt-4 w-full text-sm">
        <caption className="sr-only">{t("settings.main.rentals.caption")}</caption>
        <THead>
          <Th>{t("settings.main.rentals.columns.piece")}</Th>
          <Th width="12rem">{t("settings.main.rentals.columns.price")}</Th>
        </THead>
        <TBody>
          {SHOP_CATALOG_ITEMS.map((item) => {
            const label = catalogItemLabel(t, item.kind);
            const cents =
              item.kind === "nitrox"
                ? shop.rentalPricing.nitroxCents
                : (shop.rentalPricing.perItemCents[item.kind] ?? null);
            return (
              <Tr key={item.kind}>
                <Td clip={false} align="baseline">
                  <ChoiceRow
                    type="checkbox"
                    name={item.name}
                    defaultChecked={offeredKinds.has(item.kind)}
                  >
                    {label}
                    {item.kind === "nitrox" ? (
                      <span className="ms-1 text-muted">
                        {t("settings.main.rentals.nitroxHint")}
                      </span>
                    ) : null}
                  </ChoiceRow>
                </Td>
                <Td clip={false} align="baseline">
                  <div className="group-has-[input[type=checkbox]:not(:checked)]:opacity-50">
                    {priceBox(
                      item.kind === "nitrox" ? "nitroxPrice" : `price_${item.name}`,
                      label,
                      cents,
                    )}
                  </div>
                </Td>
              </Tr>
            );
          })}
          <Tr>
            <Td clip={false} align="baseline">
              <span className="font-medium">{t("settings.main.rentals.fullSetLabel")}</span>{" "}
              <span className="text-muted">{t("settings.main.rentals.fullSetHint")}</span>
            </Td>
            <Td clip={false} align="baseline">
              {priceBox(
                "setPrice",
                t("settings.main.rentals.fullSetLabel"),
                shop.rentalPricing.setCents,
              )}
            </Td>
          </Tr>
        </TBody>
      </table>
      {droppedFits > 0 ? (
        <p className="mt-3 text-sm text-muted">
          {t("settings.main.rentals.droppedFits", { count: droppedFits })}
        </p>
      ) : null}
      <FieldGrid columns={1} className="mt-6">
        <Field
          label={t("settings.main.rentals.terms.label")}
          description={t("settings.main.rentals.terms.hint")}
        >
          <textarea
            name="rentalTerms"
            rows={4}
            maxLength={RENTAL_TERMS_MAX_LENGTH}
            defaultValue={shop.rentalTerms ?? ""}
            className={textareaClassFor(4)}
          />
        </Field>
        {shop.workOrdersEnabled ? (
          <Field
            label={t("settings.main.rentals.regulator.label")}
            description={t("settings.main.rentals.regulator.hint")}
          >
            <select
              name="regulatorServiceMonths"
              defaultValue={String(shop.customerRegulatorServiceMonths)}
              className={controlClass}
            >
              {CUSTOMER_REGULATOR_SERVICE_MONTHS.map((months) => (
                <option key={months} value={months}>
                  {t("settings.main.rentals.regulator.months", { months })}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        {/* Issue 3004: where Rent out's O2-clean warning starts. Shown to every
            shop, because the counter's fill menu offers EANx to every shop. */}
        <Field
          label={t("settings.main.rentals.nitroxFill.label")}
          description={t("settings.main.rentals.nitroxFill.hint")}
        >
          <select
            name="nitroxFillMethod"
            defaultValue={shop.nitroxFillMethod}
            className={controlClass}
          >
            {NITROX_FILL_METHODS.map((method) => (
              <option key={method} value={method}>
                {t(`settings.main.rentals.nitroxFill.options.${method}`)}
              </option>
            ))}
          </select>
        </Field>
        <FieldActions>
          <SubmitButton
            pendingLabel={t("settings.main.rentals.submitting")}
            className={buttonClass({ variant: "secondary" })}
          >
            {t("settings.main.rentals.submit")}
          </SubmitButton>
        </FieldActions>
      </FieldGrid>
    </form>
  );
}
