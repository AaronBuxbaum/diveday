import { buttonClass } from "@/components/ui/button";
import { InsetGroup } from "@/components/ui/ledger";
import { nowDate } from "@/lib/clock";
import { formatShortDate } from "@/lib/format";
import { ONBOARDING_EMAIL } from "@/lib/platform-mail";
import { isTrialExpired, trialDaysRemaining, trialEndsAt } from "@/lib/trial";
import { SettingsDoorRow, SettingsRow } from "../SettingsRows";
import { ACCOUNT_GROUP, SettingsGroup, type SettingsView } from "./kit";

/** The Account group: the reader's own security and calendar, and the trial. */
export function AccountGroup({
  view,
  canViewTrialStatus,
}: {
  view: SettingsView;
  canViewTrialStatus: boolean;
}) {
  const { shop, shopSlug, t, locale } = view;
  const trialDaysLeft = trialDaysRemaining(shop.createdAt, nowDate());
  const trialExpired = isTrialExpired(shop.createdAt, nowDate());
  const trialEndLabel = formatShortDate(trialEndsAt(shop.createdAt), locale, shop.timezone);
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

        {/* What DiveDay itself costs, owner-grade like the rest of the
          account. Soft expiry by product decision: a trial past
          its window keeps working exactly as before, so this is purely
          informational, never a lockout. */}
        {canViewTrialStatus ? (
          <SettingsRow
            sectionId="trial"
            heading={t("settings.main.trial.heading")}
            value={
              trialExpired
                ? t("settings.main.trial.expiredValue", { endDate: trialEndLabel })
                : t("settings.main.trial.value", { count: trialDaysLeft })
            }
            description={
              trialExpired
                ? t("settings.main.trial.expiredDescription", { endDate: trialEndLabel })
                : t("settings.main.trial.activeDescription", {
                    count: trialDaysLeft,
                    endDate: trialEndLabel,
                  })
            }
          >
            <p className="mt-3 text-sm text-muted">{t("settings.main.trial.upgradeBody")}</p>
            <div className="mt-4">
              <a
                href={`mailto:${ONBOARDING_EMAIL}`}
                className={buttonClass({ variant: "secondary" })}
              >
                {t("settings.main.trial.emailCta", { email: ONBOARDING_EMAIL })}
              </a>
            </div>
          </SettingsRow>
        ) : null}
      </InsetGroup>
    </SettingsGroup>
  );
}
