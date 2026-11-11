import Link from "next/link";
import { Eyebrow } from "@/app/_components/Eyebrow";
import { FunnelCtas } from "@/app/_components/FunnelCtas";
import { FrontDeskReadinessFallback } from "@/components/MarketingScreenFallbacks";
import { MarginNotes, MarketingMockup } from "@/components/MarketingSections";
import { buttonClass } from "@/components/ui/button";
import { BANNER_TITLE_CLASS } from "@/components/ui/typography";
import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import type { FunnelSource } from "@/lib/funnel";
import { GUIDE_BAND_CLASS } from "./guide";

/** A switch needs a reason before it needs an export. Prove the shared crew workflow
 * with the existing product drawing, then offer the demo on that same Today screen. */
export function GuideProof({ locale, source }: { locale: DiverLocale; source: FunnelSource }) {
  const t = diverTranslator(locale);
  return (
    <section id="dive-day" className="scroll-mt-10 border-b border-border bg-surface">
      <div className={GUIDE_BAND_CLASS}>
        <Eyebrow>{t("switching.common.proof.eyebrow")}</Eyebrow>
        <h2 className={`mt-3 max-w-2xl ${BANNER_TITLE_CLASS} sm:text-4xl`}>
          {t("switching.common.proof.title")}
        </h2>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-muted">
          {t("switching.common.proof.body")}
        </p>
        <div className="mt-8 grid items-start gap-8 md:grid-cols-[1.2fr_1fr]">
          <div className="min-w-0">
            <MarketingMockup label={t("switching.common.proof.label")}>
              <FrontDeskReadinessFallback locale={locale} />
            </MarketingMockup>
            <MarginNotes
              className="mt-5"
              notes={[t("switching.common.proof.note1"), t("switching.common.proof.note2")]}
            />
          </div>
          <ul className="divide-y divide-border border-y border-border">
            {(
              [
                { key: "cert", href: "/product/certifications" },
                { key: "boat", href: "/product/boat-manifest" },
              ] as const
            ).map(({ key, href }) => (
              <li key={key} className="py-5 first:pt-4">
                <h3 className="font-semibold leading-6">
                  {t(`switching.common.proof.${key}Title`)}
                </h3>
                <p className="mt-2 text-sm leading-6 text-muted">
                  {t(`switching.common.proof.${key}Body`)}
                </p>
                <Link
                  href={href}
                  className={buttonClass({ variant: "link", flush: true, className: "mt-2" })}
                >
                  {t(`switching.common.proof.${key}Link`)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-8">
          <FunnelCtas locale={locale} source={source} demo={{ role: "owner", landing: "today" }} />
        </div>
      </div>
    </section>
  );
}
