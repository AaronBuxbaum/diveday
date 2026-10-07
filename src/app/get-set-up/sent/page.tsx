import type { Metadata } from "next";
import { MarketingNav } from "@/app/_components/MarketingNav";
import { EntryDone } from "@/components/account/EntryShell";
import { MarketingFooter } from "@/components/MarketingFooter";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
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
 * request twice and the visual suite can photograph it directly. It says the
 * same thing to anyone who opens it, honeypot bots included, and reveals
 * nothing about any request.
 */
export default async function SetUpSentPage() {
  const t = diverTranslator(await requestLocale());
  return (
    <div className="flex flex-1 flex-col">
      <MarketingNav hideCta compactMobile />
      <EntryDone
        glyph="sent"
        title={t("marketing.setUp.sent.title")}
        text={t("marketing.setUp.sent.body")}
        action={<SetUpDemoDoor t={t} source="setup-sent" />}
      />
      <MarketingFooter />
    </div>
  );
}
