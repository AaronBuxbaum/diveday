import { PasskeyAuthentication } from "@/app/_components/PasskeyAuthentication";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { controlClass, Field } from "@/components/ui/form";
import type { StepUpPurpose } from "@/features/security-step-up";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { verifyStepUpAction } from "../actions";

export function StepUpSection({
  shopSlug,
  purpose,
  returnTo,
  isEnabled,
  hasPasskeys,
  t,
}: {
  shopSlug: string;
  purpose: StepUpPurpose | null;
  returnTo: string | null;
  isEnabled: boolean;
  hasPasskeys: boolean;
  t: StaffTranslator;
}) {
  if (!purpose || !returnTo || (!isEnabled && !hasPasskeys)) return null;
  return (
    <SectionCard
      title={t("settings.security.stepUpHeading")}
      description={t(
        purpose === "security"
          ? "settings.security.factorManagement.description"
          : hasPasskeys
            ? isEnabled
              ? "settings.security.passkeys.stepUpWithCodeDescription"
              : "settings.security.passkeys.stepUpDescription"
            : "settings.security.stepUpDescription",
      )}
    >
      {hasPasskeys ? (
        <PasskeyAuthentication
          label={t("settings.security.passkeys.verify")}
          pendingLabel={t("settings.security.passkeys.verifying")}
          errorLabel={t("settings.security.passkeys.error")}
          stepUp={{ shopSlug, purpose, returnTo }}
        />
      ) : null}
      {isEnabled ? (
        <form
          action={verifyStepUpAction.bind(null, shopSlug)}
          className="flex flex-wrap items-end gap-3"
        >
          <input type="hidden" name="purpose" value={purpose} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <Field
            label={t("settings.security.stepUpCodeLabel")}
            hint={t("settings.security.stepUpCodeHint")}
          >
            <input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9A-Za-z-]{6,32}"
              maxLength={32}
              required
              className={controlClass}
            />
          </Field>
          <SubmitButton
            pendingLabel={t("settings.security.stepUpVerifying")}
            className={buttonClass()}
          >
            {t("settings.security.stepUpVerify")}
          </SubmitButton>
        </form>
      ) : null}
    </SectionCard>
  );
}
