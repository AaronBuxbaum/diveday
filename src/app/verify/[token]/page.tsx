import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { EntryDone, EntryShell } from "@/components/account/EntryShell";
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
// `instant = true`: this route has a real static shell. Every request-scoped
// read below sits inside this segment's `loading.tsx` boundary, so the frame
// paints without waiting on the request and the data streams into it —
// and `next build` fails if that ever stops being true.
// See ADR 20260804-instant-navigation.
export const instant = true;

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
          <EntryDone
            glyph="🎉"
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
      <EntryDone
        glyph="⏳"
        title={t("account.verify.unavailableTitle")}
        text={t("account.verify.unavailableText")}
        action={
          <Link href="/sign-in" className="font-medium text-primary hover:underline">
            {t("account.common.backToSignIn")}
          </Link>
        }
      />
    );
  }

  // One question, one button — a panel around a single control is chrome
  // (docs/design/principles.md #10), so the shell renders none.
  return (
    <EntryShell wordmark panel={false} title={t("account.verify.title")}>
      <form action={confirmEmailVerification.bind(null, token)}>
        <SubmitButton pendingLabel={t("account.verify.confirming")} className={buttonClass()}>
          {t("account.verify.submit")}
        </SubmitButton>
      </form>
    </EntryShell>
  );
}
