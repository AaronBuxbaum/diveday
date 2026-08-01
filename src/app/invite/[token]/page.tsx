import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Notice } from "@/components/account/Notice";
import { passwordConfirmErrorText } from "@/components/account/passwordConfirmError";
import { ShopNotice } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { checkAccountToken } from "@/db/account-tokens";
import { getDb } from "@/db/client";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/lib/onboarding";
import { acceptStaffInvite } from "./actions";

export const metadata: Metadata = {
  title: "Accept your invite — DiveDay",
  robots: { index: false, follow: false },
};

/**
 * Doesn't mutate on the bare GET, same as `/verify/[token]` and
 * `/reset-password/[token]` — only the form's own submit consumes the
 * one-time token (20260726-staff-invite-accounts).
 */
// Bearer-token page (the URL is the capability, docs/engineering/
// capability-telemetry-runbook.md) — reads `params`/`searchParams`/
// `requestLocale()`/`connection()` unguarded, genuinely request-scoped, not
// in scope for the "use cache" hoist. See the shop layout's `instant =
// false` comment (src/app/shop/[shopSlug]/layout.tsx) for what this does
// and doesn't do.
export const instant = false;

export default async function InvitePage({
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
  const check = await checkAccountToken(db, { token, purpose: "invite" });
  if (!check) {
    return (
      <Notice
        title={t("account.invite.unavailableTitle")}
        text={t("account.invite.unavailableText")}
        backToSignIn={t("account.common.backToSignIn")}
      />
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <div className="rounded-lg border border-border bg-surface p-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t("account.invite.title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("account.invite.description")}</p>
        {error ? (
          <ShopNotice tone="danger" role="alert" className="mt-4">
            {passwordConfirmErrorText(t, error)}
          </ShopNotice>
        ) : null}
        <form action={acceptStaffInvite.bind(null, token)} className="mt-5 flex flex-col gap-4">
          <FieldGrid columns={1} className="gap-y-4">
            <Field label={t("account.common.password")}>
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
            <Field label={t("account.invite.confirmPassword")}>
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
            {t("account.invite.submit")}
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
