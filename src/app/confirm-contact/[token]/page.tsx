import type { Metadata } from "next";
import { connection } from "next/server";
import { EntryDone, EntryShell } from "@/components/account/EntryShell";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { getDb } from "@/db/client";
import {
  checkShopContactEmailConfirmation,
  wasShopContactEmailConfirmed,
} from "@/db/shop-contact-email";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { confirmContactEmail } from "./actions";

export const metadata: Metadata = {
  title: "Confirm this address — DiveDay",
  robots: { index: false, follow: false },
};

/**
 * Where the shop's front desk lands from the confirmation email (issue #1288).
 * Deliberately does not confirm on the bare GET: a corporate link pre-scanner
 * fetching this URL would otherwise burn the one-time token before anyone
 * clicked (same reasoning as `/verify/[token]`). The button's own submit is
 * what consumes it, and the success state is read back from the token row --
 * never from a query flag a caller could forge.
 */
// `instant = true`: this route has a real static shell. Every request-scoped
// read below sits inside this segment's `loading.tsx` boundary, so the frame
// paints without waiting on the request and the data streams into it —
// and `next build` fails if that ever stops being true.
// See ADR 20260804-instant-navigation.
export const instant = true;

export default async function ConfirmContactPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  await connection();
  const { token } = await params;
  const db = await getDb();
  const t = diverTranslator(await requestLocale());

  const confirmed = await wasShopContactEmailConfirmed(db, { token });
  if (confirmed) {
    return (
      <EntryDone
        glyph="done"
        title={t("contactConfirm.confirmedTitle")}
        text={t("contactConfirm.confirmedText", { shopName: confirmed.shopName })}
      />
    );
  }

  const check = await checkShopContactEmailConfirmation(db, { token });
  if (!check) {
    return (
      <EntryDone
        glyph="expired"
        title={t("contactConfirm.unavailableTitle")}
        text={t("contactConfirm.unavailableText")}
      />
    );
  }

  // One question, one button — a panel around a single control is chrome
  // (docs/design/principles.md #10), so the shell renders none.
  return (
    <EntryShell
      wordmark
      panel={false}
      title={t("contactConfirm.title", { shopName: check.shopName })}
      description={t("contactConfirm.description", {
        shopName: check.shopName,
        email: check.email,
      })}
    >
      <form action={confirmContactEmail.bind(null, token)}>
        <SubmitButton pendingLabel={t("contactConfirm.confirming")} className={buttonClass()}>
          {t("contactConfirm.submit")}
        </SubmitButton>
      </form>
    </EntryShell>
  );
}
