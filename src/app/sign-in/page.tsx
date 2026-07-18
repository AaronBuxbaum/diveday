import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { enterDemoAction } from "@/app/actions/demo";
import { SubmitButton } from "@/components/SubmitButton";
import { signIn } from "@/lib/auth";
import { isDemoMode } from "@/lib/demo";

export const metadata: Metadata = {
  title: "Sign in — Scuba",
};

async function authenticate(formData: FormData) {
  "use server";
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: "/shop",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      redirect("/sign-in?error=1");
    }
    throw error; // NEXT_REDIRECT and unexpected errors propagate
  }
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-16">
      <Link href="/" className="text-sm font-medium tracking-widest text-primary uppercase">
        Scuba
      </Link>
      <div className="rounded-lg border border-border bg-surface p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
        <p className="mt-1 text-sm text-muted">Sign in to run the shop.</p>
        {error ? (
          <p role="alert" className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            That email and password don&apos;t match — give it another go.
          </p>
        ) : null}
        <form action={authenticate} className="mt-5 flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Email
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 py-2 text-base font-normal"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Password
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 py-2 text-base font-normal"
            />
          </label>
          <button
            type="submit"
            className="min-h-11 rounded-lg bg-primary px-4 py-2.5 font-medium text-primary-foreground transition-colors duration-200 hover:bg-primary-hover"
          >
            Sign in
          </button>
        </form>
        {isDemoMode() ? (
          <>
            <div className="mt-6 flex items-center gap-3 text-xs text-muted">
              <span className="h-px flex-1 bg-border" />
              just looking?
              <span className="h-px flex-1 bg-border" />
            </div>
            <form action={enterDemoAction} className="mt-4">
              <SubmitButton
                pendingLabel="Spinning up your shop…"
                className="min-h-11 w-full rounded-lg border border-border-strong bg-surface px-4 py-2.5 font-medium transition-colors duration-200 hover:bg-surface-sunken disabled:opacity-70"
              >
                Explore the demo shop
              </SubmitButton>
            </form>
          </>
        ) : null}
      </div>
    </main>
  );
}
