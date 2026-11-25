import type { Metadata } from "next";
import { EntryShell } from "@/components/account/EntryShell";
import { OpenOnArrival } from "@/components/OpenOnArrival";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { redeemDiverSignIn } from "./actions";

export const instant = true;
export const metadata: Metadata = {
  title: "DiveDay",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * The page a diver's emailed sign-in link opens (ADR 20261125-diver-sign-in).
 * The browser submits it on arrival, so the tap in the email is the only one;
 * a mail scanner that fetches the link without running it spends nothing.
 */
export default async function DiverSignInLanding({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const t = diverTranslator(await requestLocale());
  return (
    <EntryShell wordmark title={t("diverSignIn.confirmTitle")}>
      <form action={redeemDiverSignIn}>
        <input type="hidden" name="token" value={token} />
        <OpenOnArrival />
        <SubmitButton pendingLabel={t("diverSignIn.confirmTitle")} className={buttonClass()}>
          {t("diverSignIn.confirm")}
        </SubmitButton>
      </form>
    </EntryShell>
  );
}
