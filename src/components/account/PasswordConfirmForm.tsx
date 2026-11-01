import type { ComponentProps } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { FieldErrorFocus } from "@/components/ui/FieldErrorFocus";
import { controlClass, Field, FieldGrid, FormStatus } from "@/components/ui/form";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/lib/onboarding";

type FormAction = Exclude<ComponentProps<"form">["action"], string>;
type ErrorField = "password" | "confirm" | "form";

/** The shared password-confirmation mechanics for account token forms. */
export function PasswordConfirmForm({
  action,
  passwordLabel,
  confirmPasswordLabel,
  submitLabel,
  savingLabel,
  submitClassName,
  errorKey,
  errorField,
  errorText,
}: {
  action: FormAction;
  passwordLabel: string;
  confirmPasswordLabel: string;
  submitLabel: string;
  savingLabel: string;
  submitClassName: string;
  errorKey?: string;
  errorField?: ErrorField;
  errorText?: string;
}) {
  return (
    <>
      {errorField && errorField !== "form" ? <FieldErrorFocus key={errorKey} /> : null}
      <form action={action} className="flex flex-col gap-4">
        <FieldGrid columns={1} className="gap-y-4">
          <Field label={passwordLabel} error={errorField === "password" ? errorText : undefined}>
            <input
              name="password"
              type="password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              maxLength={MAX_PASSWORD_LENGTH}
              autoComplete="new-password"
              className={controlClass}
            />
          </Field>
          <Field
            label={confirmPasswordLabel}
            error={errorField === "confirm" ? errorText : undefined}
          >
            <input
              name="confirmPassword"
              type="password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              maxLength={MAX_PASSWORD_LENGTH}
              autoComplete="new-password"
              className={controlClass}
            />
          </Field>
        </FieldGrid>
        <SubmitButton pendingLabel={savingLabel} className={submitClassName}>
          {submitLabel}
        </SubmitButton>
        {errorField === "form" ? (
          <FormStatus tone="danger" className="justify-center">
            {errorText}
          </FormStatus>
        ) : null}
      </form>
    </>
  );
}
