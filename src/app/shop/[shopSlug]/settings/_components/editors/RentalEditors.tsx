import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { forgivingCopy } from "@/components/ui/forgiving-copy";
import { ChoicePill, FieldGrid, PriceField } from "@/components/ui/form";
import { catalogItemLabel, rentableItemLabel } from "@/i18n/rental-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { toShopCurrency } from "@/lib/money";
import { RENTABLE_ITEMS, SHOP_CATALOG_ITEMS, toRentableKinds } from "@/lib/rentals";
import { saveRentalItemsAction, saveRentalPricingAction } from "../../actions";
import type { SettingsShop } from "../groups/kit";

/**
 * **What a shop rents, and what it charges for it** — the two rental editors
 * that were rows on the settings hub and are pages of their own now
 * (`/settings/rentals`, `/settings/rental-prices`, #1854): a grid of catalogue
 * pills, and a price box per offered item. The markup is the rows' own,
 * unchanged; only where it renders moved.
 */
export function RentalItemsForm({
  shop,
  t,
  droppedFits = 0,
  className = "",
}: {
  shop: SettingsShop;
  t: StaffTranslator;
  /**
   * Divers whose fit still asks for a piece this catalog no longer offers
   * (`countFitsAskingForDroppedItems`, issue #1792). Said beside the catalog
   * so the standing answers are visible; nothing here clears them. Silent at
   * zero.
   */
  droppedFits?: number;
  className?: string;
}) {
  const offeredKinds = new Set(toRentableKinds(shop.rentalItems));
  return (
    <form action={saveRentalItemsAction} className={className}>
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
      {droppedFits > 0 ? (
        <p className="mt-3 text-sm text-muted">
          {t("settings.main.rentals.droppedFits", { count: droppedFits })}
        </p>
      ) : null}
      <SubmitButton
        pendingLabel={t("settings.main.rentals.submitting")}
        className={buttonClass({ variant: "secondary", className: "mt-3" })}
      >
        {t("settings.main.rentals.submit")}
      </SubmitButton>
    </form>
  );
}

export function RentalPricingForm({
  shop,
  t,
  locale,
  className = "",
}: {
  shop: SettingsShop;
  t: StaffTranslator;
  locale: string;
  className?: string;
}) {
  const offeredKinds = new Set(toRentableKinds(shop.rentalItems));
  const shopCurrency = toShopCurrency(shop.currency);
  return (
    <form action={saveRentalPricingAction} className={className}>
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
  );
}
