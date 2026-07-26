import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { checkAccountToken } from "@/db/account-tokens";
import { getDb } from "@/db/client";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/lib/onboarding";
import { submitPasswordReset } from "./actions";

export const metadata: Metadata = {
  title: "Set a new password — DiveDay",
  robots: { index: false, follow: false },
};

function Notice({ title, text }: { title: string; text: string }) {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-16">
      <section className="rounded-2xl border border-border bg-surface p-7 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-3 text-muted">{text}</p>
        <p className="mt-4 text-sm text-muted">
          <Link href="/sign-in" className="font-medium text-primary hover:underline">
            Back to sign in
          </Link>
        </p>
      </section>
    </main>
  );
}

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

  const db = await getDb();
  const check = await checkAccountToken(db, { token, purpose: "password_reset" });
  if (!check) {
    return (
      <Notice
        title="This reset link isn’t available"
        text="It may have expired or already been used — reset links work once, within an hour. Ask for a fresh one from the sign-in page."
      />
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <div className="rounded-lg border border-border bg-surface p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Set a new password</h1>
        <p className="mt-1 text-sm text-muted">Choose a new password for your DiveDay account.</p>
        {error ? (
          <p role="alert" className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
        <form action={submitPasswordReset.bind(null, token)} className="mt-5 flex flex-col gap-4">
          <FieldGrid columns={1} className="gap-y-4">
            <Field label="New password">
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
            <Field label="Confirm new password">
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
          <SubmitButton pendingLabel="Saving…" className={buttonClass()}>
            Set new password
          </SubmitButton>
        </form>
        <p className="mt-4 text-center text-sm text-muted">
          <Link href="/sign-in" className="text-primary font-medium hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
