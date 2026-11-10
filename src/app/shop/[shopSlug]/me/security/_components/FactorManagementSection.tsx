import Link from "next/link";
import { PasskeyAuthentication } from "@/app/_components/PasskeyAuthentication";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { controlClass, Field } from "@/components/ui/form";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { shopPath } from "@/lib/staff-notices";
import { verifyFactorManagementPasswordAction, verifyStepUpAction } from "../actions";

export function FactorManagementSection({
  shopSlug,
  verified,
  hasPasskeys,
  hasTotp,
  t,
}: {
  shopSlug: string;
  verified: boolean;
  hasPasskeys: boolean;
  hasTotp: boolean;
  t: StaffTranslator;
}) {
  if (!hasPasskeys && !hasTotp) return null;
  if (verified)
    return <p className="text-sm text-muted">{t("settings.security.factorManagement.verified")}</p>;
  const returnTo = shopPath(shopSlug, "me", "security");
  return (
    <SectionCard
      title={t("settings.security.factorManagement.heading")}
      description={t("settings.security.factorManagement.description")}
    >
      <div className="space-y-4">
        {hasPasskeys ? (
          <PasskeyAuthentication
            label={t("settings.security.passkeys.verify")}
            pendingLabel={t("settings.security.passkeys.verifying")}
            errorLabel={t("settings.security.passkeys.error")}
            stepUp={{ shopSlug, purpose: "security", returnTo }}
          />
        ) : null}
        {hasTotp ? (
          <form
            action={verifyStepUpAction.bind(null, shopSlug)}
            className="flex flex-wrap items-end gap-3"
          >
            <input type="hidden" name="purpose" value="security" />
            <input type="hidden" name="returnTo" value={returnTo} />
            <Field label={t("settings.security.stepUpCodeLabel")}>
              <input
                name="code"
                autoComplete="one-time-code"
                required
                maxLength={32}
                className={controlClass}
              />
            </Field>
            <SubmitButton
              pendingLabel={t("settings.security.stepUpVerifying")}
              className={buttonClass({ variant: "secondary" })}
            >
              {t("settings.security.stepUpVerify")}
            </SubmitButton>
          </form>
        ) : null}
        <form
          action={verifyFactorManagementPasswordAction.bind(null, shopSlug)}
          className="flex flex-wrap items-end gap-3"
        >
          <Field label={t("settings.security.factorManagement.password")}>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              maxLength={1000}
              className={controlClass}
            />
          </Field>
          <SubmitButton
            pendingLabel={t("settings.security.passkeys.verifying")}
            className={buttonClass({ variant: "secondary" })}
          >
            {t("settings.security.factorManagement.verifyPassword")}
          </SubmitButton>
        </form>
        <Link href="/forgot-password" className={buttonClass({ variant: "link", flush: true })}>
          {t("settings.security.factorManagement.recoverPassword")}
        </Link>
      </div>
    </SectionCard>
  );
}
