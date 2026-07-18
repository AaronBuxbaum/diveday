import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { goToDemoScheduleAction, switchDemoRoleAction } from "@/app/actions/demo";
import { SubmitButton } from "@/components/SubmitButton";
import { getDb } from "@/db/client";
import { shops } from "@/db/schema";
import { signIn } from "@/lib/auth";

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
  const db = await getDb();
  const demoShop = await db
    .select({ slug: shops.slug })
    .from(shops)
    .where(eq(shops.isDemo, true))
    .limit(1);
  const demo = demoShop.length > 0;

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
        <p className="mt-4 text-center text-sm text-muted">
          Need a shop?{" "}
          <Link href="/onboard" className="text-primary font-medium hover:underline">
            Create a shop
          </Link>
        </p>
        {demo ? (
          <>
            <div className="mt-6 flex items-center gap-3 text-xs text-muted">
              <span className="h-px flex-1 bg-border" />
              explore the demo
              <span className="h-px flex-1 bg-border" />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-left">
              {[
                { role: "owner", title: "Admin / Owner", desc: "Dana Reyes", icon: "👑" },
                { role: "instructor", title: "Instructor", desc: "Marcus Webb", icon: "🎓" },
                { role: "divemaster", title: "Divemaster", desc: "Keiko Tanaka", icon: "🤿" },
                { role: "captain", title: "Captain", desc: "Sal Moretti", icon: "⚓" },
              ].map(({ role, title, desc, icon }) => {
                const action = switchDemoRoleAction.bind(null, role, demoShop[0].slug);
                return (
                  <form key={role} action={action}>
                    <SubmitButton
                      pendingLabel="Signing in…"
                      className="w-full flex flex-col items-start gap-1 rounded-lg border border-border bg-surface p-3 text-left transition-all duration-200 hover:border-primary/40 hover:-translate-y-0.5 cursor-pointer disabled:opacity-70"
                    >
                      <span className="text-sm font-semibold flex items-center gap-1 text-foreground">
                        <span>{icon}</span> {title}
                      </span>
                      <span className="text-xs text-muted font-normal">{desc}</span>
                    </SubmitButton>
                  </form>
                );
              })}
            </div>
            <form action={goToDemoScheduleAction.bind(null, demoShop[0].slug)} className="mt-2">
              <SubmitButton
                pendingLabel="Redirecting…"
                className="w-full min-h-11 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm font-semibold text-muted transition-all duration-200 hover:bg-surface-sunken hover:text-foreground cursor-pointer disabled:opacity-70"
              >
                🐬 Browse as Diver
              </SubmitButton>
            </form>
          </>
        ) : null}
      </div>
    </main>
  );
}
