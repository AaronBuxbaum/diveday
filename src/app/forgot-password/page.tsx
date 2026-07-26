import type { Metadata } from "next";
import Link from "next/link";
import { MarketingFooter } from "@/components/MarketingFooter";
import { MarketingNav } from "@/components/MarketingNav";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
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

  return (
    <div className="flex flex-1 flex-col">
      <MarketingNav />
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-16">
        <div className="rounded-lg border border-border bg-surface p-6">
          <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
          <p className="mt-1 text-sm text-muted">
            Enter the email on your DiveDay account and we&apos;ll send a link to set a new one.
          </p>
          {sent ? (
            <p
              role="status"
              className="mt-4 rounded-lg bg-success/10 px-3 py-2 text-sm text-success"
            >
              If that email has a DiveDay account, a reset link is on its way.
            </p>
          ) : (
            <form action={requestPasswordReset} className="mt-5 flex flex-col gap-4">
              <FieldGrid columns={1} className="gap-y-4">
                <Field label="Email">
                  <input
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    className={controlClass}
                  />
                </Field>
              </FieldGrid>
              <SubmitButton pendingLabel="Sending…" className={buttonClass()}>
                Send reset link
              </SubmitButton>
            </form>
          )}
          <p className="mt-4 text-center text-sm text-muted">
            <Link href="/sign-in" className="text-primary font-medium hover:underline">
              Back to sign in
            </Link>
          </p>
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}
