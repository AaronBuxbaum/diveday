import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { MarketingNav, MarketingNavFallback } from "@/app/_components/MarketingNav";
import { EntryShell } from "@/components/account/EntryShell";
import { EntryShellSkeleton } from "@/components/account/EntryShellSkeleton";
import { ForgetThisDevice } from "@/components/ForgetThisDevice";
import { MarketingFooter, MarketingFooterFallback } from "@/components/MarketingFooter";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid, FormStatus } from "@/components/ui/form";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { setUpHref } from "@/lib/funnel";
import { publicSchedulePath, shopSlugFromStaffUrl } from "@/lib/public-routes";
import { authenticate } from "./actions";

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
      {/* Every ended session lands here; the device keeps nothing of it. */}
      <ForgetThisDevice />
      <Suspense fallback={<MarketingNavFallback />}>
        <MarketingNav />
      </Suspense>
      <Suspense
        fallback={
          <EntryShellSkeleton description={false} trailingLink fields={["email", "password"]} />
        }
      >
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
  const secondFactorRequired = error === "two-factor";
  // A diver who followed a `/shop/<slug>/…` link lands here with no way back to
  // the thing they wanted. `callbackUrl` names the shop; if it doesn't — no
  // parameter, a repeated one, or anything that isn't a `/shop/<slug>` path —
  // this stays null and the link is simply absent rather than pointing at a
  // guess.
  const publicShopSlug = shopSlugFromStaffUrl(typeof callbackUrl === "string" ? callbackUrl : null);

  return (
    <EntryShell
      title={t("account.signIn.title")}
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
            <Link href={setUpHref("sign-in")} className="font-medium text-primary hover:underline">
              {t("marketing.common.getSetUp")}
            </Link>
          </p>
        </>
      }
    >
      <form action={authenticate} className="flex flex-col gap-4">
        <FieldGrid columns={1} className="gap-y-4">
          {/* Every field here is required, so no field carries the marker
              (visual review 2026-10-24, B46). */}
          <Field label={t("account.common.email")} markRequired={false}>
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              className={controlClass}
            />
          </Field>
          <Field label={t("account.common.password")} markRequired={false}>
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className={controlClass}
            />
          </Field>
          {secondFactorRequired ? (
            <Field
              label={t("account.signIn.twoFactorCode")}
              hint={t("account.signIn.twoFactorHint")}
              markRequired={false}
            >
              <input
                name="totpCode"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9A-Za-z-]{6,32}"
                maxLength={32}
                required
                className={controlClass}
              />
            </Field>
          ) : null}
        </FieldGrid>
        {/* The link claims a full touch target (dock test); `-my-2` keeps the
            visual rhythm of the stack it sits in, and `flush` puts its end on
            the fields' edge. */}
        <Link
          href="/forgot-password"
          className={buttonClass({
            variant: "link",
            flush: true,
            className: "-my-2 self-end",
          })}
        >
          {t("account.signIn.forgotPassword")}
        </Link>
        <SubmitButton pendingLabel={t("account.signIn.signingIn")} className={buttonClass()}>
          {t("account.signIn.submit")}
        </SubmitButton>
        {/* The refusal renders beside the control that earned it, not in a
            banner above the page (docs/design/forms-and-controls.md). */}
        {error && !secondFactorRequired ? (
          <FormStatus tone="danger" className="justify-center">
            {t("account.signIn.error")}
          </FormStatus>
        ) : null}
        {secondFactorRequired ? (
          <FormStatus tone="danger" className="justify-center">
            {t("account.signIn.twoFactorRequired")}
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
