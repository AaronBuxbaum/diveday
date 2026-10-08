import { controlClass, Field, FieldGrid, legendClass } from "@/components/ui/form";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { CUSTOMER_ADDRESS_FIELDS } from "@/lib/payments/customer-address-form";

/**
 * **Where the sale happened, for Stripe Tax** — the six billing fields every
 * staff invoice form asks for once a shop turns tax on. One component for the
 * new-order form and the counter rental's, so the two read the same and post
 * the names `customerAddressFromForm` reads back.
 *
 * **The demo shop's form arrives filled in.** Turning Stripe Tax on makes these
 * fields required, and a demo is meant to be walked through rather than typed
 * into — so the canonical demo prefills them with its own address, which for
 * the counter sale these forms mostly raise is also the honest answer to "where
 * did this sale happen?".
 *
 * `demoAddress` is for a demo shop only. On a real shop this is a *customer's*
 * billing address and Stripe Tax calculates from it, so defaulting it to the
 * shop's own would quietly compute the wrong jurisdiction's tax on every
 * invoice — a worse failure than an empty field, because it looks answered. A
 * real shop still types it.
 */
export function InvoiceAddressFields({
  t,
  demoAddress,
  className,
}: {
  t: StaffTranslator;
  demoAddress: {
    addressStreet: string | null;
    addressLocality: string | null;
    addressRegion: string | null;
    addressPostalCode: string | null;
    addressCountry: string | null;
  } | null;
  className: string;
}) {
  return (
    <fieldset className={className}>
      <legend className={`${legendClass} text-sm font-medium`}>
        {t("orders.new.taxLocationLegend")}
      </legend>
      <p className="mt-1 text-sm text-muted">{t("orders.new.taxLocationHint")}</p>
      <FieldGrid columns={2} className="mt-4">
        <Field label={t("orders.new.addressLine1")} className="sm:col-span-2">
          <input
            type="text"
            name={CUSTOMER_ADDRESS_FIELDS.line1}
            defaultValue={demoAddress?.addressStreet ?? ""}
            required
            autoComplete="billing address-line1"
            maxLength={200}
            className={controlClass}
          />
        </Field>
        <Field label={t("orders.new.addressLine2")} hint={t("orders.new.noteHint")}>
          <input
            type="text"
            name={CUSTOMER_ADDRESS_FIELDS.line2}
            autoComplete="billing address-line2"
            maxLength={200}
            className={controlClass}
          />
        </Field>
        <Field label={t("orders.new.city")}>
          <input
            type="text"
            name={CUSTOMER_ADDRESS_FIELDS.city}
            defaultValue={demoAddress?.addressLocality ?? ""}
            required
            autoComplete="billing address-level2"
            maxLength={100}
            className={controlClass}
          />
        </Field>
        <Field label={t("orders.new.region")} hint={t("orders.new.noteHint")}>
          <input
            type="text"
            name={CUSTOMER_ADDRESS_FIELDS.state}
            defaultValue={demoAddress?.addressRegion ?? ""}
            autoComplete="billing address-level1"
            maxLength={100}
            className={controlClass}
          />
        </Field>
        <Field label={t("orders.new.postalCode")}>
          <input
            type="text"
            name={CUSTOMER_ADDRESS_FIELDS.postalCode}
            defaultValue={demoAddress?.addressPostalCode ?? ""}
            required
            autoComplete="billing postal-code"
            maxLength={30}
            className={controlClass}
          />
        </Field>
        <Field label={t("orders.new.country")}>
          <input
            type="text"
            name={CUSTOMER_ADDRESS_FIELDS.country}
            defaultValue={demoAddress?.addressCountry ?? ""}
            required
            autoComplete="billing country"
            maxLength={2}
            pattern="[A-Za-z]{2}"
            placeholder={t("orders.new.countryPlaceholder")}
            className={`${controlClass} uppercase`}
          />
        </Field>
      </FieldGrid>
    </fieldset>
  );
}
