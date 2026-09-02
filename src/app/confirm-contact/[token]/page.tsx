import type { Metadata } from "next";
import { connection } from "next/server";
import { EntryDone, EntryShell } from "@/components/account/EntryShell";
import { FlashParams } from "@/components/FlashParams";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { getDb } from "@/db/client";
import {
  checkShopContactEmailToken,
  wasShopContactEmailTokenConsumed,
} from "@/db/shop-contact-email";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { confirmContactEmail } from "./actions";

export const metadata: Metadata = {
  title: "Confirm your reply address — DiveDay",
  robots: { index: false, follow: false },
};

/**
 * The shop's own front desk proving it reads the address it published (issue
 * #1288). Until this happens, DiveDay sends diver mail with no `Reply-To` at
 * all — the same way it did before the header existed — because routing a
 * diver's reply somewhere is a promise about a mailbox nobody has checked.
 *
 * **The bare GET confirms nothing**, for the reason `/verify/[token]` doesn't:
 * a corporate link-prescanner fetching the URL out of the inbox would otherwise
 * burn the one-time token before anybody read the message. The button's own
 * submit is what consumes it — and here the person clicking it is the proof.
 *
 * No shop name and no sign-in link on the failure: this address may be a shared
 * front desk read by somebody with no DiveDay account at all, and a dead link
 * is not the moment to tell an unauthenticated reader which shop it belonged
 * to.
 */
// `instant = true`: this route has a real static shell. Every request-scoped
// read below sits inside this segment's `loading.tsx` boundary, so the frame
// paints without waiting on the request and the data streams into it.
// See ADR 20260804-instant-navigation.
export const instant = true;

export default async function ConfirmContactEmailPage({
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

  // Never the query parameter alone — it is caller-controlled, so a garbage
  // token with a forged `?confirmed=1` must still read as failed. Only a token
  // this request actually consumed earns the success notice (the security
  // review finding `/verify/[token]` carries the same guard for).
  if (confirmed === "1" && (await wasShopContactEmailTokenConsumed(db, token))) {
    return (
      <>
        <FlashParams params={["confirmed"]} />
        <EntryDone
          glyph="done"
          title={t("account.confirmContact.confirmedTitle")}
          text={t("account.confirmContact.confirmedText")}
        />
      </>
    );
  }

  const check = await checkShopContactEmailToken(db, { token });
  if (!check) {
    return (
      <EntryDone
        glyph="expired"
        title={t("account.confirmContact.unavailableTitle")}
        text={t("account.confirmContact.unavailableText")}
      />
    );
  }

  // One question, one button — a panel around a single control is chrome
  // (docs/design/principles.md #10), so the shell renders none. The address is
  // on screen because the reader has to know *which* mailbox they are vouching
  // for; it is the one they are reading this in, so nothing is disclosed.
  return (
    <EntryShell
      wordmark
      panel={false}
      title={t("account.confirmContact.title")}
      description={t("account.confirmContact.description", { email: check.email })}
    >
      <form action={confirmContactEmail.bind(null, token)}>
        <SubmitButton
          pendingLabel={t("account.confirmContact.confirming")}
          className={buttonClass()}
        >
          {t("account.confirmContact.submit")}
        </SubmitButton>
      </form>
    </EntryShell>
  );
}
