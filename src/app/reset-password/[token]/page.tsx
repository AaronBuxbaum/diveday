import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Notice } from "@/components/account/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { checkAccountToken } from "@/db/account-tokens";
import { getDb } from "@/db/client";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/lib/onboarding";
import { submitPasswordReset } from "./actions";

export const metadata: Metadata = {
  title: "Set a new password — DiveDay",
  robots: { index: false, follow: false },
};

/**
 * Doesn't mutate on the bare GET, same as `/verify/[token]` — only the
 * form's own submit consumes the one-time token
 * (20260725-account-lifecycle-emails).
 */
export default async function ResetPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  await connection();
  const { token } = await params;
  const { error } = await searchParams;
  const t = diverTranslator(await requestLocale());

  const db = await getDb();
  const check = await checkAccountToken(db, { token, purpose: "password_reset" });
  if (!check) {
    return (
      <Notice
        title={t("account.resetPassword.unavailableTitle")}
        text={t("account.resetPassword.unavailableText")}
        backToSignIn={t("account.common.backToSignIn")}
      />
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <div className="rounded-lg border border-border bg-surface p-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("account.resetPassword.title")}
        </h1>
        <p className="mt-1 text-sm text-muted">{t("account.resetPassword.description")}</p>
        {error ? (
          <p role="alert" className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
        <form action={submitPasswordReset.bind(null, token)} className="mt-5 flex flex-col gap-4">
          <FieldGrid columns={1} className="gap-y-4">
            <Field label={t("account.resetPassword.newPassword")}>
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
            <Field label={t("account.resetPassword.confirmPassword")}>
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
          <SubmitButton pendingLabel={t("account.common.saving")} className={buttonClass()}>
            {t("account.resetPassword.submit")}
          </SubmitButton>
        </form>
        <p className="mt-4 text-center text-sm text-muted">
          <Link href="/sign-in" className="text-primary font-medium hover:underline">
            {t("account.common.backToSignIn")}
          </Link>
        </p>
      </div>
    </main>
  );
}
