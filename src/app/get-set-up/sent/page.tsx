import type { Metadata } from "next";
import Link from "next/link";
import { MarketingNav } from "@/app/_components/MarketingNav";
import { EntryDone } from "@/components/account/EntryShell";
import { MarketingFooter } from "@/components/MarketingFooter";
import { buttonClass, proseLinkClass } from "@/components/ui/button";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { SUPPORT_EMAIL } from "@/lib/platform-mail";
import { setupSentAdvice } from "@/lib/setup-requests";
import { SetUpDemoDoor } from "../_components/SetUpDemoDoor";

// See `../page.tsx`: the locale streams in behind this segment's `loading.tsx`.
export const instant = true;

export const metadata: Metadata = {
  title: "Request sent — DiveDay",
  robots: { index: false, follow: true },
};

/**
 * **Where a set-up request lands** (ADR 20261007-setup-request-form): the
 * terminal "sent" door, and the demo for the wait. A page of its own rather
 * than a state of the form, so a refresh or a back button cannot post the
 * request twice and the visual suite can photograph it directly. It reveals
 * nothing about any request.
 *
 * **It answers what the reader said they use today** (fifth-loop ideas, item
 * 55): the form's one answer rides in `?uses=`, and paper, a spreadsheet or
 * another system each get the first step of moving across. A system the reader
 * named rides in `?guide=` and gets its own guide (2026-10-22). Anything else,
 * honeypot bots included, reads the page as it always was.
 */
export default async function SetUpSentPage({
  searchParams,
}: {
  searchParams: Promise<{ uses?: string | string[]; guide?: string | string[] }>;
}) {
  const [{ uses, guide }, locale] = await Promise.all([searchParams, requestLocale()]);
  const t = diverTranslator(locale);
  const advice = setupSentAdvice(uses, guide);
  return (
    <div className="flex flex-1 flex-col">
      <MarketingNav compactMobile />
      <EntryDone
        glyph="sent"
        title={t("marketing.setUp.sent.title")}
        text={t("marketing.setUp.sent.body")}
        action={
          <div className="space-y-6">
            {advice ? (
              <p className="text-balance" data-testid="setup-sent-advice">
                {t(advice.key)}
                {advice.link ? (
                  <>
                    {" "}
                    <Link href={advice.link.href} className={proseLinkClass}>
                      {t(advice.link.key, { competitor: advice.link.competitor ?? "" })}
                    </Link>
                  </>
                ) : null}
              </p>
            ) : null}
            <SetUpDemoDoor t={t} source="setup-sent" />
            {/* A button like every other action on the page (B45). */}
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className={buttonClass({ variant: "secondary", className: "w-full" })}
            >
              {t("marketing.setUp.sent.support")}
            </a>
          </div>
        }
      />
      <MarketingFooter />
    </div>
  );
}
