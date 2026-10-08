import { InsetGroup } from "@/components/ui/ledger";
import { SettingsDoorRow } from "../SettingsRows";
import { ACCOUNT_GROUP, SettingsGroup, type SettingsView } from "./kit";

/** The Account group: the reader's own security, calendar and email, and Billing. */
export function AccountGroup({
  view,
  canViewBilling,
}: {
  view: SettingsView;
  canViewBilling: boolean;
}) {
  const { shopSlug, t } = view;
  return (
    <SettingsGroup group={ACCOUNT_GROUP} label={t(ACCOUNT_GROUP.labelKey)}>
      <InsetGroup>
        <SettingsDoorRow
          href={`/shop/${shopSlug}/settings/security`}
          heading={t("settings.main.security.heading")}
        />

        <SettingsDoorRow
          href={`/shop/${shopSlug}/settings/calendar`}
          heading={t("settings.main.calendar.heading")}
        />

        <SettingsDoorRow
          href={`/shop/${shopSlug}/settings/email`}
          heading={t("emailSettings.title")}
        />

        {/* What DiveDay itself costs: the trial, a free term, the card on
          file. Its own page, owner only (ADR 20261007-subscription-billing).
          Purely informational: nothing locks when a trial or a payment lapses. */}
        {canViewBilling ? (
          <SettingsDoorRow
            href={`/shop/${shopSlug}/settings/billing`}
            heading={t("billing.title")}
          />
        ) : null}
      </InsetGroup>
    </SettingsGroup>
  );
}
