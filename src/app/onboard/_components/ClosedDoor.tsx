import Link from "next/link";
import { MarketingNav } from "@/app/_components/MarketingNav";
import { EntryShell } from "@/components/account/EntryShell";
import { MarketingFooter } from "@/components/MarketingFooter";
import { buttonClass } from "@/components/ui/button";
import type { DiverTranslator } from "@/i18n/messages";
import { ONBOARDING_EMAIL, setUpMailto } from "@/lib/platform-mail";

/**
 * The page everyone without the key sees: one sentence on how a shop gets
 * set up, and the mail that starts it. The demo and sign-in stay one line
 * each underneath, as they did under the form.
 */
export function ClosedDoor({ t }: { t: DiverTranslator }) {
  return (
    <div className="flex flex-1 flex-col">
      <MarketingNav hideCta compactMobile />
      <EntryShell
        eyebrow={t("account.onboard.eyebrow")}
        title={t("account.onboard.closed.title")}
        footer={
          <>
            <p>
              {t("account.onboard.demoNote")}{" "}
              <Link href="/" className="font-medium text-primary hover:underline">
                {t("account.onboard.tryLiveDemo")}
              </Link>
            </p>
            <p>
              {t("account.onboard.alreadyHaveShop")}{" "}
              <Link href="/sign-in" className="font-medium text-primary hover:underline">
                {t("account.onboard.signIn")}
              </Link>
            </p>
          </>
        }
      >
        <p className="text-muted">{t("account.onboard.closed.body")}</p>
        <a
          href={setUpMailto(t("marketing.common.setUpSubject"))}
          className={buttonClass({ className: "mt-6 w-full" })}
        >
          {t("account.onboard.closed.cta", { email: ONBOARDING_EMAIL })}
        </a>
      </EntryShell>
      <MarketingFooter />
    </div>
  );
}
