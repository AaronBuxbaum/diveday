import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { Suspense } from "react";
import { EntryShell } from "@/components/account/EntryShell";
import { EntryShellSkeleton } from "@/components/account/EntryShellSkeleton";
import { MarketingFooter, MarketingFooterFallback } from "@/components/MarketingFooter";
import { MarketingNav, MarketingNavFallback } from "@/components/MarketingNav";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid, FormStatus } from "@/components/ui/form";
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
      <Suspense fallback={<EntryShellSkeleton fields={["email", "password"]} />}>
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
    <EntryShell
      title={t("account.signIn.title")}
      description={t("account.signIn.description")}
      footer={
        <>
          {/* A diver who followed a staff link isn't lost — their shop's own
              schedule is the useful surface at this moment, so it leads. */}
          {publicShopSlug ? (
            <p>
              <Link
                href={publicSchedulePath(publicShopSlug)}
                className="font-medium text-primary hover:underline"
              >
                {t("account.signIn.publicSchedule")}
              </Link>
            </p>
          ) : null}
          <p>
            {t("account.signIn.needShop")}{" "}
            <Link href={trialHref("sign-in")} className="font-medium text-primary hover:underline">
              {t("account.signIn.createShop")}
            </Link>
          </p>
        </>
      }
    >
      <form action={authenticate} className="flex flex-col gap-4">
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
        {/* The link claims a full touch target (dock test); negative margins
            keep the visual rhythm of the stack it sits in. */}
        <Link
          href="/forgot-password"
          className={buttonClass({ variant: "link", size: "sm", className: "-my-2 -mr-3 self-end" })}
        >
          {t("account.signIn.forgotPassword")}
        </Link>
        <SubmitButton pendingLabel={t("account.signIn.signingIn")} className={buttonClass()}>
          {t("account.signIn.submit")}
        </SubmitButton>
        {/* The refusal renders beside the control that earned it, not in a
            banner above the page (docs/design/forms-and-controls.md). */}
        {error ? (
          <FormStatus tone="danger" className="justify-center">
            {t("account.signIn.error")}
          </FormStatus>
        ) : null}
      </form>
    </EntryShell>
  );
}
