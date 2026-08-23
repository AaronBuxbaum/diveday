import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { EntryDone, EntryShell } from "@/components/account/EntryShell";
import {
  passwordConfirmErrorField,
  passwordConfirmErrorText,
} from "@/components/account/passwordConfirmError";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { FieldErrorFocus } from "@/components/ui/FieldErrorFocus";
import { controlClass, Field, FieldGrid, FormStatus } from "@/components/ui/form";
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
      <EntryDone
        glyph="⏳"
        title={t("account.invite.unavailableTitle")}
        text={t("account.invite.unavailableText")}
        action={
          <Link href="/sign-in" className="font-medium text-primary hover:underline">
            {t("account.common.backToSignIn")}
          </Link>
        }
      />
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
          <Link href="/sign-in" className="font-medium text-primary hover:underline">
            {t("account.common.backToSignIn")}
          </Link>
        </p>
      }
    >
      {errorField && errorField !== "form" ? <FieldErrorFocus key={error} /> : null}
      <form action={acceptStaffInvite.bind(null, token)} className="flex flex-col gap-4">
        <FieldGrid columns={1} className="gap-y-4">
          <Field
            label={t("account.common.password")}
            error={errorField === "password" ? errorText : undefined}
          >
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
            label={t("account.invite.confirmPassword")}
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
        <SubmitButton pendingLabel={t("account.common.saving")} className={buttonClass()}>
          {t("account.invite.submit")}
        </SubmitButton>
        {errorField === "form" ? (
          <FormStatus tone="danger" className="justify-center">
            {errorText}
          </FormStatus>
        ) : null}
      </form>
    </EntryShell>
  );
}
