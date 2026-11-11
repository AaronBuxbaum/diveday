import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { FieldErrorFocus } from "@/components/ui/FieldErrorFocus";
import {
  controlClass,
  DateField,
  Field,
  FieldActions,
  FieldGrid,
  FormStatus,
} from "@/components/ui/form";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import { timeZoneLabel } from "@/i18n/timezone-labels";
import type { ShopCurrency } from "@/lib/money";
import { createPromoAction } from "../actions";
import { PromoConnectNotice } from "./PromoConnectNotice";
import { PromoDiscountFields } from "./PromoDiscountFields";
import { SCOPE_KEYS } from "./promo-page-copy";

/**
 * **The New code form**, the body of the promos index's add panel. Unconnected,
 * the Stripe notice stands in for the form: a form that cannot submit is not
 * drawn.
 */
export function NewCodeForm({
  t,
  shopSlug,
  connected,
  currency,
  locale,
  timezone,
  now,
  notice,
  createStatus,
  fieldError,
}: {
  t: StaffTranslator;
  shopSlug: string;
  connected: boolean;
  currency: ShopCurrency;
  locale: string;
  timezone: string;
  now: Date;
  notice: string | undefined;
  createStatus: { tone: "success" | "danger" | "warning"; key: StaffMessageKey } | undefined;
  fieldError: (field: "code" | "discount" | "startsAt") => string | undefined;
}) {
  if (!connected) return <PromoConnectNotice t={t} shopSlug={shopSlug} className="mb-4" />;
  return (
    <FieldGrid as="form" action={createPromoAction} columns={2}>
      <Field
        label={t("promos.fields.code")}
        hint={t("promos.fields.codeHint")}
        error={fieldError("code")}
      >
        <input
          name="code"
          required
          maxLength={40}
          placeholder={t("promos.fields.codePlaceholder")}
          autoComplete="off"
          className={`${controlClass} uppercase`}
        />
      </Field>
      <Field label={t("promos.fields.goodFor")}>
        <select name="scope" defaultValue="all" className={controlClass}>
          {Object.entries(SCOPE_KEYS).map(([value, key]) => (
            <option key={value} value={value}>
              {t(key)}
            </option>
          ))}
        </select>
      </Field>
      <PromoDiscountFields
        t={t}
        currency={currency}
        locale={locale}
        error={fieldError("discount")}
      />
      <Field label={t("promos.fields.redemptionCap")} hint={t("promos.fields.redemptionCapHint")}>
        <input
          name="maxRedemptions"
          type="number"
          min={1}
          placeholder={t("promos.fields.redemptionCapPlaceholder")}
          className={controlClass}
        />
      </Field>
      <Field
        label={t("promos.fields.starts")}
        hint={t("promos.fields.startsHint")}
        error={fieldError("startsAt")}
      >
        <DateField name="startsAt" type="datetime-local" />
      </Field>
      <Field label={t("promos.fields.expires")} hint={t("promos.fields.expiresHint")}>
        <DateField name="expiresAt" type="datetime-local" />
      </Field>
      {/* The human zone name, never the raw IANA id — "America/New_York"
              with its underscore is implementation surfacing (principle 4). */}
      <p className="-mt-2 text-xs text-muted sm:col-span-2">
        {t("promos.fields.timezoneHint", {
          timezone: timeZoneLabel(now, locale, timezone),
        })}
      </p>
      <Field label={t("promos.fields.whatFor")} hint={t("promos.fields.whatForHint")}>
        <input
          name="description"
          maxLength={200}
          placeholder={t("promos.fields.whatForPlaceholder")}
          className={controlClass}
        />
      </Field>
      <FieldActions>
        <SubmitButton pendingLabel={t("promos.creating")} className={buttonClass()}>
          {t("promos.createCode")}
        </SubmitButton>
        <FormStatus tone={createStatus?.tone}>
          {createStatus ? t(createStatus.key) : undefined}
        </FormStatus>
      </FieldActions>
      {/* Keyed on the notice so an identical repeat refusal still re-fires
              the focus move — the effect is otherwise skipped on a re-render
              that changed nothing it depends on. */}
      <FieldErrorFocus key={notice} scope="new-code" />
    </FieldGrid>
  );
}
