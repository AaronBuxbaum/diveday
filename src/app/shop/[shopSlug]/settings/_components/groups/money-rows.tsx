import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { FactLine } from "@/components/ui/FactLine";
import { forgivingCopy } from "@/components/ui/forgiving-copy";
import { controlClass, Field, FieldGrid, PriceField } from "@/components/ui/form";
import { formatMoneyScanned } from "@/lib/format";
import { toShopCurrency } from "@/lib/money";
import { parsePassThroughFee } from "@/lib/pass-through-fee";
import { saveBuddyCreditAction, savePassThroughFeeAction } from "../../money-actions";
import { SettingsRow } from "../SettingsRows";
import { SectionNotice, type SettingsView } from "./kit";

/**
 * **The pass-through fee**, a Money row: a line the shop adds to what a diver
 * pays for something it passes on (a park fee, a harbour due). It sat in a
 * "Rarely changed" group; it is money, so it lives with the other money
 * settings. A function rather than a component, so the row is part of its
 * group's own element tree. The `#pass-through` fragment and `?saved=` id are
 * unchanged. Payment-settings work: the group draws it only for a reader who
 * may manage payments.
 */
export function passThroughRow(view: SettingsView) {
  const { shop, t, locale, banner, activeSection, notSet } = view;
  const shopCurrency = toShopCurrency(shop.currency);
  const passThroughFee = parsePassThroughFee(shop.passThroughFee);
  const passThroughValue = passThroughFee ? (
    <FactLine
      facts={[
        { value: passThroughFee.name, wraps: true },
        t("settings.main.passThrough.value", {
          price: formatMoneyScanned(passThroughFee.amountCents, shopCurrency, locale),
        }),
      ]}
    />
  ) : (
    notSet
  );
  return (
    <SettingsRow
      heading={t("settings.main.passThrough.heading")}
      value={passThroughValue}
      description={t("settings.main.passThrough.description")}
      detail={t("settings.main.passThrough.detail")}
      sectionId="passThrough"
      activeSection={activeSection}
    >
      <SectionNotice banner={banner} section="passThrough" active={activeSection} />
      <form action={savePassThroughFeeAction} className="mt-4">
        <FieldGrid columns={2}>
          <Field
            label={t("settings.main.passThrough.nameLabel")}
            hint={t("settings.main.optionalHint")}
          >
            <input
              name="passThroughName"
              defaultValue={passThroughFee?.name ?? ""}
              maxLength={120}
              className={controlClass}
              placeholder={t("settings.main.passThrough.namePlaceholder")}
            />
          </Field>
          <PriceField
            name="passThroughAmount"
            label={t("settings.main.passThrough.amountLabel")}
            hint={t("settings.main.passThrough.amountHint")}
            cents={passThroughFee?.amountCents ?? null}
            currency={shopCurrency}
            locale={locale}
            copy={forgivingCopy(t)}
          />
        </FieldGrid>
        <p className="mt-3 text-sm text-muted">{t("settings.main.passThrough.clearHint")}</p>
        <SubmitButton
          pendingLabel={t("words.busy.saving")}
          className={buttonClass({ variant: "secondary", className: "mt-3" })}
        >
          {t("settings.main.passThrough.submit")}
        </SubmitButton>
      </form>
    </SettingsRow>
  );
}

/**
 * **Buddy credit**, a Money row: the trip credit a diver earns once a friend
 * who booked on their Bring a buddy link has dived (issue #4260). Zero, the
 * default, gives none. The Features page's Bring a buddy row links here.
 */
export function buddyCreditRow(view: SettingsView) {
  const { shop, t, locale, banner, activeSection, notSet } = view;
  const shopCurrency = toShopCurrency(shop.currency);
  const cents = shop.buddyCreditCents;
  return (
    <SettingsRow
      heading={t("settings.main.buddyCredit.heading")}
      value={
        cents > 0
          ? t("settings.main.buddyCredit.value", {
              price: formatMoneyScanned(cents, shopCurrency, locale),
            })
          : notSet
      }
      description={t("settings.main.buddyCredit.description")}
      detail={t("settings.main.buddyCredit.detail")}
      sectionId="buddyCredit"
      activeSection={activeSection}
    >
      <SectionNotice banner={banner} section="buddyCredit" active={activeSection} />
      <form action={saveBuddyCreditAction} className="mt-4">
        <FieldGrid columns={2}>
          <PriceField
            name="buddyCreditAmount"
            label={t("settings.main.buddyCredit.amountLabel")}
            hint={t("settings.main.buddyCredit.amountHint")}
            cents={cents > 0 ? cents : null}
            currency={shopCurrency}
            locale={locale}
            copy={forgivingCopy(t)}
          />
        </FieldGrid>
        <SubmitButton
          pendingLabel={t("words.busy.saving")}
          className={buttonClass({ variant: "secondary", className: "mt-3" })}
        >
          {t("settings.main.buddyCredit.submit")}
        </SubmitButton>
      </form>
    </SettingsRow>
  );
}
