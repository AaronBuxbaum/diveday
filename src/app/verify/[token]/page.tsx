import type { Metadata } from "next";
import { connection } from "next/server";
import { Notice } from "@/components/account/Notice";
import { FlashParams } from "@/components/FlashParams";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { checkAccountToken, wasAccountTokenConsumed } from "@/db/account-tokens";
import { getDb } from "@/db/client";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { confirmEmailVerification } from "./actions";

export const metadata: Metadata = {
  title: "Confirm your email — DiveDay",
  robots: { index: false, follow: false },
};

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
  const db = await getDb();
  const t = diverTranslator(await requestLocale());

  // Never trust the query param alone — it's caller-controlled, so a garbage
  // token with a forged `?confirmed=1` must still read as failed rather than
  // as a false success (security review finding). Only a token this exact
  // request actually consumed earns the success notice.
  if (confirmed === "1") {
    const consumed = await wasAccountTokenConsumed(db, { token, purpose: "email_verification" });
    if (consumed) {
      return (
        <>
          <FlashParams params={["confirmed"]} />
          <Notice
            title={t("account.verify.confirmedTitle")}
            text={t("account.verify.confirmedText")}
          />
        </>
      );
    }
  }

  const check = await checkAccountToken(db, { token, purpose: "email_verification" });
  if (!check) {
    // Task 45: this used to be a dead end with nothing else to click — a
    // sibling of the same no-link problem the waiver token pages had. There
    // is no shop to attribute an account-lifecycle token to, but there is
    // always a way back to sign in, the same recovery `/invite` and
    // `/reset-password` already offer their own dead links.
    return (
      <Notice
        title={t("account.verify.unavailableTitle")}
        text={t("account.verify.unavailableText")}
        backToSignIn={t("account.common.backToSignIn")}
      />
    );
  }

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-16">
      <section className="rounded-2xl border border-border bg-surface p-7 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{t("account.verify.title")}</h1>
        <p className="mt-3 text-muted">{t("account.verify.description")}</p>
        <form action={confirmEmailVerification.bind(null, token)} className="mt-5">
          <SubmitButton pendingLabel={t("account.verify.confirming")} className={buttonClass()}>
            {t("account.verify.submit")}
          </SubmitButton>
        </form>
      </section>
    </main>
  );
}
