import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import {
  controlClass,
  Field,
  FieldActions,
  FieldGrid,
  textareaClassFor,
} from "@/components/ui/form";
import { RENTAL_TERMS_MAX_LENGTH } from "@/lib/rental-terms";
import { CUSTOMER_REGULATOR_SERVICE_MONTHS } from "@/lib/work-orders";
import { saveRegulatorServiceAction, saveRentalTermsAction } from "../../rental-actions";
import { SettingsDoorRow, SettingsRow } from "../SettingsRows";
import { SectionNotice, type SettingsView } from "./kit";

/**
 * **The rental rows of the Bookings group**: what a shop rents out, what it
 * charges for it, and the terms every rental ticket prints. They were a group
 * of their own; renting gear is part of taking a booking, so they sit in
 * Bookings. The first two are doors to pages of their own (#1854): a grid of
 * catalogue items and a price box per item are not a setting's row but a page
 * wearing a disclosure. A function rather than a component, so the rows are
 * part of their group's own element tree.
 */
export function rentalRows(view: SettingsView) {
  const { shop, shopSlug, t, banner, activeSection, notSet } = view;
  const rentalTermsValue = shop.rentalTerms ? t("settings.main.rentalTerms.value") : notSet;
  const regulatorMonths = shop.customerRegulatorServiceMonths;
  return (
    <>
      {/* Currency is not here. It lives in the "Units" row with depth
        and water temperature — a shop looking for "what do we measure
        things in" should find all three answers in one place, and this
        group keeps what a shop *charges* and gets paid through. */}
      <SettingsDoorRow
        href={`/shop/${shopSlug}/settings/rentals`}
        heading={t("settings.main.rentals.heading")}
      />

      <SettingsDoorRow
        href={`/shop/${shopSlug}/settings/rental-prices`}
        heading={t("settings.main.rentalPricing.heading")}
      />

      {/* The shop's own words for every rental ticket, above its "Received
            by" line (ADR 20260815-minimal-gear-register, amended 2026-10-08).
            Never a release: the one waiver stays the only one (CR-015). */}
      <SettingsRow
        heading={t("settings.main.rentalTerms.heading")}
        value={rentalTermsValue}
        description={t("settings.main.rentalTerms.description")}
        detail={t("settings.main.rentalTerms.detail")}
        sectionId="rentalTerms"
        activeSection={activeSection}
      >
        <SectionNotice banner={banner} section="rentalTerms" active={activeSection} />
        <FieldGrid as="form" action={saveRentalTermsAction} columns={1} className="mt-4">
          <Field label={t("settings.main.rentalTerms.label")}>
            <textarea
              name="rentalTerms"
              rows={4}
              maxLength={RENTAL_TERMS_MAX_LENGTH}
              defaultValue={shop.rentalTerms ?? ""}
              className={textareaClassFor(4)}
            />
          </Field>
          <FieldActions>
            <SubmitButton
              pendingLabel={t("settings.main.rentalTerms.submitting")}
              className={buttonClass({ variant: "secondary" })}
            >
              {t("settings.main.rentalTerms.submit")}
            </SubmitButton>
          </FieldActions>
        </FieldGrid>
      </SettingsRow>

      {/* How often the shop services a customer's regulator (#2272): the
            interval a customer regulator's suggested next-due date counts
            from. The shop's own units keep their own clocks. */}
      <SettingsRow
        heading={t("settings.main.regulatorService.heading")}
        value={t("settings.main.regulatorService.months", { months: regulatorMonths })}
        description={t("settings.main.regulatorService.description")}
        sectionId="regulatorService"
        activeSection={activeSection}
      >
        <SectionNotice banner={banner} section="regulatorService" active={activeSection} />
        <FieldGrid as="form" action={saveRegulatorServiceAction} columns={1} className="mt-4">
          <Field label={t("settings.main.regulatorService.label")}>
            <select
              name="regulatorServiceMonths"
              defaultValue={String(regulatorMonths)}
              className={controlClass}
            >
              {CUSTOMER_REGULATOR_SERVICE_MONTHS.map((months) => (
                <option key={months} value={months}>
                  {t("settings.main.regulatorService.months", { months })}
                </option>
              ))}
            </select>
          </Field>
          <FieldActions>
            <SubmitButton
              pendingLabel={t("settings.main.regulatorService.submitting")}
              className={buttonClass({ variant: "secondary" })}
            >
              {t("settings.main.regulatorService.submit")}
            </SubmitButton>
          </FieldActions>
        </FieldGrid>
      </SettingsRow>
    </>
  );
}
