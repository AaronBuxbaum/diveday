import { Eyebrow } from "@/app/_components/Eyebrow";
import { ScreenDoor } from "@/app/_components/ScreenDoor";
import { ExportBundleFallback } from "@/components/MarketingScreenFallbacks";
import { MarketingMockup } from "@/components/MarketingSections";
import { BANNER_TITLE_CLASS } from "@/components/ui/typography";
import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import { fullShopExport } from "@/lib/marketing";

/** `/pricing`'s "what happens to my records if I leave?" band. */
export function PricingExportBand({ locale }: { locale: DiverLocale }) {
  const t = diverTranslator(locale);
  return (
    <>
      {/* The page's other big claim: you can leave with your records any
          day. It sits here rather than in the FAQ because this is where the
          objection actually lands — the fee anchor above has just made
          switching look attractive, and the next thought a shop owner has is
          about being stuck again. This band is `#export`, where the
          invoice's leaving row and every other page's records link land,
          and the one place on the page the promise is written in full.

          The mockup is a claim, so it mirrors the real Settings → Data export
          element for element — including the "Not included, on purpose:" line
          that says credentials never leave (docs/product/marketing.md). */}
      {/* The marketing shell's container, like every band on the page
          (visual review 2026-10-24, B12). */}
      <section id="export" className="scroll-mt-10 border-b border-border">
        <div className="mx-auto grid w-full max-w-7xl gap-10 px-6 py-16 lg:grid-cols-2 lg:items-center lg:py-24">
          <div>
            <Eyebrow>{t("marketing.pricing.dataExit.eyebrow")}</Eyebrow>
            <h2 className={`mt-4 ${BANNER_TITLE_CLASS} sm:text-4xl`}>
              {t("marketing.pricing.dataExit.title")}
            </h2>
            {/* The export promise, said here only, beside the screen it
                describes; the drawing carries the detail, so the band
                lists none of it (visual review 2026-10-24, B10). The door is
                link-weight, so this band holds no primary and the page's two
                pairs stay its only ones; it opens the demo as the owner, the
                role that downloads the export (issue #1955). */}
            <p className="mt-6 max-w-xl text-base leading-7 text-pretty text-muted">
              {t(fullShopExport.termsKey)}
            </p>
            <ScreenDoor
              locale={locale}
              demoRole="owner"
              source="pricing-export"
              label={t("marketing.pricing.dataExit.door")}
            />
          </div>
          <MarketingMockup label={t("marketing.pricing.dataExit.mockupLabel")}>
            <ExportBundleFallback locale={locale} />
          </MarketingMockup>
        </div>
      </section>
    </>
  );
}
