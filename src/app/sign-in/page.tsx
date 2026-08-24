import { APIError } from "better-auth/api";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { MarketingNav, MarketingNavFallback } from "@/app/_components/MarketingNav";
import { EntryShell } from "@/components/account/EntryShell";
import { EntryShellSkeleton } from "@/components/account/EntryShellSkeleton";
import { MarketingFooter, MarketingFooterFallback } from "@/components/MarketingFooter";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid, FormStatus } from "@/components/ui/form";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { getAuth } from "@/lib/auth";
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

// Rate limiting lives in the custom credentials plugin's endpoint handler
// (src/lib/auth.ts), not here — it runs for every credentials attempt
// regardless of entry path (this page's action, or a direct POST to
// /api/auth/sign-in/diveday-credentials, if a route ever mounts the handler),
// so it is the one chokepoint that can't be bypassed. A check here too would
// double-consume the same budget (CR-013).
async function authenticate(formData: FormData) {
  "use server";
  try {
    const auth = await getAuth();
    await auth.api.signInDiveDayCredentials({
      body: {
        email: String(formData.get("email") ?? ""),
        password: String(formData.get("password") ?? ""),
      },
      headers: await headers(),
    });
  } catch (error) {
    if (error instanceof APIError) {
      redirect("/sign-in?error=1");
    }
    throw error;
  }
  // Outside the try: this redirect must never be caught as a refusal. Always
  // /shop, never `callbackUrl` — src/proxy.ts redirects a signed-in staffer
  // visiting the bare path on to their own shop immediately afterward.
  redirect("/shop");
}

/**
 * `callbackUrl` is set by src/proxy.ts when it bounces an unauthenticated
 * `/shop/**` visit here. Typed as possibly repeated because a URL can carry
 * it twice; only a single value is trusted.
 */
type SignInSearchParams = { error?: string; session?: string; callbackUrl?: string | string[] };

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
  const { error, session, callbackUrl } = await searchParams;
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
          className={buttonClass({
            variant: "link",
            size: "sm",
            className: "-my-2 -mr-3 self-end",
          })}
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
        {/* `?session=ended`: requireStaffSession() (src/lib/session.ts)
            forced this sign-out because a live database check found the
            account disabled, deleted, or demoted off every staff role since
            its token was minted (issue #701) — worth saying, since the
            visitor did nothing wrong on this device. */}
        {!error && session === "ended" ? (
          <FormStatus tone="warning" className="justify-center">
            {t("account.signIn.sessionEnded")}
          </FormStatus>
        ) : null}
      </form>
    </EntryShell>
  );
}
