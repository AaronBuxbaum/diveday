import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { forgivingCopy } from "@/components/ui/forgiving-copy";
import { ChoicePill, FieldGrid, PriceField } from "@/components/ui/form";
import { InsetGroup } from "@/components/ui/ledger";
import { catalogItemLabel, rentableItemLabel } from "@/i18n/rental-labels";
import { formatMoneyScanned } from "@/lib/format";
import { toShopCurrency } from "@/lib/money";
import { RENTABLE_ITEMS, SHOP_CATALOG_ITEMS, toRentableKinds } from "@/lib/rentals";
import { saveRentalItemsAction, saveRentalPricingAction } from "../../actions";
import { SettingsRow } from "../SettingsRows";
import { RENTALS_GROUP, SectionNotice, SettingsGroup, type SettingsView } from "./kit";

/** The Rental gear group: what a shop rents out and what it charges for it. */
export function RentalsGroup({ view }: { view: SettingsView }) {
  const { shop, t, locale, banner, activeSection, notSet } = view;
  const offeredKinds = new Set(toRentableKinds(shop.rentalItems));
  const shopCurrency = toShopCurrency(shop.currency);
  const rentalsValue = t("settings.main.rentals.value", { count: offeredKinds.size });
  const rentalPricingValue =
    shop.rentalPricing.setCents !== null
      ? t("settings.main.rentalPricing.value", {
          price: formatMoneyScanned(shop.rentalPricing.setCents, shopCurrency, locale),
        })
      : notSet;
  return (
    <SettingsGroup group={RENTALS_GROUP} label={t(RENTALS_GROUP.labelKey)}>
      <InsetGroup>
        {/* Currency is not here. It lives in the "Units" row with depth
        and water temperature — a shop looking for "what do we measure
        things in" should find all three answers in one place, and this
        group keeps what a shop *charges* and gets paid through. */}
        <SettingsRow
          heading={t("settings.main.rentals.heading")}
          value={rentalsValue}
          detail={t("settings.main.rentals.detail")}
          sectionId="rentals"
          activeSection={activeSection}
        >
          <SectionNotice banner={banner} section="rentals" active={activeSection} />
          <form action={saveRentalItemsAction} className="mt-4">
            <fieldset>
              <legend className="sr-only">{t("settings.main.rentals.legend")}</legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {SHOP_CATALOG_ITEMS.map((item) => (
                  <ChoicePill
                    key={item.kind}
                    type="checkbox"
                    name={item.name}
                    defaultChecked={offeredKinds.has(item.kind)}
                  >
                    {catalogItemLabel(t, item.kind)}
                  </ChoicePill>
                ))}
              </div>
            </fieldset>
            <SubmitButton
              pendingLabel={t("settings.main.rentals.submitting")}
              className={buttonClass({ variant: "secondary", className: "mt-3" })}
            >
              {t("settings.main.rentals.submit")}
            </SubmitButton>
          </form>
        </SettingsRow>

        <SettingsRow
          heading={t("settings.main.rentalPricing.heading")}
          value={rentalPricingValue}
          description={t("settings.main.rentalPricing.description")}
          detail={t("settings.main.rentalPricing.detail")}
          sectionId="rentalPricing"
          activeSection={activeSection}
        >
          <SectionNotice banner={banner} section="rentalPricing" active={activeSection} />
          <form action={saveRentalPricingAction} className="mt-4">
            <FieldGrid columns={2}>
              <PriceField
                name="setPrice"
                label={t("settings.main.rentalPricing.fullSetLabel")}
                hint={t("settings.main.rentalPricing.fullSetHint")}
                cents={shop.rentalPricing.setCents}
                currency={shopCurrency}
                locale={locale}
                copy={forgivingCopy(t)}
              />
              {RENTABLE_ITEMS.filter((item) => offeredKinds.has(item.kind)).map((item) => (
                <PriceField
                  key={item.kind}
                  name={`price_${item.name}`}
                  label={rentableItemLabel(t, item.kind)}
                  cents={shop.rentalPricing.perItemCents[item.kind] ?? null}
                  currency={shopCurrency}
                  locale={locale}
                  copy={forgivingCopy(t)}
                />
              ))}
              {offeredKinds.has("nitrox") ? (
                <PriceField
                  name="nitroxPrice"
                  label={t("settings.main.rentalPricing.nitroxLabel")}
                  hint={t("settings.main.rentalPricing.nitroxHint")}
                  cents={shop.rentalPricing.nitroxCents}
                  currency={shopCurrency}
                  locale={locale}
                  copy={forgivingCopy(t)}
                />
              ) : null}
            </FieldGrid>
            <SubmitButton
              pendingLabel={t("settings.main.rentalPricing.submitting")}
              className={buttonClass({ variant: "secondary", className: "mt-4" })}
            >
              {t("settings.main.rentalPricing.submit")}
            </SubmitButton>
          </form>
        </SettingsRow>
      </InsetGroup>
    </SettingsGroup>
  );
}
