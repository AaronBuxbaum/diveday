import type { Metadata } from "next";
import Link from "next/link";
import { EntryShell } from "@/components/account/EntryShell";
import { PasswordConfirmForm } from "@/components/account/PasswordConfirmForm";
import {
  passwordConfirmErrorField,
  passwordConfirmErrorText,
} from "@/components/account/passwordConfirmError";
import { DeadLink } from "@/components/DeadLink";
import { buttonClass } from "@/components/ui/button";
import { checkAccountToken } from "@/db/account-tokens";
import { getDb } from "@/db/client";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { connectionForRoute } from "@/lib/observability/render-connection";
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
// `instant = true`: this route has a real static shell. Every request-scoped
// read below sits inside this segment's `loading.tsx` boundary, so the frame
// paints without waiting on the request and the data streams into it —
// and `next build` fails if that ever stops being true.
// See ADR 20260804-instant-navigation.
export const instant = true;

export default async function ResetPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  await connectionForRoute("/reset-password/[token]");
  const { token } = await params;
  const { error } = await searchParams;
  const t = diverTranslator(await requestLocale());

  const db = await getDb();
  const check = await checkAccountToken(db, { token, purpose: "password_reset" });
  // **Terse on purpose, and decided rather than inherited** (issue #801).
  //
  // An account token belongs to a person, not to a shop — there is no shop to
  // name here even in principle, and the way forward is asking for a fresh
  // email, which the sign-in page offers. Unlike a booking's readiness link,
  // nothing about this dead end leaves the diver wondering who to contact.
  if (!check) {
    return (
      <DeadLink t={t} next={t("account.resetPassword.unavailableText")} diveDayDoor={false}>
        <Link href="/sign-in" className="font-medium text-primary hover:underline print:hidden">
          {t("account.common.backToSignIn")}
        </Link>
      </DeadLink>
    );
  }

  // The refusal lands on the box that earned it (docs/design/forms-and-
  // controls.md), routed by the shared typed map beside the message resolver.
  const errorText = error ? passwordConfirmErrorText(t, error) : undefined;
  const errorField = error ? passwordConfirmErrorField(error) : undefined;

  return (
    <EntryShell
      wordmark
      title={t("account.resetPassword.title")}
      description={t("account.resetPassword.description")}
      footer={
        <p>
          <Link href="/sign-in" className="font-medium text-primary hover:underline print:hidden">
            {t("account.common.backToSignIn")}
          </Link>
        </p>
      }
    >
      <PasswordConfirmForm
        action={submitPasswordReset.bind(null, token)}
        passwordLabel={t("account.resetPassword.newPassword")}
        confirmPasswordLabel={t("account.resetPassword.confirmPassword")}
        submitLabel={t("account.resetPassword.submit")}
        savingLabel={t("account.common.saving")}
        submitClassName={buttonClass()}
        errorKey={error}
        errorField={errorField}
        errorText={errorText}
      />
    </EntryShell>
  );
}
