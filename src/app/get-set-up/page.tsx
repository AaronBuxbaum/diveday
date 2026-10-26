import type { Metadata } from "next";
import Link from "next/link";
import { MarketingNav } from "@/app/_components/MarketingNav";
import { EntryShell } from "@/components/account/EntryShell";
import { MarketingFooter } from "@/components/MarketingFooter";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { eventSource } from "@/lib/funnel";
import { MIGRATION_GUIDES } from "@/lib/migration-guides";
import {
  SETUP_CURRENT_SYSTEM_KEYS,
  SETUP_CURRENT_SYSTEMS,
  setupPreselection,
} from "@/lib/setup-requests";
import { SetupRequestForm, type SetupRequestFormWords } from "./_components/SetupRequestForm";

// `instant = true`: the frame paints from the static shell while the locale
// and `?from=` stream in behind this segment's `loading.tsx` (ADR
// 20260804-instant-navigation).
export const instant = true;

export const metadata: Metadata = {
  title: "Get set up — DiveDay",
  description: "Tell us about your dive shop and we will set it up for you by hand.",
};

/**
 * **The "Get set up" door** (ADR 20261007-setup-request-form): every public
 * set-up button lands here, carrying its page's funnel tag in `?from=`, which
 * the form posts back so the request reads per surface. Shops are still opened
 * by hand (ADR 20260925-shops-are-set-up-by-hand); this is how a shop asks.
 * A switching guide's tag also answers "What do you use today?" and "Which
 * one?" with that guide's system (2026-10-22).
 *
 * The nav's own demo button is hidden, as on `/onboard`: Send is the page's
 * one primary. The demo waits on the thank-you page, for a reader with a reply
 * on the way.
 */
export default async function GetSetUpPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  const t = diverTranslator(await requestLocale());
  const words: SetupRequestFormWords = {
    shopName: t("marketing.setUp.shopName"),
    region: t("marketing.setUp.region"),
    runsBoat: t("marketing.setUp.runsBoat"),
    yes: t("marketing.setUp.yes"),
    no: t("marketing.setUp.no"),
    currentSystem: t("marketing.setUp.currentSystem"),
    notSpecified: t("marketing.setUp.notSpecified"),
    current: Object.fromEntries(
      SETUP_CURRENT_SYSTEMS.map((system) => [system, t(SETUP_CURRENT_SYSTEM_KEYS[system])]),
    ) as SetupRequestFormWords["current"],
    whichSystem: t("marketing.setUp.whichSystem"),
    anotherSystem: t("marketing.setUp.anotherSystem"),
    contactName: t("marketing.setUp.contactName"),
    email: t("marketing.setUp.email"),
    phone: t("marketing.setUp.phone"),
    website: t("marketing.setUp.website"),
    submit: t("marketing.setUp.submit"),
    sending: t("marketing.setUp.sending"),
    errors: {
      required: t("marketing.setUp.errors.required"),
      invalid: t("marketing.setUp.errors.invalid"),
      email: t("marketing.setUp.errors.email"),
    },
    rateLimited: t("common.rateLimited"),
  };

  return (
    <div className="flex flex-1 flex-col">
      <MarketingNav compactMobile />
      <EntryShell
        title={t("marketing.setUp.title")}
        description={t("marketing.setUp.description")}
        footer={
          <p>
            {t("account.onboard.alreadyHaveShop")}{" "}
            <Link href="/sign-in" className="font-medium text-primary hover:underline">
              {t("account.onboard.signIn")}
            </Link>
          </p>
        }
      >
        <SetupRequestForm
          source={eventSource(from)}
          words={words}
          systems={MIGRATION_GUIDES.map((guide) => ({ slug: guide.slug, name: guide.competitor }))}
          preselect={setupPreselection(from)}
        />
      </EntryShell>
      <MarketingFooter />
    </div>
  );
}
