import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { EntryShell } from "@/components/account/EntryShell";
import { ForgetThisDevice } from "@/components/ForgetThisDevice";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid, FormStatus } from "@/components/ui/form";
import { getDb } from "@/db/client";
import { hasPendingSignIn } from "@/db/sign-in-challenges";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { setUpHref } from "@/lib/funnel";
import { APP_ORIGIN, publicAppUrl } from "@/lib/notifications/app-url";
import { pendingCookie, readPendingHandle, signInOrigins } from "@/lib/pending-sign-in";
import { publicSchedulePath, shopSlugFromStaffUrl } from "@/lib/public-routes";
import { authenticate, cancelSignIn, confirmSignIn } from "./actions";
import { SignInStatus } from "./SignInStatus";

// Authentication forms must arrive as complete HTML: a streamed Suspense hole
// remains a skeleton when JavaScript is disabled. This route alone waits for
// locale/cookie/challenge reads (ADR 20261026-pending-sign-in-challenge).
export const instant = false;

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

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<SignInSearchParams>;
}) {
  const form = await SignInForm({ searchParams });
  return (
    <div className="flex flex-1 flex-col">
      {/* Every ended session lands here; the device keeps nothing of it. */}
      <ForgetThisDevice />
      {form}
    </div>
  );
}

async function SignInForm({ searchParams }: { searchParams: Promise<SignInSearchParams> }) {
  const { error, session, callbackUrl } = await searchParams;
  const t = diverTranslator(await requestLocale());
  const cookie = pendingCookie(
    signInOrigins(publicAppUrl() ?? APP_ORIGIN, process.env)[0],
    process.env.DIVEDAY_E2E === "1",
  );
  const handle = readPendingHandle(await headers(), cookie.name);
  const secondFactorRequired = handle ? await hasPendingSignIn(await getDb(), handle) : false;
  const restart =
    error === "restart" ||
    (!secondFactorRequired && ["two-factor", "invalid-code", "rate-limit"].includes(error ?? ""));
  // A diver who followed a `/shop/<slug>/…` link lands here with no way back to
  // the thing they wanted. `callbackUrl` names the shop; if it doesn't — no
  // parameter, a repeated one, or anything that isn't a `/shop/<slug>` path —
  // this stays null and the link is simply absent rather than pointing at a
  // guess.
  const publicShopSlug = shopSlugFromStaffUrl(typeof callbackUrl === "string" ? callbackUrl : null);

  return (
    <EntryShell
      wordmark
      homeLink
      title={t(secondFactorRequired ? "account.signIn.twoFactorTitle" : "account.signIn.title")}
      footer={
        <>
          {secondFactorRequired ? (
            <form action={cancelSignIn}>
              <SubmitButton
                pendingLabel={t("account.common.backToSignIn")}
                className={buttonClass({ variant: "link" })}
              >
                {t("account.common.backToSignIn")}
              </SubmitButton>
            </form>
          ) : null}
          <p className="flex items-center gap-4">
            <Link href="/privacy" className="hover:underline">
              {t("account.common.privacy")}
            </Link>
            <Link href="/terms" className="hover:underline">
              {t("account.common.terms")}
            </Link>
          </p>
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
      <form
        action={secondFactorRequired ? confirmSignIn : authenticate}
        className="flex flex-col gap-4"
      >
        <FieldGrid columns={1} className="gap-y-4">
          {/* Every field here is required, so no field carries the marker
              (visual review 2026-10-24, B46). */}
          {!secondFactorRequired ? (
            <>
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
            </>
          ) : null}
          {secondFactorRequired ? (
            <Field
              label={<span className="text-base">{t("account.signIn.twoFactorCode")}</span>}
              description={
                <span className="block text-sm">{t("account.signIn.twoFactorHint")}</span>
              }
              markRequired={false}
            >
              <input
                name="totpCode"
                inputMode="text"
                // biome-ignore lint/a11y/noAutofocus: this requested sign-in challenge moves focus to its next required input.
                autoFocus
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
        {!secondFactorRequired ? (
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
        ) : null}
        <SubmitButton pendingLabel={t("account.signIn.signingIn")} className={buttonClass()}>
          {t(secondFactorRequired ? "account.signIn.verify" : "account.signIn.submit")}
        </SubmitButton>
        {/* The refusal renders beside the control that earned it, not in a
            banner above the page (docs/design/forms-and-controls.md). */}
        {error && !secondFactorRequired ? (
          <SignInStatus>
            <FormStatus tone="danger" className="justify-center">
              {t(restart ? "account.signIn.restart" : "account.signIn.error")}
            </FormStatus>
          </SignInStatus>
        ) : null}
        {error === "invalid-code" && secondFactorRequired ? (
          <SignInStatus>
            <FormStatus tone="danger" className="justify-center">
              {t("account.signIn.invalidCode")}
            </FormStatus>
          </SignInStatus>
        ) : null}
        {error === "rate-limit" && secondFactorRequired ? (
          <SignInStatus>
            <FormStatus tone="danger" className="justify-center">
              {t("account.signIn.rateLimit")}
            </FormStatus>
          </SignInStatus>
        ) : null}
        {/* `?session=ended`: requireStaffSession() (src/lib/session.ts)
            forced this sign-out because a live database check found the
            account disabled, deleted, or demoted off every staff role since
            its token was minted (issue #701) — worth saying, since the
            visitor did nothing wrong on this device. */}
        {!error && session === "ended" ? (
          <SignInStatus>
            <FormStatus tone="warning" className="justify-center">
              {t("account.signIn.sessionEnded")}
            </FormStatus>
          </SignInStatus>
        ) : null}
      </form>
    </EntryShell>
  );
}
