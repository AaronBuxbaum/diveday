import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { Suspense } from "react";
import { MarketingFooter, MarketingFooterFallback } from "@/components/MarketingFooter";
import { MarketingNav, MarketingNavFallback } from "@/components/MarketingNav";
import { ShopNotice } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { signIn } from "@/lib/auth";
import { trialHref } from "@/lib/funnel";
import { publicSchedulePath, shopSlugFromStaffUrl } from "@/lib/public-routes";

// This page was instant before the rest of the app was (ADR
// 20260804-instant-navigation) — `searchParams`/`requestLocale()` are read
// inside `SignInForm` below, wrapped in its own `<Suspense>`, rather than
// opted out of with `instant = false`. Not merely tidier: without a real
// boundary the route still gets a Partial-Prerendered static shell, but with
// an *implicit* dynamic hole around the unwrapped read — and a
// `redirect("/sign-in?error=1")` fired from the wrong-password path raced that
// hole's own pending fetch and got `net::ERR_ABORTED`, leaving the form stuck
// on "Signing in…" forever (caught by e2e/auth.spec.ts). An explicit boundary
// makes the dynamic part exactly what streams in on redirect, instead of
// leaving Next to guess.
export const instant = true;

export async function generateMetadata(): Promise<Metadata> {
  const t = diverTranslator(await requestLocale());
  return { title: t("account.signIn.metaTitle") };
}

// Rate limiting lives in the Credentials provider's authorize() callback
// (src/lib/auth.ts), not here — NextAuth invokes that for every credentials
// attempt regardless of entry path (this page's action, or a direct POST to
// /api/auth/callback/credentials), so it is the one chokepoint that can't
// be bypassed. A check here too would double-consume the same budget
// (CR-013).
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

/**
 * `callbackUrl` is Auth.js's own parameter, set when it bounces an unauthorized
 * request here. Typed as possibly repeated because a URL can carry it twice;
 * only a single value is trusted.
 */
type SignInSearchParams = { error?: string; callbackUrl?: string | string[] };

export default function SignInPage({
  searchParams,
}: {
  searchParams: Promise<SignInSearchParams>;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <Suspense fallback={<MarketingNavFallback />}>
        <MarketingNav />
      </Suspense>
      <Suspense fallback={<main className="flex-1" />}>
        <SignInForm searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={<MarketingFooterFallback />}>
        <MarketingFooter />
      </Suspense>
    </div>
  );
}

async function SignInForm({ searchParams }: { searchParams: Promise<SignInSearchParams> }) {
  const { error, callbackUrl } = await searchParams;
  const t = diverTranslator(await requestLocale());
  // A diver who followed a `/shop/<slug>/…` link lands here with no way back to
  // the thing they wanted. `callbackUrl` names the shop; if it doesn't — no
  // parameter, a repeated one, or anything that isn't a `/shop/<slug>` path —
  // this stays null and the link is simply absent rather than pointing at a
  // guess.
  const publicShopSlug = shopSlugFromStaffUrl(typeof callbackUrl === "string" ? callbackUrl : null);

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-16">
      <div className="rounded-lg border border-border bg-surface p-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t("account.signIn.title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("account.signIn.description")}</p>
        {error ? (
          <ShopNotice tone="danger" role="alert" className="mt-4">
            {t("account.signIn.error")}
          </ShopNotice>
        ) : null}
        <form action={authenticate} className="mt-5 flex flex-col gap-4">
          <FieldGrid columns={1} className="gap-y-4">
            <Field label={t("account.common.email")}>
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                className={controlClass}
              />
            </Field>
            <Field label={t("account.common.password")}>
              <input
                name="password"
                type="password"
                required
                autoComplete="current-password"
                className={controlClass}
              />
            </Field>
          </FieldGrid>
          <div className="flex justify-end">
            <Link href="/forgot-password" className="text-sm text-primary hover:underline">
              {t("account.signIn.forgotPassword")}
            </Link>
          </div>
          <SubmitButton pendingLabel={t("account.signIn.signingIn")} className={buttonClass()}>
            {t("account.signIn.submit")}
          </SubmitButton>
        </form>
        <p className="mt-4 text-center text-sm text-muted">
          {t("account.signIn.needShop")}{" "}
          <Link href={trialHref("sign-in")} className="text-primary font-medium hover:underline">
            {t("account.signIn.createShop")}
          </Link>
        </p>
        {publicShopSlug ? (
          <p className="mt-2 text-center text-sm">
            <Link
              href={publicSchedulePath(publicShopSlug)}
              className="text-primary hover:underline"
            >
              {t("account.signIn.publicSchedule")}
            </Link>
          </p>
        ) : null}
      </div>
    </main>
  );
}
