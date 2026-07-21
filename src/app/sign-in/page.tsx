import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { MarketingFooter } from "@/components/MarketingFooter";
import { MarketingNav } from "@/components/MarketingNav";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { signIn } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Sign in — DiveDay",
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
    <div className="flex min-h-full flex-col">
      <MarketingNav />
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-16">
        <div className="rounded-lg border border-border bg-surface p-6">
          <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mt-1 text-sm text-muted">Sign in to run the shop.</p>
          {error ? (
            <p role="alert" className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
              That email and password don&apos;t match — give it another go.
            </p>
          ) : null}
          <form action={authenticate} className="mt-5 flex flex-col gap-4">
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
              <Field label="Password">
                <input
                  name="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  className={controlClass}
                />
              </Field>
            </FieldGrid>
            <SubmitButton pendingLabel="Signing in…" className={buttonClass()}>
              Sign in
            </SubmitButton>
          </form>
          <p className="mt-4 text-center text-sm text-muted">
            Need a shop?{" "}
            <Link href="/onboard" className="text-primary font-medium hover:underline">
              Create a shop
            </Link>
          </p>
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}
