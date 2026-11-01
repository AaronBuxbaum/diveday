import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
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
// `instant = true`: this route has a real static shell. Every request-scoped
// read below sits inside this segment's `loading.tsx` boundary, so the frame
// paints without waiting on the request and the data streams into it —
// and `next build` fails if that ever stops being true.
// See ADR 20260804-instant-navigation.
export const instant = true;

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
  // **Terse on purpose, and decided rather than inherited** (issue #801).
  //
  // The three bearer-token pages that carry a *booking* now name the shop on a
  // dead link, because the diver's question is "who do I ask" and the token
  // still says which shop issued it. This one is different in both halves. An
  // invite is a staff invitation, so naming the shop would tell whoever holds a
  // forwarded or leaked link which shop invited somebody — a disclosure the
  // diver-facing pages do not make, because there the bearer *is* the customer.
  // And the way forward is not self-serve: a dead invite is reissued by the
  // person who sent it, not by this page. "Back to sign in" is the honest door,
  // and it is already here.
  if (!check) {
    return (
      <DeadLink t={t} next={t("account.invite.unavailableText")} diveDayDoor={false}>
        <Link href="/sign-in" className="font-medium text-primary hover:underline print:hidden">
          {t("account.common.backToSignIn")}
        </Link>
      </DeadLink>
    );
  }

  // Same field-routing as /reset-password: the refusal lands on the box that
  // earned it, routed by the shared typed map beside the message resolver.
  const errorText = error ? passwordConfirmErrorText(t, error) : undefined;
  const errorField = error ? passwordConfirmErrorField(error) : undefined;

  return (
    <EntryShell
      wordmark
      title={t("account.invite.title")}
      description={t("account.invite.description")}
      footer={
        <p>
          <Link href="/sign-in" className="font-medium text-primary hover:underline print:hidden">
            {t("account.common.backToSignIn")}
          </Link>
        </p>
      }
    >
      <PasswordConfirmForm
        action={acceptStaffInvite.bind(null, token)}
        passwordLabel={t("account.common.password")}
        confirmPasswordLabel={t("account.invite.confirmPassword")}
        submitLabel={t("account.invite.submit")}
        savingLabel={t("account.common.saving")}
        submitClassName={buttonClass()}
        errorKey={error}
        errorField={errorField}
        errorText={errorText}
      />
    </EntryShell>
  );
}
