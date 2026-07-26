import type { Metadata } from "next";
import { connection } from "next/server";
import { FlashParams } from "@/components/FlashParams";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { checkAccountToken } from "@/db/account-tokens";
import { getDb } from "@/db/client";
import { confirmEmailVerification } from "./actions";

export const metadata: Metadata = {
  title: "Confirm your email — DiveDay",
  robots: { index: false, follow: false },
};

function Notice({ title, text }: { title: string; text: string }) {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-16">
      <section className="rounded-2xl border border-border bg-surface p-7 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-3 text-muted">{text}</p>
      </section>
    </main>
  );
}

/**
 * Deliberately does not confirm on the bare GET: a corporate link-prescanner
 * pre-fetching this URL would otherwise burn the one-time token before the
 * person ever clicks it. The button's own submit is what consumes it
 * (20260725-account-lifecycle-emails).
 */
export default async function VerifyAccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ confirmed?: string }>;
}) {
  await connection();
  const { token } = await params;
  const { confirmed } = await searchParams;

  if (confirmed === "1") {
    return (
      <>
        <FlashParams params={["confirmed"]} />
        <Notice title="Email confirmed" text="Thanks — your email is confirmed. You're all set." />
      </>
    );
  }

  const db = await getDb();
  const check = await checkAccountToken(db, { token, purpose: "email_verification" });
  if (!check) {
    return (
      <Notice
        title="This confirmation link isn't valid"
        text="It may have expired or already been used. If you already confirmed your email, you're all set — sign in and carry on."
      />
    );
  }

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-16">
      <section className="rounded-2xl border border-border bg-surface p-7 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Confirm your email</h1>
        <p className="mt-3 text-muted">
          Confirm this is your email address so we know it&apos;s really you.
        </p>
        <form action={confirmEmailVerification.bind(null, token)} className="mt-5">
          <SubmitButton pendingLabel="Confirming…" className={buttonClass()}>
            Confirm my email
          </SubmitButton>
        </form>
      </section>
    </main>
  );
}
