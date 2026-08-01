import type { Metadata } from "next";
import Link from "next/link";
import { MarketingFooter } from "@/components/MarketingFooter";
import { MarketingNav } from "@/components/MarketingNav";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { requestPasswordReset } from "./actions";

export const metadata: Metadata = {
  title: "Reset your password — DiveDay",
  robots: { index: false, follow: false },
};

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const { sent } = await searchParams;
  const t = diverTranslator(await requestLocale());

  return (
    <div className="flex flex-1 flex-col">
      <MarketingNav />
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-16">
        <div className="rounded-lg border border-border bg-surface p-6">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("account.forgotPassword.title")}
          </h1>
          <p className="mt-1 text-sm text-muted">{t("account.forgotPassword.description")}</p>
          {sent ? (
            <p
              role="status"
              className="mt-4 rounded-lg bg-success/10 px-3 py-2 text-sm text-success"
            >
              {t("account.forgotPassword.sent")}
            </p>
          ) : (
            <form action={requestPasswordReset} className="mt-5 flex flex-col gap-4">
              <FieldGrid columns={1} className="gap-y-4">
                <Field label={t("account.common.email")}>
                  <input
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    className={controlClass}
                  />
                </Field>
              </FieldGrid>
              <SubmitButton
                pendingLabel={t("account.forgotPassword.sending")}
                className={buttonClass()}
              >
                {t("account.forgotPassword.submit")}
              </SubmitButton>
            </form>
          )}
          <p className="mt-4 text-center text-sm text-muted">
            <Link href="/sign-in" className="text-primary font-medium hover:underline">
              {t("account.common.backToSignIn")}
            </Link>
          </p>
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}
