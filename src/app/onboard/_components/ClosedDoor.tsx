import Link from "next/link";
import { MarketingNav } from "@/app/_components/MarketingNav";
import { EntryShell } from "@/components/account/EntryShell";
import { MarketingFooter } from "@/components/MarketingFooter";
import { buttonClass } from "@/components/ui/button";
import type { DiverTranslator } from "@/i18n/messages";
import { setUpHref } from "@/lib/funnel";
import { OnboardDemoDoor } from "./OnboardDemoDoor";

/**
 * The page everyone without an open setup link sees: one sentence on how a
 * shop gets set up, and the door to the set-up form. The demo and sign-in stay
 * one line each underneath, as they did under the form.
 *
 * `spentLink` is the visitor who came with a link that no longer opens the
 * form (spent, expired or mistyped; ADR 20261009-single-use-setup-links). They
 * were sent here by a person, so the page says the link is done rather than
 * explaining set-up from the start, and offers the same door.
 */
export function ClosedDoor({ t, spentLink = false }: { t: DiverTranslator; spentLink?: boolean }) {
  return (
    <div className="flex flex-1 flex-col">
      <MarketingNav hideCta compactMobile />
      <EntryShell
        eyebrow={t("account.onboard.eyebrow")}
        title={t(spentLink ? "account.onboard.spentLink.title" : "account.onboard.closed.title")}
        footer={
          <>
            <OnboardDemoDoor t={t} />
            <p>
              {t("account.onboard.alreadyHaveShop")}{" "}
              <Link href="/sign-in" className="font-medium text-primary hover:underline">
                {t("account.onboard.signIn")}
              </Link>
            </p>
          </>
        }
      >
        <p className="text-muted">
          {t(spentLink ? "account.onboard.spentLink.body" : "account.onboard.closed.body")}
        </p>
        <Link
          href={setUpHref("onboard-closed")}
          className={buttonClass({ className: "mt-6 w-full" })}
        >
          {t("marketing.common.getSetUp")}
        </Link>
      </EntryShell>
      <MarketingFooter />
    </div>
  );
}
