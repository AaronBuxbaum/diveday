import type { Metadata } from "next";
import { redeemMagicSignIn } from "@/app/email-sign-in/actions";
import { EntryShell } from "@/components/account/EntryShell";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
export const instant = true;
export const metadata: Metadata = {
  title: "DiveDay",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default async function EmailSignInConfirmation({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const t = diverTranslator(await requestLocale());
  return (
    <EntryShell wordmark homeLink title={t("account.magicSignIn.confirmTitle")}>
      <form action={redeemMagicSignIn}>
        <input type="hidden" name="token" value={token} />
        <SubmitButton pendingLabel={t("account.signIn.signingIn")} className={buttonClass()}>
          {t("account.magicSignIn.confirm")}
        </SubmitButton>
      </form>
    </EntryShell>
  );
}
