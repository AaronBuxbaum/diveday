import type { Metadata } from "next";
import Link from "next/link";
import { enterDemoAction } from "@/app/actions/demo";
import { FunnelTag } from "@/components/FunnelTag";
import { MarketingFooter } from "@/components/MarketingFooter";
import { MarketingNav } from "@/components/MarketingNav";
import { SubmitButton } from "@/components/SubmitButton";
import { SwitchingConcierge } from "@/components/SwitchingConcierge";
import { buttonClass } from "@/components/ui/button";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { trialHref } from "@/lib/funnel";
import { MIGRATION_GUIDES } from "@/lib/migration-guides";

export const metadata: Metadata = {
  title: "Switching guides — DiveDay",
  description:
    "On a spreadsheet, or leaving EVE, DiveShop360, DiveAdmin, or Smartwaiver? Step-by-step guides to bring your divers, cards, and sizes into DiveDay — with an honest account of what comes across.",
};

export default async function SwitchHubPage() {
  const t = diverTranslator(await requestLocale());
  return (
    <div className="flex flex-1 flex-col">
      <MarketingNav />
      <main className="flex-1">
        <section className="border-b border-border">
          <div className="mx-auto max-w-4xl px-6 py-20 text-center lg:py-28">
            <p className="text-sm font-semibold tracking-widest text-primary uppercase">
              {t("switching.hub.eyebrow")}
            </p>
            <h1 className="mt-5 text-4xl font-semibold tracking-[-0.045em] text-balance sm:text-6xl">
              {t("switching.hub.title")}
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-muted">
              {t("switching.hub.description")}
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-6 py-16 lg:py-24">
          <div className="grid gap-5 md:grid-cols-2">
            <Link
              href="/switching/spreadsheet"
              className="group flex flex-col rounded-2xl border border-border bg-surface p-6 transition-colors duration-200 hover:border-border-strong sm:p-7"
            >
              <h2 className="text-xl font-semibold tracking-tight">
                {t("switching.hub.spreadsheetTitle")}
              </h2>
              <p className="mt-3 flex-1 leading-7 text-muted">
                {t("switching.hub.spreadsheetDescription")}
              </p>
              <span className="mt-5 text-sm font-semibold text-primary group-hover:underline">
                {t("switching.hub.readGuide")}
              </span>
            </Link>
            {MIGRATION_GUIDES.map((guide) => (
              <Link
                key={guide.slug}
                href={`/switching/${guide.slug}`}
                className="group flex flex-col rounded-2xl border border-border bg-surface p-6 transition-colors duration-200 hover:border-border-strong sm:p-7"
              >
                <h2 className="text-xl font-semibold tracking-tight">
                  {t("switching.hub.switchingFrom", { competitor: guide.competitor })}
                </h2>
                <p className="mt-3 flex-1 leading-7 text-muted">{guide.cardSummary}</p>
                <span className="mt-5 text-sm font-semibold text-primary group-hover:underline">
                  {t("switching.hub.readGuide")}
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* The owner-authorized concierge switch offer (shared across /switching). */}
        <SwitchingConcierge />

        <section className="border-t border-border bg-surface">
          <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 px-6 py-14 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">
                {t("switching.hub.dontSeeSystem")}
              </h2>
              <p className="mt-2 max-w-xl text-muted">{t("switching.hub.dontSeeSystemBody")}</p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <form action={enterDemoAction} className="contents">
                <FunnelTag source="switching-hub" />
                <SubmitButton
                  pendingLabel={t("switching.hub.gettingDemoReady")}
                  className={buttonClass({
                    size: "cta",
                    className: "cursor-pointer disabled:opacity-70",
                  })}
                >
                  {t("marketing.common.tryDemo")}
                </SubmitButton>
              </form>
              <Link
                href={trialHref("switching-hub")}
                className={buttonClass({
                  variant: "secondary",
                  size: "cta",
                  className: "border-border-strong",
                })}
              >
                {t("marketing.common.startTrial")}
              </Link>
            </div>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}
